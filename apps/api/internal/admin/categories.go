package admin

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/category"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ListCategories — barcha kategoriyalar (o'chirilganlari ham). Ommaviy
// ro'yxatdan farqi: bu yerda `usageCount` tarixiy jami bo'lib qoladi, uning
// yonida `activeCount` — hozir feedda ko'rinib turgan e'lonlar soni. Admin
// ikkalasini ham ko'rishi kerak: jami — kategoriya umuman qanchalik
// ishlatilganini, faol — bugun undan foyda bor-yo'qligini ko'rsatadi.
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
	counts, err := category.ActiveCounts(r.Context(), h.Elons)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	for i := range out {
		out[i].ActiveCount = counts[out[i].ID]
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
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	_, err = h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isActive": req.IsActive}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "category_active", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

type categoryReq struct {
	Name     string  `json:"name"`
	Slug     string  `json:"slug"`
	Icon     *string `json:"icon"`
	IsActive *bool   `json:"isActive"`
}

func categoryIconURL(raw *string) (string, error) {
	if raw == nil {
		return "", httpx.NewError(400, "icon_required", "kategoriya ikonkasi majburiy")
	}
	icon := strings.TrimSpace(*raw)
	if icon == "" {
		return "", httpx.NewError(400, "icon_required", "kategoriya ikonkasi majburiy")
	}
	if !httpx.IsSafeHTTPURL(icon) {
		return "", httpx.NewError(400, "bad_icon_url", "ikonka faqat http(s) URL bo'lishi kerak")
	}
	return icon, nil
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
	icon, err := categoryIconURL(req.Icon)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	cat := models.Category{
		Name: req.Name, Slug: slug, Icon: icon,
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
	var previous models.Category
	if req.Icon != nil {
		icon, iconErr := categoryIconURL(req.Icon)
		if iconErr != nil {
			httpx.Err(w, iconErr)
			return
		}
		set["icon"] = icon
		_ = h.Cats.FindOne(r.Context(), bson.M{"_id": id}).Decode(&previous)
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
	if req.Icon != nil && previous.Icon != "" && previous.Icon != set["icon"] {
		go deleteStoredCategoryIcon(h.Storage, previous.Icon)
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
	go deleteStoredCategoryIcon(h.Storage, cat.Icon)
	h.audit(r, "category_delete", id.Hex(), cat.Name)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// UploadCategoryIcon stores a small raster icon selected in the admin panel.
// SVG is deliberately URL-only: accepting arbitrary uploaded SVG would allow
// active document content to be served from the application's own origin.
func (h *Handler) UploadCategoryIcon(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		httpx.Err(w, httpx.NewError(503, "storage_disabled", "fayl yuklash sozlanmagan"))
		return
	}
	const maxBytes int64 = 2 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		httpx.Err(w, httpx.NewError(413, "too_large", "ikonka hajmi 2 MB dan oshmasligi kerak"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "no_file", "ikonka fayli topilmadi"))
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || int64(len(raw)) > maxBytes || header.Size > maxBytes {
		httpx.Err(w, httpx.NewError(413, "too_large", "ikonka hajmi 2 MB dan oshmasligi kerak"))
		return
	}
	contentType := http.DetectContentType(raw)
	switch contentType {
	case "image/png", "image/jpeg", "image/webp":
	default:
		httpx.Err(w, httpx.NewError(415, "bad_type", "faqat PNG, JPG yoki WebP ikonka qabul qilinadi"))
		return
	}
	if !upload.ValidateImage(raw, contentType) {
		httpx.Err(w, httpx.NewError(422, "invalid_image", "ikonka buzilgan yoki o'lchami juda katta"))
		return
	}

	adminID := httpx.AdminID(r)
	out, err := h.Storage.Upload(r.Context(), "category-icons/"+adminID, header.Filename, contentType, bytes.NewReader(raw))
	if err != nil {
		httpx.Err(w, httpx.NewError(500, "upload_failed", "ikonka yuklab bo'lmadi"))
		return
	}
	h.audit(r, "category_icon_upload", out.Key, "")
	httpx.JSON(w, 201, out)
}

func deleteStoredCategoryIcon(s *storage.Service, iconURL string) {
	if s == nil || iconURL == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = s.DeleteByURL(ctx, iconURL)
}

// ---- Two-factor (TOTP) — every admin manages their own ----
