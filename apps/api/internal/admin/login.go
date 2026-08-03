package admin

import (
	"net/http"
	"strings"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/totp"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"golang.org/x/crypto/bcrypt"
)

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
	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"username": req.Username, "isActive": true}).Decode(&a); err != nil {
		h.auditRaw(r.Context(), primitive.NilObjectID, "login_failed", req.Username, "no such active admin")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(req.Password)); err != nil {
		h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad password")
		httpx.Err(w, httpx.NewError(401, "bad_credentials", "invalid credentials"))
		return
	}
	// Second factor. When enabled, a valid TOTP code is required. A missing code
	// returns "totp_required" so the client can prompt for it, then resubmit.
	if a.TOTPEnabled {
		if strings.TrimSpace(req.Code) == "" {
			httpx.Err(w, httpx.NewError(401, "totp_required", "2FA code required"))
			return
		}
		if !totp.Validate(a.TOTPSecret, req.Code) {
			h.auditRaw(r.Context(), a.ID, "login_failed", req.Username, "bad 2FA code")
			httpx.Err(w, httpx.NewError(401, "bad_totp", "invalid 2FA code"))
			return
		}
	}
	tok, err := httpx.IssueAdminToken(h.Cfg.JWTAccessSecret, a.ID.Hex(), a.Role, h.Cfg.JWTAccessTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.auditRaw(r.Context(), a.ID, "login_success", a.Username, "")
	httpx.JSON(w, 200, map[string]any{"accessToken": tok, "admin": a})
}
