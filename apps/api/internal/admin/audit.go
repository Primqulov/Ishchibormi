package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Audit: paginated admin action log. Query params:
//
//	page, limit, adminId, action, from (RFC3339), to (RFC3339)
func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	q := r.URL.Query()

	filter := bson.M{}
	if v := strings.TrimSpace(q.Get("adminId")); v != "" {
		if oid, err := primitive.ObjectIDFromHex(v); err == nil {
			filter["adminId"] = oid
		}
	}
	if v := strings.TrimSpace(q.Get("action")); v != "" {
		filter["action"] = v
	}
	rng := bson.M{}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$gte"] = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$lte"] = t
		}
	}
	if len(rng) > 0 {
		filter["createdAt"] = rng
	}

	cur, err := h.AuditCol.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	type auditRow struct {
		models.AdminAudit
		AdminName string `json:"adminName"`
	}
	rows := []auditRow{}
	idSet := map[primitive.ObjectID]struct{}{}
	for cur.Next(ctx) {
		var a models.AdminAudit
		if err := cur.Decode(&a); err == nil {
			rows = append(rows, auditRow{AdminAudit: a})
			if !a.AdminID.IsZero() {
				idSet[a.AdminID] = struct{}{}
			}
		}
	}
	// Resolve admin ids -> display name (name yoki username) in one query.
	names := map[primitive.ObjectID]string{}
	if len(idSet) > 0 {
		ids := make([]primitive.ObjectID, 0, len(idSet))
		for id := range idSet {
			ids = append(ids, id)
		}
		ac, err := h.Admins.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
		if err == nil {
			defer ac.Close(ctx)
			for ac.Next(ctx) {
				var a models.Admin
				if ac.Decode(&a) == nil {
					disp := a.Name
					if disp == "" {
						disp = a.Username
					}
					names[a.ID] = disp
				}
			}
		}
	}
	for i := range rows {
		rows[i].AdminName = names[rows[i].AdminID]
	}
	total, _ := h.AuditCol.CountDocuments(ctx, filter)
	paged(w, rows, page, limit, total)
}
