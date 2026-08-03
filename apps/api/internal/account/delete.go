// Package account implements user-initiated account deletion.
//
// Flow: the app calls POST /api/me/delete/request, which mints a one-time code
// and pushes it to the user's Telegram chat (the same chat they logged in
// through). The user types that code into POST /api/me/delete/confirm, which
// soft-deletes the account. Requiring a code that only reaches Telegram means a
// stolen/borrowed phone with an unlocked app still cannot nuke the account.
//
// If the code cannot be delivered — the user never pressed /start, or blocked
// the bot — the request endpoint answers 200 with sent:false plus the bot's
// deep link, and the client tells the user to open the bot, press start, and hit
// delete again.
package account

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"github.com/ishchibormi/backend/pkg/tgsend"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	// deleteCodeTTL is deliberately longer than the login OTP's 3 minutes: this
	// code is mixed-case with punctuation and gets typed by hand.
	deleteCodeTTL = 10 * time.Minute

	// maxAttempts bounds online guessing of a single issued code.
	maxAttempts = 5
)

type Handler struct {
	cfg     config.Config
	users   *mongo.Collection
	elons   *mongo.Collection
	apps    *mongo.Collection
	codes   *mongo.Collection
	storage *storage.Service
	tg      *tgsend.Client
}

func NewHandler(cfg config.Config, db *mongo.Database, s *storage.Service) *Handler {
	return &Handler{
		cfg:     cfg,
		users:   db.Collection("users"),
		elons:   db.Collection("elons"),
		apps:    db.Collection("applications"),
		codes:   db.Collection("delete_codes"),
		storage: s,
		tg:      tgsend.New(cfg.TelegramBotToken),
	}
}

type requestResp struct {
	Sent bool `json:"sent"`
	// BotURL is only set when Sent is false — it's what the client shows as
	// "open this bot and press start".
	BotURL string `json:"botUrl,omitempty"`
	// ExpiresInSeconds lets the client run a countdown without a clock skew fix.
	ExpiresInSeconds int `json:"expiresInSeconds,omitempty"`
	// CodeLength lets the client size its code input from the server's truth.
	CodeLength int `json:"codeLength"`
}

// RequestDelete mints a deletion code and pushes it to the caller's Telegram.
func (h *Handler) RequestDelete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, err := primitive.ObjectIDFromHex(httpx.UserID(r))
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "bad_token", "bad user id"))
		return
	}
	var u models.User
	if err := h.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}

	code, err := generateCode()
	if err != nil {
		httpx.Err(w, err)
		return
	}
	now := time.Now()
	// One live code per user: re-requesting replaces the previous code rather
	// than leaving several valid at once.
	_, err = h.codes.UpdateOne(ctx,
		bson.M{"userId": uid},
		bson.M{
			"$set": bson.M{
				"code": code, "used": false, "attempts": 0,
				"expiresAt": now.Add(deleteCodeTTL), "createdAt": now,
			},
		},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		httpx.Err(w, err)
		return
	}

	if err := h.tg.SendHTML(ctx, u.TelegramID, deleteCodeMessage(code)); err != nil {
		if errors.Is(err, tgsend.ErrUnreachable) {
			httpx.JSON(w, 200, requestResp{Sent: false, BotURL: h.botURL(), CodeLength: CodeLength})
			return
		}
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, requestResp{
		Sent:             true,
		ExpiresInSeconds: int(deleteCodeTTL / time.Second),
		CodeLength:       CodeLength,
	})
}

// deleteCodeMessage builds the Telegram message. The code goes inside <code>…</code>
// so Telegram renders it tap-to-copy, and is HTML-escaped because the alphabet
// contains characters the parser would otherwise choke on.
func deleteCodeMessage(code string) string {
	return "⚠️ <b>Hisobni o'chirish</b>\n\n" +
		"Hisobingizni o'chirish so'raldi. Tasdiqlash kodi:\n\n" +
		"<code>" + tgsend.EscapeHTML(code) + "</code>\n\n" +
		"(Nusxalash uchun kodning ustiga bosing.)\n" +
		"Kod " + strconv.Itoa(int(deleteCodeTTL/time.Minute)) + " daqiqa amal qiladi. " +
		"Katta va kichik harflar farqlanadi.\n\n" +
		"Agar bu siz bo'lmasangiz — bu xabarni e'tiborsiz qoldiring, hisobingiz o'chirilmaydi."
}

// botURL is the deep link shown when the code could not be delivered.
func (h *Handler) botURL() string {
	if h.cfg.TelegramBotUsername == "" {
		return ""
	}
	return "https://t.me/" + h.cfg.TelegramBotUsername
}

type confirmReq struct {
	Code string `json:"code"`
}

