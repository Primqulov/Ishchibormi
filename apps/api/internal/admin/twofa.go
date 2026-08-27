package admin

import (
	"net/http"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/totp"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// rotateSession applies a 2FA change and advances tokenVersion in one write,
// then mints a replacement token for the admin who made the change.
//
// Turning the second factor on or off is a credential change, so every other
// outstanding session for this admin has to die — that is what the tokenVersion
// bump does (see RequireActiveAdmin). Returning a fresh token keeps the caller's
// own tab alive: without it, the request that enables 2FA would immediately
// invalidate the session that made it, and the panel would appear to break.
func (h *Handler) rotateSession(r *http.Request, id primitive.ObjectID, update bson.M) (*models.Admin, string, string, error) {
	update["$inc"] = bson.M{"tokenVersion": 1}
	var updated models.Admin
	err := h.Admins.FindOneAndUpdate(r.Context(), bson.M{"_id": id}, update,
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&updated)
	if err != nil {
		return nil, "", "", err
	}
	// Saqlangan refresh sessiyalari eski tokenVersion ni olib yuradi, ya'ni
	// bumpdan keyin ularning hammasi baribir rad etiladi. Shuning uchun ularni
	// shu yerda o'chirib, chaqiruvchining o'ziga darhol yangisini ochamiz —
	// aks holda 2FA ni yoqqan qurilma keyingi yangilashdayoq chiqib ketardi.
	h.revokeSessions(r.Context(), id)
	access, err := httpx.IssueVersionedAdminToken(
		h.Cfg.JWTAccessSecret, updated.ID.Hex(), updated.Role, updated.TokenVersion, h.Cfg.JWTAdminTTL)
	if err != nil {
		return nil, "", "", err
	}
	refresh, err := h.startSession(r.Context(), &updated, httpx.ClientPlatform(r), httpx.ClientIP(r))
	if err != nil {
		return nil, "", "", err
	}
	return &updated, access, refresh, nil
}

// Setup2FA generates (but does not activate) a new TOTP secret and returns the
// secret + otpauth URI to add to an authenticator app. Enrollment is confirmed
// by Enable2FA. Refuses if 2FA is already active (disable first).
func (h *Handler) Setup2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if a.TOTPEnabled {
		httpx.Err(w, httpx.NewError(400, "already_enabled", "2FA already enabled"))
		return
	}
	secret, err := totp.GenerateSecret()
	if err != nil {
		httpx.Err(w, err)
		return
	}
	// The replay high-water mark is tied to the old secret; a new secret starts
	// from zero, otherwise the counter left behind would reject the first codes
	// of the new enrollment.
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpSecret": secret, "totpEnabled": false, "totpLastCounter": int64(0)}}); err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]string{
		"secret": secret,
		"uri":    totp.URI(secret, a.Username, "IshchiBormi Admin"),
	})
}

type codeReq struct {
	Code string `json:"code"`
}

// Enable2FA verifies the first code against the pending secret and activates 2FA.
func (h *Handler) Enable2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if a.TOTPSecret == "" {
		httpx.Err(w, httpx.NewError(400, "no_setup", "call setup first"))
		return
	}
	var req codeReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	counter, ok := totp.ValidateCounter(a.TOTPSecret, req.Code, a.TOTPLastCounter)
	if !ok {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	// Burn the enrollment code and turn 2FA on in the same write that revokes
	// sibling sessions.
	updated, tok, refresh, err := h.rotateSession(r, a.ID, bson.M{
		"$set": bson.M{"totpEnabled": true, "totpLastCounter": int64(counter)},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_enable", a.ID.Hex(), "")
	h.respondSession(w, r, updated, tok, refresh)
}

// Disable2FA turns off 2FA for the current admin after verifying a live code.
func (h *Handler) Disable2FA(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if !a.TOTPEnabled {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	var req codeReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if _, ok := totp.ValidateCounter(a.TOTPSecret, req.Code, a.TOTPLastCounter); !ok {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	// Dropping the second factor weakens the account, so it revokes sibling
	// sessions the same way enabling it does.
	updated, tok, refresh, err := h.rotateSession(r, a.ID, bson.M{
		"$set":   bson.M{"totpEnabled": false},
		"$unset": bson.M{"totpSecret": "", "totpLastCounter": ""},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_disable", a.ID.Hex(), "self")
	h.respondSession(w, r, updated, tok, refresh)
}

// ---- Admin (staff) management — superadmin only ----
