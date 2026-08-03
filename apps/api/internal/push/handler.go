package push

import (
	"net/http"
	"strings"
	"time"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Handler qurilma FCM tokenlarini ro'yxatga oladi/o'chiradi. Push yuborish
// FCM tipida (fcm.go); bu handler faqat token hayot aylanishi.
type Handler struct {
	Col *mongo.Collection
}

func NewHandler(db *mongo.Database) *Handler {
	return &Handler{Col: db.Collection("device_tokens")}
}

type registerReq struct {
	Token    string `json:"token"`
	Platform string `json:"platform"` // android|ios
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	uid, err := primitive.ObjectIDFromHex(httpx.UserID(r))
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "unauthorized", "unauthorized"))
		return
	}
	var req registerReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" || len(req.Token) > 4096 {
		httpx.Err(w, httpx.NewError(400, "bad_token", "token kerak"))
		return
	}
	if req.Platform != "ios" {
		req.Platform = "android"
	}
	// Upsert token bo'yicha: bitta qurilmada akkaunt almashsa, token yangi
	// egasiga ko'chadi — eski egaga begona push ketib qolmaydi.
	now := time.Now()
	_, err = h.Col.UpdateOne(r.Context(),
		bson.M{"token": req.Token},
		bson.M{
			"$set":         bson.M{"userId": uid, "platform": req.Platform, "updatedAt": now},
			"$setOnInsert": bson.M{"createdAt": now},
		},
		options.Update().SetUpsert(true))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type unregisterReq struct {
	Token string `json:"token"`
}

func (h *Handler) Unregister(w http.ResponseWriter, r *http.Request) {
	uid, err := primitive.ObjectIDFromHex(httpx.UserID(r))
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "unauthorized", "unauthorized"))
		return
	}
	var req unregisterReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" {
		httpx.Err(w, httpx.NewError(400, "bad_token", "token kerak"))
		return
	}
	// Faqat o'z tokenini o'chira oladi (token+userId juftligi bo'yicha).
	_, err = h.Col.DeleteOne(r.Context(), bson.M{"token": req.Token, "userId": uid})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
