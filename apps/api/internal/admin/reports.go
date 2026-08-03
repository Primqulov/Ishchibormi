package admin

import (
	"net/http"
	"strings"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// reportRow is an enriched report for the moderation queue: the raw report plus
// a human-readable target label, the elon owner (for one-click action) and the
// reporter's name — so the admin can triage without extra round-trips.
type reportRow struct {
	models.Report
	TargetLabel   string `json:"targetLabel"`
	TargetOwnerID string `json:"targetOwnerId,omitempty"`
	ReporterName  string `json:"reporterName,omitempty"`
}

// ListReports: paginated moderation queue. Query params: page, limit, status
// (open|resolved|dismissed). Targets and reporters are batch-loaded to avoid N+1.
func (h *Handler) ListReports(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)

	filter := bson.M{}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		filter["status"] = status
	}
	cur, err := h.Reports.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	reports := []models.Report{}
	for cur.Next(ctx) {
		var rp models.Report
		if err := cur.Decode(&rp); err == nil {
			reports = append(reports, rp)
		}
	}

	// Collect ids to batch-load.
	userIDs := map[primitive.ObjectID]bool{}
	elonIDs := map[primitive.ObjectID]bool{}
	for _, rp := range reports {
		userIDs[rp.ReporterID] = true
		switch rp.TargetType {
		case "user":
			userIDs[rp.TargetID] = true
		case "elon":
			elonIDs[rp.TargetID] = true
		}
	}
	users := loadUserMap(ctx, h.Users, userIDs)
	elons := loadElonMap(ctx, h.Elons, elonIDs)

	rows := make([]reportRow, 0, len(reports))
	for _, rp := range reports {
		row := reportRow{Report: rp}
		if u, ok := users[rp.ReporterID]; ok {
			row.ReporterName = strings.TrimSpace(u.FirstName + " " + u.LastName)
		}
		switch rp.TargetType {
		case "user":
			if u, ok := users[rp.TargetID]; ok {
				row.TargetLabel = strings.TrimSpace(u.FirstName+" "+u.LastName) + " · " + u.Phone
			} else {
				row.TargetLabel = "(o'chirilgan foydalanuvchi)"
			}
		case "elon":
			if e, ok := elons[rp.TargetID]; ok {
				row.TargetLabel = e.Title
				row.TargetOwnerID = e.OwnerID.Hex()
			} else {
				row.TargetLabel = "(o'chirilgan e'lon)"
			}
		default:
			row.TargetLabel = "Xabar"
		}
		rows = append(rows, row)
	}
	total, _ := h.Reports.CountDocuments(ctx, filter)
	paged(w, rows, page, limit, total)
}
