package admin

import (
	"net/http"

	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/totp"
	"go.mongodb.org/mongo-driver/bson"
)

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
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpSecret": secret, "totpEnabled": false}}); err != nil {
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
	_ = httpx.Decode(r, &req)
	if !totp.Validate(a.TOTPSecret, req.Code) {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpEnabled": true}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_enable", a.ID.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
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
	_ = httpx.Decode(r, &req)
	if !totp.Validate(a.TOTPSecret, req.Code) {
		httpx.Err(w, httpx.NewError(400, "bad_totp", "invalid code"))
		return
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"totpEnabled": false}, "$unset": bson.M{"totpSecret": ""}}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "2fa_disable", a.ID.Hex(), "self")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// ---- Admin (staff) management — superadmin only ----
