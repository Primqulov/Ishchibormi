package report

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Col           *mongo.Collection
	Admins        *mongo.Collection
	Notifications *mongo.Collection
}

func NewHandler(db *mongo.Database) *Handler {
	return &Handler{
		Col:           db.Collection("reports"),
		Admins:        db.Collection("admins"),
		Notifications: db.Collection("notifications"),
	}
}

type createReq struct {
	TargetType  string `json:"targetType" validate:"required"`
	TargetID    string `json:"targetId" validate:"required"`
	Reason      string `json:"reason" validate:"required"`
	Description string `json:"description"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req createReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if req.TargetType != "user" && req.TargetType != "elon" && req.TargetType != "message" {
		httpx.Err(w, httpx.NewError(400, "bad_target_type", "bad targetType"))
		return
	}
	tid, err := primitive.ObjectIDFromHex(req.TargetID)
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad targetId"))
		return
	}
	rep := models.Report{
		ReporterID: uid, TargetType: req.TargetType, TargetID: tid,
		Reason: req.Reason, Description: req.Description,
		Status: "open", CreatedAt: time.Now(),
	}
	res, err := h.Col.InsertOne(r.Context(), rep)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	rep.ID = res.InsertedID.(primitive.ObjectID)
	// notify all active admins
	cur, _ := h.Admins.Find(r.Context(), bson.M{"isActive": true})
	if cur != nil {
		defer cur.Close(r.Context())
		for cur.Next(r.Context()) {
			var a models.Admin
			if err := cur.Decode(&a); err == nil {
				_, _ = h.Notifications.InsertOne(r.Context(), models.Notification{
					UserID: a.ID, Type: "report_received", Title: "Yangi shikoyat",
					Body: req.Reason, IsRead: false, CreatedAt: time.Now(),
				})
			}
		}
	}
	httpx.JSON(w, 201, rep)
}

// Admin endpoints
func (h *Handler) ListAdmin(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Col.Find(r.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Report{}
	for cur.Next(r.Context()) {
		var rp models.Report
		if err := cur.Decode(&rp); err == nil {
			out = append(out, rp)
		}
	}
	httpx.JSON(w, 200, out)
}

type resolveReq struct {
	Status string `json:"status"` // resolved|dismissed
}

func (h *Handler) Resolve(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req resolveReq
	_ = httpx.Decode(r, &req)
	if req.Status != "resolved" && req.Status != "dismissed" {
		httpx.Err(w, httpx.NewError(400, "bad_status", "bad status"))
		return
	}
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	now := time.Now()
	_, err = h.Col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{
		"status":     req.Status,
		"reviewedBy": aid,
		"reviewedAt": now,
	}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]string{"status": req.Status})
}
