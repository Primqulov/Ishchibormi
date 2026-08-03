package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

// ListAdmins returns all staff accounts (password hashes are never serialized).
func (h *Handler) ListAdmins(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Admins.Find(r.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Admin{}
	for cur.Next(r.Context()) {
		var a models.Admin
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	httpx.JSON(w, 200, out)
}

type createAdminReq struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *Handler) CreateAdmin(w http.ResponseWriter, r *http.Request) {
	var req createAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	if req.Username == "" || len(req.Password) < 6 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "username and password (>=6 chars) required"))
		return
	}
	if !validRoles[req.Role] {
		httpx.Err(w, httpx.NewError(400, "bad_role", "role must be superadmin, moderator or support"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	a := models.Admin{
		Username: req.Username, Name: strings.TrimSpace(req.Name), PasswordHash: string(hash),
		Role: req.Role, IsActive: true, CreatedAt: time.Now(),
	}
	res, err := h.Admins.InsertOne(r.Context(), a)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "username already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	a.ID = res.InsertedID.(primitive.ObjectID)
	h.audit(r, "admin_create", a.ID.Hex(), req.Username+"/"+req.Role)
	httpx.JSON(w, 201, a)
}

type updateAdminReq struct {
	Role             string  `json:"role"`
	Name             *string `json:"name"`
	IsActive         *bool   `json:"isActive"`
	Password         string  `json:"password"`
	DisableTwoFactor bool    `json:"disableTwoFactor"` // superadmin resets a locked-out admin
}

// UpdateAdmin changes another admin's role/active state or resets their
// password. Guards against self-lockout: a superadmin cannot demote or
// deactivate their own account.
func (h *Handler) UpdateAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req updateAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	self := httpx.AdminID(r) == id.Hex()
	set := bson.M{}
	if req.Role != "" {
		if !validRoles[req.Role] {
			httpx.Err(w, httpx.NewError(400, "bad_role", "invalid role"))
			return
		}
		if self && req.Role != "superadmin" {
			httpx.Err(w, httpx.NewError(400, "self_lockout", "cannot demote your own account"))
			return
		}
		set["role"] = req.Role
	}
	if req.Name != nil {
		set["name"] = strings.TrimSpace(*req.Name)
	}
	if req.IsActive != nil {
		if self && !*req.IsActive {
			httpx.Err(w, httpx.NewError(400, "self_lockout", "cannot deactivate your own account"))
			return
		}
		set["isActive"] = *req.IsActive
	}
	if req.Password != "" {
		if len(req.Password) < 6 {
			httpx.Err(w, httpx.NewError(400, "bad_request", "password must be >=6 chars"))
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			httpx.Err(w, err)
			return
		}
		set["passwordHash"] = string(hash)
	}
	update := bson.M{}
	if req.DisableTwoFactor {
		set["totpEnabled"] = false
		update["$unset"] = bson.M{"totpSecret": ""}
	}
	if len(set) == 0 && len(update) == 0 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "nothing to update"))
		return
	}
	if len(set) > 0 {
		update["$set"] = set
	}
	if _, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": id}, update); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "admin_update", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DeleteAdmin removes a staff account. An admin cannot delete themselves.
func (h *Handler) DeleteAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if httpx.AdminID(r) == id.Hex() {
		httpx.Err(w, httpx.NewError(400, "self_delete", "cannot delete your own account"))
		return
	}
	if _, err := h.Admins.DeleteOne(r.Context(), bson.M{"_id": id}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "admin_delete", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
