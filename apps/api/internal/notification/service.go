package notification

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Pusher pushes a serialized notification to any online WS clients for a user.
type Pusher interface {
	PushUser(userID primitive.ObjectID, kind string, payload any)
}

type Service struct {
	Col *mongo.Collection
	// Users backs the review-sandbox check in Push. Optional: when nil, Push
	// simply drops anything the review account would have triggered.
	Users  *mongo.Collection
	Pusher Pusher
}

func New(db *mongo.Database) *Service {
	return &Service{
		Col:   db.Collection("notifications"),
		Users: db.Collection("users"),
	}
}

func (s *Service) AttachPusher(p Pusher) { s.Pusher = p }

func (s *Service) Push(ctx context.Context, userID primitive.ObjectID, typ, title, body string, rel *models.RelatedEntity) {
	// Sandbox choke point for the Google Play review account.
	//
	// Every notification in the app funnels through here, so this single check
	// is what guarantees requirement "a real user must never notice that a
	// review account exists": whatever the reviewer does — applying to a real
	// elon, accepting, cancelling — nothing is ever delivered to a real person.
	// Traffic between the review account and its seeded demo counterparties
	// still flows, so the reviewer sees notifications working.
	//
	// Fails closed: if the recipient cannot be resolved, the notification is
	// dropped rather than delivered.
	if httpx.IsReviewActor(ctx) && !s.recipientIsReviewAccount(ctx, userID) {
		return
	}
	n := models.Notification{
		UserID: userID, Type: typ, Title: title, Body: body,
		RelatedEntity: rel, IsRead: false, CreatedAt: time.Now(),
	}
	res, err := s.Col.InsertOne(ctx, n)
	if err == nil {
		if oid, ok := res.InsertedID.(primitive.ObjectID); ok {
			n.ID = oid
		}
	} else {
		// Best-effort bo'lib qoladi (chaqiruvchini yiqitmaymiz), lekin jim
		// yutilmasin: insert yiqilsa foydalanuvchi bildirishnomani umuman
		// ko'rmaydi — buni logsiz payqash iloji yo'q edi.
		slog.Error("notification insert failed", "type", typ, "user", userID.Hex(), "err", err)
	}
	if s.Pusher != nil {
		s.Pusher.PushUser(userID, "notification", n)
	}
}

// recipientIsReviewAccount reports whether a notification target is part of the
// review sandbox. Only consulted for review-actor traffic, so it adds no query
// to the normal path.
func (s *Service) recipientIsReviewAccount(ctx context.Context, userID primitive.ObjectID) bool {
	if s.Users == nil {
		return false
	}
	var u models.User
	err := s.Users.FindOne(ctx,
		bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{"isReviewAccount": 1}),
	).Decode(&u)
	return err == nil && u.IsReviewAccount
}

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	// Ixtiyoriy limit/page. Paramsiz eski klientlar avvalgidek eng yangi 200
	// tasini oladi (javob shakli o'zgarmagan — oddiy massiv).
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	cur, err := s.Col.Find(r.Context(),
		bson.M{"userId": uid},
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}}).
			SetSkip(int64((page-1)*limit)).
			SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Notification{}
	for cur.Next(r.Context()) {
		var n models.Notification
		if err := cur.Decode(&n); err == nil {
			out = append(out, n)
		}
	}
	httpx.JSON(w, 200, out)
}

func (s *Service) ReadAll(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	if _, err := s.Col.UpdateMany(r.Context(), bson.M{"userId": uid, "isRead": false}, bson.M{"$set": bson.M{"isRead": true}}); err != nil {
		slog.Error("notification readAll failed", "user", uid.Hex(), "err", err)
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type readReq struct {
	RelatedIDs  []string `json:"relatedIds"`
	RelatedType string   `json:"relatedType"`
}

// Read marks a targeted subset of the user's unread notifications read — either
// those tied to specific related entities (relatedIds) or a whole related type
// (relatedType, e.g. "application"). Used to clear the "red dot" indicators as
// the user views the corresponding items.
func (s *Service) Read(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req readReq
	_ = httpx.Decode(r, &req)
	filter := bson.M{"userId": uid, "isRead": false}
	switch {
	case len(req.RelatedIDs) > 0:
		oids := make([]primitive.ObjectID, 0, len(req.RelatedIDs))
		for _, h := range req.RelatedIDs {
			if oid, err := primitive.ObjectIDFromHex(h); err == nil {
				oids = append(oids, oid)
			}
		}
		if len(oids) == 0 {
			httpx.JSON(w, 200, map[string]bool{"ok": true})
			return
		}
		filter["relatedEntity.id"] = bson.M{"$in": oids}
	case req.RelatedType != "":
		filter["relatedEntity.type"] = req.RelatedType
	default:
		httpx.Err(w, httpx.NewError(400, "bad_request", "relatedIds yoki relatedType kerak"))
		return
	}
	if _, err := s.Col.UpdateMany(r.Context(), filter, bson.M{"$set": bson.M{"isRead": true}}); err != nil {
		slog.Error("notification read failed", "user", uid.Hex(), "err", err)
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
