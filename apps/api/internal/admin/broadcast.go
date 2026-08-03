package admin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type broadcastReq struct {
	Title       string `json:"title" validate:"required"`
	Body        string `json:"body"`
	Region      string `json:"region"`
	ActiveOnly  bool   `json:"activeOnly"`
	ScheduledAt string `json:"scheduledAt"` // RFC3339; empty/past = send now
}

// broadcastFilter builds the recipient query for a broadcast: never deleted;
// optionally only a region and/or only non-blocked ("active") users.
func broadcastFilter(req broadcastReq) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if req.ActiveOnly {
		filter["isBlocked"] = bson.M{"$ne": true}
	}
	if region := strings.TrimSpace(req.Region); region != "" {
		filter["region"] = region
	}
	return filter
}

// Broadcast queues a segmented notification and returns immediately. The actual
// per-user push runs in a background goroutine (with its own context), so a
// large audience no longer blocks the request — the doc's flagged problem. Send
// progress is recorded on the broadcasts collection (status sending -> done).
func (h *Handler) Broadcast(w http.ResponseWriter, r *http.Request) {
	var req broadcastReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "title required"))
		return
	}
	// Optional schedule. A time more than a minute in the future defers delivery
	// to the background scheduler; anything else sends immediately.
	var scheduledAt *time.Time
	if s := strings.TrimSpace(req.ScheduledAt); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.Err(w, httpx.NewError(400, "bad_time", "scheduledAt must be RFC3339"))
			return
		}
		if t.After(time.Now().Add(time.Minute)) {
			scheduledAt = &t
		}
	}

	filter := broadcastFilter(req)
	total, _ := h.Users.CountDocuments(r.Context(), filter)

	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	status := "sending"
	if scheduledAt != nil {
		status = "scheduled"
	}
	bc := models.Broadcast{
		Title: req.Title, Body: req.Body, Region: strings.TrimSpace(req.Region),
		ActiveOnly: req.ActiveOnly, SentCount: 0, Status: status,
		ScheduledAt: scheduledAt, CreatedBy: adminID, CreatedAt: time.Now(),
	}
	res, err := h.Broadcasts.InsertOne(r.Context(), bc)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	bc.ID = res.InsertedID.(primitive.ObjectID)

	if scheduledAt != nil {
		h.audit(r, "broadcast_schedule", req.Title, scheduledAt.Format(time.RFC3339))
		httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "scheduled", "scheduledAt": scheduledAt})
		return
	}
	h.audit(r, "broadcast", req.Title, req.Body)
	// Fire-and-forget delivery. Uses a fresh background context because the
	// request context is cancelled once we respond below.
	go h.sendBroadcast(bc.ID, filter, req.Title, req.Body)
	httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "sending"})
}

// RunScheduler polls for due scheduled broadcasts once a minute until ctx is
// cancelled. Runs as a single background goroutine started in main.
func (h *Handler) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	h.dispatchDueBroadcasts(ctx) // catch anything already due at startup
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.dispatchDueBroadcasts(ctx)
		}
	}
}

// dispatchDueBroadcasts atomically claims each due broadcast (scheduled ->
// sending via FindOneAndUpdate, so only one worker/tick can win) and delivers
// it. Recipients are rebuilt from the stored segment.
func (h *Handler) dispatchDueBroadcasts(ctx context.Context) {
	for {
		var bc models.Broadcast
		err := h.Broadcasts.FindOneAndUpdate(ctx,
			bson.M{"status": "scheduled", "scheduledAt": bson.M{"$lte": time.Now()}},
			bson.M{"$set": bson.M{"status": "sending"}},
			options.FindOneAndUpdate().SetReturnDocument(options.After),
		).Decode(&bc)
		if err != nil {
			return // ErrNoDocuments (nothing due) or a transient error — retry next tick
		}
		filter := broadcastFilter(broadcastReq{Region: bc.Region, ActiveOnly: bc.ActiveOnly})
		h.sendBroadcast(bc.ID, filter, bc.Title, bc.Body)
	}
}

// CancelBroadcast deletes a broadcast that hasn't started sending yet.
func (h *Handler) CancelBroadcast(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	res, err := h.Broadcasts.DeleteOne(r.Context(), bson.M{"_id": id, "status": "scheduled"})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.DeletedCount == 0 {
		httpx.Err(w, httpx.NewError(409, "not_scheduled", "only scheduled broadcasts can be cancelled"))
		return
	}
	h.audit(r, "broadcast_cancel", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// sendBroadcast delivers one notification per matching user and marks the
// broadcast done. Runs detached from the HTTP request.
func (h *Handler) sendBroadcast(id primitive.ObjectID, filter bson.M, title, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cur, err := h.Users.Find(ctx, filter)
	if err != nil {
		_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "done"}})
		return
	}
	defer cur.Close(ctx)
	count := 0
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			h.Notify.Push(ctx, u.ID, "system", title, body, nil)
			count++
		}
	}
	_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"sentCount": count, "status": "done"}})
}

// ListBroadcasts returns the broadcast history (newest first, paginated).
func (h *Handler) ListBroadcasts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	cur, err := h.Broadcasts.Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Broadcast{}
	for cur.Next(ctx) {
		var b models.Broadcast
		if err := cur.Decode(&b); err == nil {
			out = append(out, b)
		}
	}
	total, _ := h.Broadcasts.CountDocuments(ctx, bson.M{})
	paged(w, out, page, limit, total)
}
