package feedback

import (
	"net/http"
	"strings"
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
	Users         *mongo.Collection
	Admins        *mongo.Collection
	Notifications *mongo.Collection
}

func NewHandler(db *mongo.Database) *Handler {
	return &Handler{
		Col:           db.Collection("feedback"),
		Users:         db.Collection("users"),
		Admins:        db.Collection("admins"),
		Notifications: db.Collection("notifications"),
	}
}

type createReq struct {
	Type    string `json:"type"` // suggestion|complaint
	Subject string `json:"subject"`
	Message string `json:"message"`
}

// Create — foydalanuvchi taklif yoki shikoyat yuboradi.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req createReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "message required"))
		return
	}
	ftype := req.Type
	if ftype != "suggestion" && ftype != "complaint" {
		ftype = "suggestion"
	}

	var u models.User
	_ = h.Users.FindOne(r.Context(), bson.M{"_id": uid}).Decode(&u)

	fb := models.Feedback{
		UserID:    uid,
		UserName:  strings.TrimSpace(u.FirstName + " " + u.LastName),
		UserPhone: u.Phone,
		Type:      ftype,
		Subject:   strings.TrimSpace(req.Subject),
		Message:   msg,
		Status:    "open",
		CreatedAt: time.Now(),
	}
	res, err := h.Col.InsertOne(r.Context(), fb)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	fb.ID = res.InsertedID.(primitive.ObjectID)

	// Barcha faol adminlarga bildirishnoma.
	title := "Yangi taklif"
	if ftype == "complaint" {
		title = "Yangi shikoyat"
	}
	cur, _ := h.Admins.Find(r.Context(), bson.M{"isActive": true})
	if cur != nil {
		defer cur.Close(r.Context())
		for cur.Next(r.Context()) {
			var a models.Admin
			if err := cur.Decode(&a); err == nil {
				_, _ = h.Notifications.InsertOne(r.Context(), models.Notification{
					UserID: a.ID, Type: "feedback_received", Title: title,
					Body: msg, IsRead: false, CreatedAt: time.Now(),
				})
			}
		}
	}
	httpx.JSON(w, 201, fb)
}

// Mine — foydalanuvchining o'z taklif/shikoyatlari.
func (h *Handler) Mine(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	cur, err := h.Col.Find(r.Context(), bson.M{"userId": uid},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Feedback{}
	for cur.Next(r.Context()) {
		var fb models.Feedback
		if err := cur.Decode(&fb); err == nil {
			out = append(out, fb)
		}
	}
	httpx.JSON(w, 200, out)
}

// ListAdmin — admin uchun barcha taklif/shikoyatlar.
func (h *Handler) ListAdmin(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Col.Find(r.Context(), bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Feedback{}
	for cur.Next(r.Context()) {
		var fb models.Feedback
		if err := cur.Decode(&fb); err == nil {
			out = append(out, fb)
		}
	}
	httpx.JSON(w, 200, out)
}

// Resolve — admin taklif/shikoyatni hal qilingan deb belgilaydi.
func (h *Handler) Resolve(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	now := time.Now()
	_, err = h.Col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{
		"status":     "resolved",
		"reviewedBy": aid,
		"reviewedAt": now,
	}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]string{"status": "resolved"})
}
