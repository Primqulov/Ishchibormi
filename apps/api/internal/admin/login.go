package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/totp"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"golang.org/x/crypto/bcrypt"
)

// dummyHash is a real bcrypt hash of a value nobody knows, compared against
// whenever the submitted username does not exist. Without it the handler
// returns in microseconds for an unknown account and in ~100ms (a full bcrypt
// round) for a real one, which is a reliable oracle for enumerating admin
// usernames before ever guessing a password.
var dummyHash = []byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy")

type loginReq struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
	Code     string `json:"code"` // TOTP code, only when 2FA is enabled
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	if req.Username == "" || len(req.Username) > 100 || len(req.Password) == 0 || len(req.Password) > 128 ||
		(len(req.Code) > 0 && len(strings.TrimSpace(req.Code)) != 6) {
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	// Per-account budget, checked before the database is touched. The IP-keyed
	// limiter in front of this route caps one source; this caps one target, so
	// spreading the guesses over many addresses buys the attacker nothing.
	now := time.Now()
	if h.loginGuard.exhausted(req.Username, now) {
		h.auditRaw(r.Context(), primitive.NilObjectID, "login_throttled", req.Username, "account login budget exhausted")
		httpx.Err(w, httpx.NewError(429, "rate_limited", "too many failed attempts, try again later"))
		return
	}

	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"username": req.Username, "isActive": true}).Decode(&a); err != nil {
		// Spend the same time as a real account would, then fail identically.
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Password))
		h.loginGuard.recordFailure(req.Username, now)
		h.auditRaw(r.Context(), primitive.NilObjectID, "login_failed", req.Username, "no such active admin")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(req.Password)); err != nil {
		h.loginGuard.recordFailure(req.Username, now)
		h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad password")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	// Second factor. When enabled, a valid TOTP code is required. A missing code
	// returns "totp_required" so the client can prompt for it, then resubmit.
	// A missing code is NOT charged against the budget — it is the documented
	// first leg of a two-step login, not a failed guess.
	if a.TOTPEnabled {
		if strings.TrimSpace(req.Code) == "" {
			httpx.Err(w, httpx.NewError(401, "totp_required", "2FA code required"))
			return
		}
		// Replay-protected: a code is accepted once and then burnt, so knowing
		// the password plus a code that was already used gets nowhere.
		counter, ok := totp.ValidateCounter(a.TOTPSecret, req.Code, a.TOTPLastCounter)
		if !ok {
			h.loginGuard.recordFailure(req.Username, now)
			h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad or reused 2FA code")
			httpx.Err(w, httpx.NewError(401, "bad_totp", "invalid 2FA code"))
			return
		}
		if err := h.burnTOTPCounter(r, a.ID, a.TOTPLastCounter, counter); err != nil {
			// Losing the race means another request just consumed this same
			// code. Refuse rather than let both through.
			h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "2FA code already consumed")
			httpx.Err(w, httpx.NewError(401, "bad_totp", "invalid 2FA code"))
			return
		}
	}
	tok, err := httpx.IssueVersionedAdminToken(h.Cfg.JWTAccessSecret, a.ID.Hex(), a.Role, a.TokenVersion, h.Cfg.JWTAdminTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.loginGuard.clear(req.Username)
	h.auditRaw(r.Context(), a.ID, "login_success", a.Username, "")
	httpx.JSON(w, 200, map[string]any{"accessToken": tok, "admin": a})
}

// burnTOTPCounter advances the admin's replay high-water mark, but only if it
// still holds the value we validated against. The conditional filter is what
// makes concurrent submissions of the same code safe: exactly one update
// matches, and every other request sees no match and is rejected.
func (h *Handler) burnTOTPCounter(r *http.Request, id primitive.ObjectID, expected, next uint64) error {
	// int64 throughout: that is how the counter is stored, and matching a
	// uint64 against an int64 field would depend on driver coercion.
	filter := bson.M{"_id": id}
	if expected == 0 {
		// A never-used secret has no totpLastCounter field at all; {field: null}
		// matches both "explicitly null" and "missing".
		filter["totpLastCounter"] = bson.M{"$in": bson.A{nil, int64(0)}}
	} else {
		filter["totpLastCounter"] = int64(expected)
	}
	res, err := h.Admins.UpdateOne(r.Context(), filter, bson.M{"$set": bson.M{"totpLastCounter": int64(next)}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return errTOTPRace
	}
	return nil
}
