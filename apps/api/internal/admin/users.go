package admin

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// usersFilter builds the Mongo query shared by ListUsers and the users CSV
// export. Params: q (name/phone), region, blocked=1|0, verified=1|0.
func usersFilter(q url.Values) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		rx := bson.M{"$regex": escRe(s), "$options": "i"}
		filter["$or"] = bson.A{
			bson.M{"firstName": rx}, bson.M{"lastName": rx}, bson.M{"phone": rx},
		}
	}
	if region := strings.TrimSpace(q.Get("region")); region != "" {
		filter["region"] = region
	}
	switch q.Get("blocked") {
	case "1":
		filter["isBlocked"] = true
	case "0":
		filter["isBlocked"] = bson.M{"$ne": true}
	}
	switch q.Get("verified") {
	case "1":
		filter["isPhoneVerified"] = true
	case "0":
		filter["isPhoneVerified"] = bson.M{"$ne": true}
	}
	return filter
}

// ListUsers: paginated + searchable + filterable. Query params:
//
//	page, limit, q (name/phone), region, blocked=1|0, verified=1|0
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := usersFilter(r.URL.Query())

	cur, err := h.Users.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.User{}
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			out = append(out, u)
		}
	}
	total, _ := h.Users.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// GetUser returns a single user plus their related records (elons, applications
// as worker, reviews about them, and reports filed against them) — the "batafsil
// ko'rinish" the doc asks for, in one round-trip.
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var u models.User
	if err := h.Users.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	elons := decodeElons(ctx, h.Elons, bson.M{"ownerId": id}, 100)
	apps := decodeApps(ctx, h.Apps, bson.M{"workerId": id}, 100)
	reports := decodeReports(ctx, h.Reports, bson.M{"targetType": "user", "targetId": id}, 100)
	httpx.JSON(w, 200, map[string]any{
		"user": u, "elons": elons, "applications": apps, "reports": reports,
	})
}

func (h *Handler) VerifyUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if _, err := h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isPhoneVerified": true}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "user_verify", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type notifyUserReq struct {
	Title string `json:"title" validate:"required"`
	Body  string `json:"body"`
}

// NotifyUser sends a single admin-authored notification to one user.
func (h *Handler) NotifyUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req notifyUserReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	h.Notify.Push(r.Context(), id, "system", req.Title, req.Body, nil)
	h.audit(r, "user_notify", id.Hex(), req.Title)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type setBlockReq struct {
	IsBlocked bool `json:"isBlocked"`
}

func (h *Handler) BlockUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req setBlockReq
	_ = httpx.Decode(r, &req)
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isBlocked": req.IsBlocked}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "user_block", id.Hex(), "isBlocked=set")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	// Best-effort: remove the user's avatar from S3, plus images of all their elons.
	var u models.User
	if err := h.Users.FindOne(r.Context(), bson.M{"_id": id}).Decode(&u); err == nil {
		go upload.DeleteByURL(h.Storage, u.AvatarURL)
	}
	cur, _ := h.Elons.Find(r.Context(), bson.M{"ownerId": id})
	if cur != nil {
		defer cur.Close(r.Context())
		for cur.Next(r.Context()) {
			var e models.Elon
			if err := cur.Decode(&e); err == nil {
				for _, u := range e.Images {
					go upload.DeleteByURL(h.Storage, u)
				}
			}
		}
	}
	// Release the identity, exactly as account.softDelete does for self-service
	// deletion: unsetting phone/telegramId drops this document out of the
	// unique-sparse indexes, which is what lets the number register again later.
	// Leaving them attached used to strand the user — auth.upsertUser matched
	// this dead document, so they logged in and were bounced straight back to
	// the login screen by RequireActiveUser.
	set := bson.M{"isDeleted": true, "deletedAt": time.Now()}
	if u.Phone != "" {
		set["deletedPhone"] = u.Phone
	}
	if u.TelegramID != 0 {
		set["deletedTelegramId"] = u.TelegramID
	}
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{
		"$set":   set,
		"$unset": bson.M{"phone": "", "telegramId": ""},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	// O'chirilgan hisobning qurilmalariga push (masalan broadcast) ketmasin.
	_, _ = h.Users.Database().Collection("device_tokens").DeleteMany(r.Context(), bson.M{"userId": id})
	h.audit(r, "user_delete", id.Hex(), "soft-delete")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
