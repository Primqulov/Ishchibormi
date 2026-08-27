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

// Logout revokes all outstanding tokens for this admin by advancing the token
// version, then writes an audit trail entry.
//
// Chiqish ATAYLAB barcha qurilmalarni qamraydi (veb ham, mobil ilova ham).
// "Faqat shu qurilmadan chiqish" degan yumshoqroq variant ham bo'lardi, lekin
// chiqish tugmasi bosiladigan asosiy holat — begona kompyuter yoki yo'qolgan
// telefon; unda yarim chorasi umuman chora emas.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	aid, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	var a models.Admin
	_ = h.Admins.FindOne(r.Context(), bson.M{"_id": aid}).Decode(&a)
	_, _ = h.Admins.UpdateOne(r.Context(), bson.M{"_id": aid}, bson.M{"$inc": bson.M{"tokenVersion": 1}})
	// tokenVersion oshgani sessiyalarni allaqachon kuchsizlantiradi; hujjatlarni
	// o'chirish esa refresh so'rovini bazadayoq to'xtatadi va kolleksiyada
	// o'lik yozuv qoldirmaydi.
	h.revokeSessions(r.Context(), aid)
	h.clearRefreshCookie(w)
	h.auditRaw(r.Context(), aid, "logout", a.Username, "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
