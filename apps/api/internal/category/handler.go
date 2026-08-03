package category

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Col           *mongo.Collection
	Notifications *mongo.Collection
	Admins        *mongo.Collection
}

func NewHandler(db *mongo.Database) *Handler {
	return &Handler{
		Col:           db.Collection("categories"),
		Notifications: db.Collection("notifications"),
		Admins:        db.Collection("admins"),
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Col.Find(r.Context(),
		bson.M{"isActive": true},
		options.Find().SetSort(bson.D{{Key: "usageCount", Value: -1}, {Key: "name", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Category{}
	for cur.Next(r.Context()) {
		var c models.Category
		if err := cur.Decode(&c); err == nil {
			out = append(out, c)
		}
	}
	httpx.JSON(w, 200, out)
}

type createReq struct {
	Name string `json:"name" validate:"required"`
	Icon string `json:"icon"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req createReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "name required"))
		return
	}
	slug := Slugify(name)
	// idempotent by slug
	existing := models.Category{}
	if err := h.Col.FindOne(r.Context(), bson.M{"slug": slug}).Decode(&existing); err == nil {
		httpx.JSON(w, 200, existing)
		return
	}
	c := models.Category{
		Name:      name,
		Slug:      slug,
		Icon:      req.Icon,
		CreatedBy: uid,
		IsActive:  true,
		CreatedAt: time.Now(),
	}
	res, err := h.Col.InsertOne(r.Context(), c)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	c.ID = res.InsertedID.(primitive.ObjectID)
	// Notify all admins (fire-and-forget, but with its own context).
	go h.notifyAdmins(context.Background(), name)
	httpx.JSON(w, 201, c)
}

func (h *Handler) notifyAdmins(ctx context.Context, name string) {
	cur, err := h.Admins.Find(ctx, bson.M{"isActive": true})
	if err != nil || cur == nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Admin
		if err := cur.Decode(&a); err == nil {
			_, _ = h.Notifications.InsertOne(ctx, models.Notification{
				UserID:    a.ID,
				Type:      "category_added",
				Title:     "Yangi turkum qo'shildi",
				Body:      name,
				IsRead:    false,
				CreatedAt: time.Now(),
			})
		}
	}
}

// Slugify converts an Uzbek name into a URL-safe slug.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var sb strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			sb.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				sb.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(sb.String(), "-")
	if out == "" {
		out = "cat"
	}
	return out
}

// IncrementUsage bumps usageCount when an elon is created.
func IncrementUsage(ctx context.Context, col *mongo.Collection, id primitive.ObjectID) {
	_, _ = col.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$inc": bson.M{"usageCount": 1}})
}
