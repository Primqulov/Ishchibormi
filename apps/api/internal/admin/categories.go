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
)

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Cats.Find(r.Context(), bson.M{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Category{}
	for cur.Next(r.Context()) {
		var c models.Category
		if err := cur.Decode(&c); err == nil {
			out = append(out, c)
		}
	}
	httpx.JSON(w, 200, out)
}

type setActiveReq struct {
	IsActive bool `json:"isActive"`
}

func (h *Handler) SetCategoryActive(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req setActiveReq
	_ = httpx.Decode(r, &req)
	_, err = h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isActive": req.IsActive}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_active", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type categoryReq struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Icon     string `json:"icon"`
	IsActive *bool  `json:"isActive"`
}

// CreateCategory adds a new admin-defined category. Slug is derived from the
// name when not provided; duplicate slugs are rejected (409).
func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req categoryReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "name required"))
		return
	}
	slug := slugify(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	if slug == "" {
		httpx.Err(w, httpx.NewError(400, "bad_slug", "could not derive slug"))
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	cat := models.Category{
		Name: req.Name, Slug: slug, Icon: strings.TrimSpace(req.Icon),
		CreatedBy: adminID, IsSystemDefault: false, IsActive: active,
		UsageCount: 0, CreatedAt: time.Now(),
	}
	res, err := h.Cats.InsertOne(r.Context(), cat)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "slug already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	cat.ID = res.InsertedID.(primitive.ObjectID)
	h.audit(r, "category_create", cat.ID.Hex(), req.Name)
	httpx.JSON(w, 201, cat)
}

// UpdateCategory edits name/slug/icon/active. Only provided fields change.
func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req categoryReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	set := bson.M{}
	if s := strings.TrimSpace(req.Name); s != "" {
		set["name"] = s
	}
	if s := slugify(req.Slug); s != "" {
		set["slug"] = s
	}
	if req.Icon != "" {
		set["icon"] = strings.TrimSpace(req.Icon)
	}
	if req.IsActive != nil {
		set["isActive"] = *req.IsActive
	}
	if len(set) == 0 {
		httpx.Err(w, httpx.NewError(400, "bad_request", "nothing to update"))
		return
	}
	if _, err := h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": set}); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "slug already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_update", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DeleteCategory removes a category. System-default categories are protected
// (they are re-created on every deploy by category.EnsureDefaults), and a
// category still in use by elons is refused to avoid orphaning them.
func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var cat models.Category
	if err := h.Cats.FindOne(r.Context(), bson.M{"_id": id}).Decode(&cat); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "category not found"))
		return
	}
	if cat.IsSystemDefault {
		httpx.Err(w, httpx.NewError(400, "protected", "system category cannot be deleted; deactivate it instead"))
		return
	}
	inUse, _ := h.Elons.CountDocuments(r.Context(), bson.M{"categoryId": id, "isDeleted": bson.M{"$ne": true}})
	if inUse > 0 {
		httpx.Err(w, httpx.NewError(409, "in_use", "category is used by elons; deactivate instead"))
		return
	}
	if _, err := h.Cats.DeleteOne(r.Context(), bson.M{"_id": id}); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_delete", id.Hex(), cat.Name)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// ---- Two-factor (TOTP) — every admin manages their own ----
