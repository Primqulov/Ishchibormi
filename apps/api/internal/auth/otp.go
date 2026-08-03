package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// maxOTPAttempts is the number of wrong code guesses allowed against a single
// OTP record before it is invalidated. This bounds online brute-force of the
// 6-digit code even if an attacker knows the bound token/phone.
const maxOTPAttempts = 5

type OTPRepo struct {
	Col *mongo.Collection
	TTL time.Duration
	Len int
}

func NewOTPRepo(db *mongo.Database, ttl time.Duration, length int) *OTPRepo {
	return &OTPRepo{Col: db.Collection("otp_codes"), TTL: ttl, Len: length}
}

// RequestToken creates a fresh tgToken (used as Telegram deep-link payload).
// The bot, on /start <token>, fills in the user's telegramId/phone and the OTP code.
func (r *OTPRepo) RequestToken(ctx context.Context) (string, error) {
	tok := randHex(16)
	_, err := r.Col.InsertOne(ctx, models.OTPCode{
		TGToken:   tok,
		ExpiresAt: time.Now().Add(r.TTL),
		CreatedAt: time.Now(),
	})
	return tok, err
}

// BindPhoneAndIssueCode is called by the bot. It finds the most recent unused
// record matching the token (or creates one if the bot was opened directly),
// then generates an OTP code and persists it.
func (r *OTPRepo) BindPhoneAndIssueCode(ctx context.Context, token, phone string, tgID int64) (string, error) {
	code, err := randDigits(r.Len)
	if err != nil {
		return "", err
	}
	now := time.Now()
	if token != "" {
		res := r.Col.FindOneAndUpdate(ctx,
			bson.M{"tgToken": token, "used": false, "expiresAt": bson.M{"$gt": now}},
			bson.M{"$set": bson.M{
				"phone":      phone,
				"telegramId": tgID,
				"code":       code,
				"expiresAt":  now.Add(r.TTL),
			}})
		if res.Err() == nil {
			return code, nil
		}
		// fallthrough: insert new (bot opened without token)
	}
	_, err = r.Col.InsertOne(ctx, models.OTPCode{
		TGToken:    "",
		Phone:      phone,
		TelegramID: tgID,
		Code:       code,
		ExpiresAt:  now.Add(r.TTL),
		CreatedAt:  now,
	})
	return code, err
}

// VerifyByToken: web-side verification using token + code, returns the bound (phone, tgID).
// Only succeeds while the record still has attempts remaining; every wrong guess
// burns one attempt, and after maxOTPAttempts the code is invalidated.
func (r *OTPRepo) VerifyByToken(ctx context.Context, token, code string) (string, int64, error) {
	now := time.Now()
	res := r.Col.FindOneAndUpdate(ctx,
		// $not/$gte (rather than $lt) so records written without an "attempts"
		// field (missing == 0 attempts) still match.
		bson.M{"tgToken": token, "code": code, "used": false, "expiresAt": bson.M{"$gt": now},
			"attempts": bson.M{"$not": bson.M{"$gte": maxOTPAttempts}}},
		bson.M{"$set": bson.M{"used": true}})
	if err := res.Err(); err != nil {
		// Wrong/expired code: charge one attempt against the live record so the
		// code locks out after maxOTPAttempts guesses.
		_, _ = r.Col.UpdateOne(ctx,
			bson.M{"tgToken": token, "used": false, "expiresAt": bson.M{"$gt": now}},
			bson.M{"$inc": bson.M{"attempts": 1}})
		return "", 0, errors.New("invalid_or_expired_code")
	}
	var doc models.OTPCode
	if err := res.Decode(&doc); err != nil {
		return "", 0, err
	}
	return doc.Phone, doc.TelegramID, nil
}

// VerifyByPhone: alternative verification path (when web has no token).
func (r *OTPRepo) VerifyByPhone(ctx context.Context, phone, code string) (string, int64, error) {
	if phone == "" {
		return "", 0, errors.New("invalid_or_expired_code")
	}
	now := time.Now()
	res := r.Col.FindOneAndUpdate(ctx,
		bson.M{"phone": phone, "code": code, "used": false, "expiresAt": bson.M{"$gt": now},
			"attempts": bson.M{"$not": bson.M{"$gte": maxOTPAttempts}}},
		bson.M{"$set": bson.M{"used": true}})
	if err := res.Err(); err != nil {
		_, _ = r.Col.UpdateOne(ctx,
			bson.M{"phone": phone, "used": false, "expiresAt": bson.M{"$gt": now}},
			bson.M{"$inc": bson.M{"attempts": 1}})
		return "", 0, errors.New("invalid_or_expired_code")
	}
	var doc models.OTPCode
	if err := res.Decode(&doc); err != nil {
		return "", 0, err
	}
	return doc.Phone, doc.TelegramID, nil
}

// HasLiveBoundCode reports whether this token has a live OTP record that the
// bot has already bound a phone number to — i.e. whether a real Telegram login
// is genuinely in flight for it.
//
// It exists to keep ordinary users out of the review-login guess budget. A user
// who opened the bot and then mistyped their code has a bound record here, so
// their failure is a plain typo and never reaches the review comparison. A Play
// reviewer (and equally anyone probing for the review code) never opens the bot
// at all, so their token stays unbound. See Handler.tryReviewLogin.
func (r *OTPRepo) HasLiveBoundCode(ctx context.Context, token string) bool {
	if token == "" {
		return false
	}
	n, err := r.Col.CountDocuments(ctx, bson.M{
		"tgToken":   token,
		"used":      false,
		"expiresAt": bson.M{"$gt": time.Now()},
		"phone":     bson.M{"$nin": []any{nil, ""}},
	})
	return err == nil && n > 0
}

// LatestForToken returns the most recent code for a given token (dev mode helper).
func (r *OTPRepo) LatestForToken(ctx context.Context, token string) (*models.OTPCode, error) {
	var doc models.OTPCode
	err := r.Col.FindOne(ctx, bson.M{"tgToken": token}).Decode(&doc)
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func randDigits(n int) (string, error) {
	digits := "0123456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	var sb strings.Builder
	for _, x := range b {
		sb.WriteByte(digits[int(x)%len(digits)])
	}
	return sb.String(), nil
}