// ConfirmDelete validates the code and soft-deletes the account.
func (h *Handler) ConfirmDelete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, err := primitive.ObjectIDFromHex(httpx.UserID(r))
	if err != nil {
		httpx.Err(w, httpx.NewError(401, "bad_token", "bad user id"))
		return
	}
	var req confirmReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if req.Code == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "code required"))
		return
	}

	now := time.Now()
	// Case-sensitive exact match — the code's mixed case is part of its entropy.
	// $not/$gte so records missing an "attempts" field still match.
	res := h.codes.FindOneAndUpdate(ctx,
		bson.M{
			"userId": uid, "code": req.Code, "used": false,
			"expiresAt": bson.M{"$gt": now},
			"attempts":  bson.M{"$not": bson.M{"$gte": maxAttempts}},
		},
		bson.M{"$set": bson.M{"used": true}},
	)
	if res.Err() != nil {
		// Charge the wrong guess against the live code so it locks out.
		_, _ = h.codes.UpdateOne(ctx,
			bson.M{"userId": uid, "used": false, "expiresAt": bson.M{"$gt": now}},
			bson.M{"$inc": bson.M{"attempts": 1}})
		httpx.Err(w, httpx.NewError(401, "invalid_code", "invalid or expired code"))
		return
	}

	if err := h.softDelete(ctx, uid); err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// softDelete mirrors admin.DeleteUser (isDeleted flag + best-effort storage
// cleanup) and additionally winds down the user's marketplace footprint so a
// deleted account leaves no live listings or pending applications behind.
func (h *Handler) softDelete(ctx context.Context, uid primitive.ObjectID) error {
	// Storage cleanup is best-effort and detached: a slow/failing S3 delete must
	// not block or fail the account deletion itself.
	var u models.User
	if err := h.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err == nil {
		go upload.DeleteByURL(h.storage, u.AvatarURL)
	}
	if cur, err := h.elons.Find(ctx, bson.M{"ownerId": uid}); err == nil {
		defer func() { _ = cur.Close(ctx) }()
		for cur.Next(ctx) {
			var e models.Elon
			if err := cur.Decode(&e); err == nil {
				for _, img := range e.Images {
					go upload.DeleteByURL(h.storage, img)
				}
			}
		}
	}

	now := time.Now()
	// Take the listings out of the feed.
	if _, err := h.elons.UpdateMany(ctx,
		bson.M{"ownerId": uid, "isDeleted": bson.M{"$ne": true}},
		bson.M{"$set": bson.M{"isDeleted": true, "status": "cancelled", "updatedAt": now}},
	); err != nil {
		return err
	}
	// Cancel anything still in flight, on both sides of the marketplace, so the
	// counterparty sees a resolved state instead of an application that can
	// never progress.
	live := []string{"pending", "accepted"}
	if _, err := h.apps.UpdateMany(ctx,
		bson.M{"workerId": uid, "status": bson.M{"$in": live}},
		bson.M{"$set": bson.M{
			"status": "cancelled", "cancelledBy": "worker",
			"cancelReason": "account_deleted", "decidedAt": now,
		}},
	); err != nil {
		return err
	}
	if _, err := h.apps.UpdateMany(ctx,
		bson.M{"employerId": uid, "status": bson.M{"$in": live}},
		bson.M{"$set": bson.M{
			"status": "cancelled", "cancelledBy": "employer",
			"cancelReason": "account_deleted", "decidedAt": now,
		}},
	); err != nil {
		return err
	}

	// Finally flip the account itself and release its identity.
	//
	// Unsetting phone/telegramId drops this document out of the unique-sparse
	// indexes on those fields, which is what lets the same number sign up again:
	// auth.upsertUser filters on {phone}, finds nothing, and inserts a brand-new
	// account with a fresh _id. The old profile, listings, applications, reviews
	// and ratings stay keyed to the old id, so the returning user starts clean
	// and never sees their previous data. Unsetting (not blanking) matters —
	// phone has no omitempty, so writing "" would keep the document in the
	// unique index and the second deleted account would collide with the first.
	//
	// The values are copied to deleted* so support can still trace the account.
	set := bson.M{"isDeleted": true, "updatedAt": now, "deletedAt": now}
	if u.Phone != "" {
		set["deletedPhone"] = u.Phone
	}
	if u.TelegramID != 0 {
		set["deletedTelegramId"] = u.TelegramID
	}
	// RequireActiveUser rejects every subsequent request from the old JWT.
	_, err := h.users.UpdateOne(ctx,
		bson.M{"_id": uid},
		bson.M{
			"$set":   set,
			"$unset": bson.M{"phone": "", "telegramId": ""},
		})
	// O'chirilgan hisobga push ketmasligi uchun qurilma tokenlari ham ketadi
	// (masalan, keyinroq yuboriladigan broadcast'lar). Best-effort.
	_, _ = h.users.Database().Collection("device_tokens").DeleteMany(ctx, bson.M{"userId": uid})
	return err
}
