package admin

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// validRoles enumerates the admin roles the panel understands. Kept in sync with
// the RBAC guards wired in cmd/api/main.go and the seed.
var validRoles = map[string]bool{"superadmin": true, "moderator": true, "support": true}

type Handler struct {
	Cfg        config.Config
	Admins     *mongo.Collection
	Users      *mongo.Collection
	Elons      *mongo.Collection
	Cats       *mongo.Collection
	Reports    *mongo.Collection
	Feedback   *mongo.Collection
	AuditCol   *mongo.Collection
	Broadcasts *mongo.Collection
	Notify     *notification.Service
	Apps       *mongo.Collection
	Storage    *storage.Service
}

func NewHandler(cfg config.Config, db *mongo.Database, n *notification.Service, s *storage.Service) *Handler {
	return &Handler{
		Cfg:        cfg,
		Admins:     db.Collection("admins"),
		Users:      db.Collection("users"),
		Elons:      db.Collection("elons"),
		Cats:       db.Collection("categories"),
		Reports:    db.Collection("reports"),
		Feedback:   db.Collection("feedback"),
		AuditCol:   db.Collection("admin_audit"),
		Broadcasts: db.Collection("broadcasts"),
		Notify:     n,
		Apps:       db.Collection("applications"),
		Storage:    s,
	}
}

// pageParams reads ?page & ?limit with safe bounds (1-based page, 1..100 limit,
// default 20) and returns the Mongo skip for that page.
func pageParams(r *http.Request) (page, limit int, skip int64) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return page, limit, int64((page - 1) * limit)
}

// paged is the standard shape for admin list responses, matching the public
// feed ({items,page,limit,total}) so the frontend can paginate uniformly.
func paged(w http.ResponseWriter, items any, page, limit int, total int64) {
	httpx.JSON(w, 200, map[string]any{"items": items, "page": page, "limit": limit, "total": total})
}

// escRe safely quotes free-text search input for use inside a MongoDB $regex so
// a user-supplied "." or "(" can't change the match semantics or cause errors.
func escRe(s string) string { return regexp.QuoteMeta(s) }

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugify builds a URL-safe slug from a category name (lowercase, non-alnum -> "-").
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func startOfToday() time.Time {
	n := time.Now()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, n.Location())
}

// find decodes up to `limit` documents matching `filter`, newest first by
// `sortField`. Errors yield an empty (non-nil) slice — the admin detail view
// prefers partial data over a hard failure.
func find[T any](ctx context.Context, col *mongo.Collection, filter bson.M, sortField string, limit int64) []T {
	out := []T{}
	cur, err := col.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: sortField, Value: -1}}).SetLimit(limit))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var v T
		if cur.Decode(&v) == nil {
			out = append(out, v)
		}
	}
	return out
}

func decodeElons(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Elon {
	return find[models.Elon](ctx, col, f, "createdAt", n)
}

func decodeApps(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Application {
	return find[models.Application](ctx, col, f, "appliedAt", n)
}

func decodeReports(ctx context.Context, col *mongo.Collection, f bson.M, n int64) []models.Report {
	return find[models.Report](ctx, col, f, "createdAt", n)
}

// auditRaw writes an audit entry with an explicit admin id (used where the admin
// isn't yet in the request context, e.g. login attempts).
func (h *Handler) auditRaw(ctx context.Context, adminID primitive.ObjectID, action, target, detail string) {
	_, _ = h.AuditCol.InsertOne(ctx, models.AdminAudit{
		AdminID: adminID, Action: action, Target: target, Detail: detail, CreatedAt: time.Now(),
	})
}

func (h *Handler) audit(r *http.Request, action, target, detail string) {
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	h.auditRaw(r.Context(), aid, action, target, detail)
}

func loadUserMap(ctx context.Context, col *mongo.Collection, ids map[primitive.ObjectID]bool) map[primitive.ObjectID]models.User {
	out := map[primitive.ObjectID]models.User{}
	if len(ids) == 0 {
		return out
	}
	list := make([]primitive.ObjectID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	cur, err := col.Find(ctx, bson.M{"_id": bson.M{"$in": list}})
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) == nil {
			out[u.ID] = u
		}
	}
	return out
}

func loadElonMap(ctx context.Context, col *mongo.Collection, ids map[primitive.ObjectID]bool) map[primitive.ObjectID]models.Elon {
	out := map[primitive.ObjectID]models.Elon{}
	if len(ids) == 0 {
		return out
	}
	list := make([]primitive.ObjectID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	cur, err := col.Find(ctx, bson.M{"_id": bson.M{"$in": list}})
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var e models.Elon
		if cur.Decode(&e) == nil {
			out[e.ID] = e
		}
	}
	return out
}
