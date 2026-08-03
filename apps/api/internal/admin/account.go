package admin

import (
	"net/http"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// currentAdmin loads the admin making the request (from the JWT).
func (h *Handler) currentAdmin(r *http.Request) (*models.Admin, error) {
	id, err := primitive.ObjectIDFromHex(httpx.AdminID(r))
	if err != nil {
		return nil, httpx.NewError(401, "bad_token", "bad admin id")
	}
	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"_id": id}).Decode(&a); err != nil {
		return nil, httpx.NewError(404, "not_found", "admin not found")
	}
	return &a, nil
}

// Me returns the current admin (role, username, 2FA status) so the panel can
// show the right controls without exposing the full admin list to non-superadmins.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	a, err := h.currentAdmin(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, a)
}

// Logout writes an audit trail entry for the admin leaving the panel. The token
// itself is stateless (cleared client-side), so this endpoint's only job is the
// audit record.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	var a models.Admin
	_ = h.Admins.FindOne(r.Context(), bson.M{"_id": aid}).Decode(&a)
	h.auditRaw(r.Context(), aid, "logout", a.Username, "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
