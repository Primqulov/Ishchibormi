package admin

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// elonsFilter is shared by ListElons and the elons CSV export.
// Params: q (title), status, region, categoryId.
func elonsFilter(q url.Values) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		filter["title"] = bson.M{"$regex": escRe(s), "$options": "i"}
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		filter["status"] = status
	}
	if region := strings.TrimSpace(q.Get("region")); region != "" {
		filter["region"] = region
	}
	if cat := strings.TrimSpace(q.Get("categoryId")); cat != "" {
		if oid, err := primitive.ObjectIDFromHex(cat); err == nil {
			filter["categoryId"] = oid
		}
	}
	return filter
}

// ListElons: paginated + filterable. Query params:
//
//	page, limit, q (title), status, categoryId, region
func (h *Handler) ListElons(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := elonsFilter(r.URL.Query())

	cur, err := h.Elons.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Elon{}
	for cur.Next(ctx) {
		var e models.Elon
		if err := cur.Decode(&e); err == nil {
			out = append(out, e)
		}
	}
	total, _ := h.Elons.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// SetElonStatus hides (status=hidden) or restores (status=recruiting) an elon —
// lightweight moderation without deleting. isDeleted is left untouched.
func (h *Handler) SetElonStatus(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	_ = httpx.Decode(r, &req)
	allowed := map[string]bool{"hidden": true, "recruiting": true, "filled": true, "cancelled": true}
	if !allowed[req.Status] {
		httpx.Err(w, httpx.NewError(400, "bad_status", "unsupported status"))
		return
	}
	if _, err := h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"status": req.Status}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "elon_status", id.Hex(), req.Status)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) DeleteElon(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var prev models.Elon
	_ = h.Elons.FindOne(r.Context(), bson.M{"_id": id}).Decode(&prev)
	_, err = h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isDeleted": true, "status": "cancelled"}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	for _, u := range prev.Images {
		go upload.DeleteByURL(h.Storage, u)
	}
	h.audit(r, "elon_delete", id.Hex(), "force")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
