package admin

import (
	"context"
	"net/http"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// notDeletedNotReview is the base filter for every admin metric: live records
// only, and never the Google Play review sandbox.
//
// One filter serves both collections. A user document carries isReviewAccount
// and no isReviewData; an elon carries the reverse. Since "$ne: true" also
// matches a missing field, each condition is a no-op on the collection it does
// not apply to — so real records match both and sandbox records match neither.
func notDeletedNotReview() bson.M {
	return bson.M{
		"isDeleted":       bson.M{"$ne": true},
		"isReviewAccount": bson.M{"$ne": true},
		"isReviewData":    bson.M{"$ne": true},
	}
}

// mergeFilter returns a new filter combining a and b; b wins on conflicts.
func mergeFilter(a, b bson.M) bson.M {
	m := bson.M{}
	for k, v := range a {
		m[k] = v
	}
	for k, v := range b {
		m[k] = v
	}
	return m
}

// Dashboard returns the KPI cards for the overview screen. Each metric is a
// cheap CountDocuments; heavier time-series live under Stats.
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	notDeleted := notDeletedNotReview()
	today := bson.M{"createdAt": bson.M{"$gte": startOfToday()}}

	count := func(col *mongo.Collection, filter bson.M) int64 {
		n, _ := col.CountDocuments(ctx, filter)
		return n
	}
	merge := mergeFilter

	httpx.JSON(w, 200, map[string]any{
		"users":           count(h.Users, notDeleted),
		"activeUsers":     count(h.Users, merge(notDeleted, bson.M{"isBlocked": bson.M{"$ne": true}})),
		"blockedUsers":    count(h.Users, bson.M{"isBlocked": true}),
		"todayUsers":      count(h.Users, merge(notDeleted, today)),
		"elons":           count(h.Elons, notDeleted),
		"recruitingElons": count(h.Elons, merge(notDeleted, bson.M{"status": "recruiting"})),
		"filledElons":     count(h.Elons, merge(notDeleted, bson.M{"status": "filled"})),
		"todayElons":      count(h.Elons, merge(notDeleted, today)),
		"completed":       count(h.Apps, bson.M{"status": "completed"}),
		"openReports":     count(h.Reports, bson.M{"status": "open"}),
		"openFeedback":    count(h.Feedback, bson.M{"status": "open"}),
	})
}

type dayPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// dailySeries returns one point per day for the last `days` days (gaps filled
// with 0) counting documents by their createdAt date. Used for growth charts.
func dailySeries(ctx context.Context, col *mongo.Collection, days int) []dayPoint {
	since := startOfToday().AddDate(0, 0, -(days - 1))
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: mergeFilter(notDeletedNotReview(), bson.M{"createdAt": bson.M{"$gte": since}})}},
		{{Key: "$group", Value: bson.M{
			"_id":   bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$createdAt"}},
			"count": bson.M{"$sum": 1},
		}}},
	}
	counts := map[string]int{}
	if cur, err := col.Aggregate(ctx, pipeline); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row struct {
				ID    string `bson:"_id"`
				Count int    `bson:"count"`
			}
			if cur.Decode(&row) == nil {
				counts[row.ID] = row.Count
			}
		}
	}
	out := make([]dayPoint, 0, days)
	for i := 0; i < days; i++ {
		d := since.AddDate(0, 0, i).Format("2006-01-02")
		out = append(out, dayPoint{Date: d, Count: counts[d]})
	}
	return out
}

// Stats powers the analytics widgets: 30-day growth curves, the application
// funnel, top categories and regional distribution — all via aggregation.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Time range for the growth curves: 7 | 30 | 90 days (default 30).
	days := 30
	switch r.URL.Query().Get("days") {
	case "7":
		days = 7
	case "90":
		days = 90
	}

	// Application funnel — counts per status.
	funnel := map[string]int{}
	if cur, err := h.Apps.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$group", Value: bson.M{"_id": "$status", "count": bson.M{"$sum": 1}}}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row struct {
				ID    string `bson:"_id"`
				Count int    `bson:"count"`
			}
			if cur.Decode(&row) == nil {
				funnel[row.ID] = row.Count
			}
		}
	}

	// Top categories by number of (non-deleted) elons.
	type nameCount struct {
		Name  string `json:"name" bson:"_id"`
		Count int    `json:"count" bson:"count"`
	}
	topCats := []nameCount{}
	if cur, err := h.Elons.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: notDeletedNotReview()}},
		{{Key: "$group", Value: bson.M{"_id": "$categoryName", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.M{"count": -1}}},
		{{Key: "$limit", Value: 5}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row nameCount
			if cur.Decode(&row) == nil {
				topCats = append(topCats, row)
			}
		}
	}

	// Users per region (top 10).
	regions := []nameCount{}
	if cur, err := h.Users.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: mergeFilter(notDeletedNotReview(), bson.M{"region": bson.M{"$nin": bson.A{"", nil}}})}},
		{{Key: "$group", Value: bson.M{"_id": "$region", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.M{"count": -1}}},
		{{Key: "$limit", Value: 10}},
	}); err == nil {
		defer cur.Close(ctx)
		for cur.Next(ctx) {
			var row nameCount
			if cur.Decode(&row) == nil {
				regions = append(regions, row)
			}
		}
	}

	httpx.JSON(w, 200, map[string]any{
		"userGrowth":    dailySeries(ctx, h.Users, days),
		"elonGrowth":    dailySeries(ctx, h.Elons, days),
		"funnel":        funnel,
		"topCategories": topCats,
		"regions":       regions,
	})
}
