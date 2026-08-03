package admin

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// appsFilter is shared by ListApplications and the applications CSV export.
// Params: status, stale=1 (pending older than 3 days).
func appsFilter(q url.Values) bson.M {
	filter := bson.M{}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		filter["status"] = status
	}
	if q.Get("stale") == "1" {
		filter["status"] = "pending"
		filter["appliedAt"] = bson.M{"$lte": time.Now().AddDate(0, 0, -3)}
	}
	return filter
}

// ListApplications: paginated application feed for the process dashboard.
// Query params: page, limit, status, stale=1 (pending older than 3 days).
func (h *Handler) ListApplications(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := appsFilter(r.URL.Query())

	cur, err := h.Apps.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "appliedAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Application{}
	for cur.Next(ctx) {
		var a models.Application
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	total, _ := h.Apps.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// ---- CSV export ----
