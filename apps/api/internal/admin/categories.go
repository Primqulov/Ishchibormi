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

// Turkum maydonlarining chegaralari.
//
// # NEGA SERVERDA
//
// `httpx.Decode` tanani 1 MB gacha o'qiydi — ya'ni cheklovsiz `name` yoki
// `slug` bazaga yuz minglab belgi bo'lib tushardi va Figma 3.7 jadvalining
// 277 px'lik «Nomi» ustunini ham, mobil ilovadagi turkum tanlash ro'yxatini
// ham buzardi. Turkum — butun platformaga ko'rinadigan yozuv, shuning uchun
// chegara serverda: klientdagi `maxLength` faqat qulaylik uchun.
const (
	catNameMax = 60  // Figma 3.7: «Nomi» ustuni 277 px, 14 Semi Bold
	catSlugMax = 60  // URL bo'lagi — nomdan uzun bo'lishining ma'nosi yo'q
	catIconMax = 512 // odatdagi iconify havolasi ~90 belgi
)

// adminCategoryRow — Figma 3.7 jadvali chizadigan maydonlar, boshqasi yo'q.
//
// # NIMA ATAYLAB YO'Q — createdBy
//
// `models.Category` da turkumni yaratgan adminning ichki ID'si bor.
// Turkumlar ro'yxatini HAR QANDAY tizimga kirgan admin o'qiydi (support
// ham), yozishni esa faqat superadmin qiladi. Xodim ID'si jadvalda
// chizilmagan — demak uni javobga qo'shishning sababi ham yo'q: o'qilmagan
// maydon oqib ketolmaydi (xuddi adminApplicationRow dagi kabi).
type adminCategoryRow struct {
	ID              primitive.ObjectID `bson:"_id" json:"id"`
	Name            string             `bson:"name" json:"name"`
	Slug            string             `bson:"slug" json:"slug"`
	Icon            string             `bson:"icon" json:"icon"`
	IsSystemDefault bool               `bson:"isSystemDefault" json:"isSystemDefault"`
	IsActive        bool               `bson:"isActive" json:"isActive"`
	UsageCount      int                `bson:"usageCount" json:"usageCount"`
	// ActiveCount bazada saqlanmaydi — har so'rovda `elons` ustidan
	// hisoblanadi (models.Category.ActiveCount izohiga qarang).
	ActiveCount int       `bson:"-" json:"activeCount"`
	CreatedAt   time.Time `bson:"createdAt" json:"createdAt"`
}

// catRowProjection adminCategoryRow bilan maydonma-maydon bir xil.
var catRowProjection = bson.M{
	"name":            1,
	"slug":            1,
	"icon":            1,
	"isSystemDefault": 1,
	"isActive":        1,
	"usageCount":      1,
	"createdAt":       1,
}

// ListCategories — barcha turkumlar (nofaollari ham). Ommaviy ro'yxatdan
// farqi: bu yerda `usageCount` tarixiy jami bo'lib qoladi, uning yonida
// `activeCount` — hozir feedda ko'rinib turgan e'lonlar soni. Admin
// ikkalasini ham ko'rishi kerak: jami — turkum umuman qanchalik
// ishlatilganini, faol — bugun undan foyda bor-yo'qligini ko'rsatadi.
//
// # NIMA ATAYLAB YO'Q — SAHIFALASH
//
// Turkumlar soni o'n-yigirmadan oshmaydi (ularni faqat superadmin qo'lda
// qo'shadi) va Figma 3.7 pastida shu ataylab yozilgan: «Bu ekranda
// sahifalash yo'q — barcha turkumlar bitta ro'yxatda ko'rsatiladi».
func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Cats.Find(r.Context(), bson.M{},
		options.Find().
			SetProjection(catRowProjection).
			SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []adminCategoryRow{}
	for cur.Next(r.Context()) {
		var c adminCategoryRow
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

// SetCategoryActive — Figma 3.7a · «Superadmin nishonni bosib turkumni
// darhol yoqadi yoki o'chiradi (oyna ochilmaydi)».
//
// # NEGA MatchedCount TEKSHIRILADI
//
// `UpdateOne` mos hujjat topilmasa ham xatosiz qaytadi. Tekshiruvsiz
// variantda o'chirib yuborilgan turkumga yuborilgan so'rov 200 OK oladi va
// audit jurnaliga hech qachon sodir bo'lmagan o'zgarish yozilib qoladi —
// jurnal esa keyinchalik dalil sifatida o'qiladi.
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
	res, err := h.Cats.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{"isActive": req.IsActive}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		httpx.Err(w, httpx.NewError(404, "not_found", "category not found"))
		return
	}
	h.audit(r, "category_active", id.Hex(), activeLabel(req.IsActive))
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// activeLabel — audit jurnalidagi izoh. Kod («category_active») yoqilganmi
// yoki o'chirilganmi ayta olmaydi, shuning uchun natija izohga yoziladi.
func activeLabel(active bool) string {
	if active {
		return "faol"
	}
	return "nofaol"
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
	if len(icon) > catIconMax {
		return "", httpx.NewError(400, "icon_too_long", "ikonka havolasi juda uzun")
	}
	if !httpx.IsSafeHTTPURL(icon) {
		return "", httpx.NewError(400, "bad_icon_url", "ikonka faqat http(s) URL bo'lishi kerak")
	}
	return icon, nil
}

// categoryName — «Nomi» maydonini tozalaydi va uzunligini cheklaydi.
// Uzunlik RUNE bo'yicha o'lchanadi: «Yuk tashish» dagi lotin harflari 1
// bayt, kirillcha nom esa harfiga 2 bayt — bayt bo'yicha cheklash bir xil
// uzunlikdagi ikki nomni turlicha rad etardi.
func categoryName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", httpx.NewError(400, "bad_request", "name required")
	}
	if len([]rune(name)) > catNameMax {
		return "", httpx.NewError(400, "name_too_long", "turkum nomi 60 belgidan oshmasligi kerak")
	}
	return name, nil
}

// categorySlug — slug'ni normallashtiradi; so'rovda bo'sh bo'lsa nomdan
// yasaydi. `slugify` faqat [a-z0-9-] qoldiradi, shuning uchun uzunlik bayt
// bo'yicha o'lchanadi.
func categorySlug(rawSlug, name string) (string, error) {
	slug := slugify(rawSlug)
	if slug == "" {
		slug = slugify(name)
	}
	if slug == "" {
		return "", httpx.NewError(400, "bad_slug", "could not derive slug")
	}
	if len(slug) > catSlugMax {
		return "", httpx.NewError(400, "slug_too_long", "slug 60 belgidan oshmasligi kerak")
	}
	return slug, nil
}

// CreateCategory adds a new admin-defined category. Slug is derived from the
// name when not provided; duplicate slugs are rejected (409).
func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req categoryReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	name, err := categoryName(req.Name)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	slug, err := categorySlug(req.Slug, name)
	if err != nil {
		httpx.Err(w, err)
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
		Name: name, Slug: slug, Icon: icon,
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
	h.audit(r, "category_create", cat.ID.Hex(), name)
	// Javob ListCategories bilan bir xil shaklda — jadval yangi qatorni
	// qayta so'rovsiz chizishi uchun. `createdBy` bu yerda ham yo'q.
	httpx.JSON(w, 201, adminCategoryRow{
		ID: cat.ID, Name: cat.Name, Slug: cat.Slug, Icon: cat.Icon,
		IsSystemDefault: false, IsActive: cat.IsActive,
		UsageCount: 0, ActiveCount: 0, CreatedAt: cat.CreatedAt,
	})
}

// UpdateCategory edits name/slug/icon/active. Only provided fields change.
//
// # NEGA TIZIM TURKUMINING SLUG'I QULFLANGAN
//
// `category.EnsureDefaults` tizim turkumlarini SLUG bo'yicha topadi. Agar
// superadmin «tozalash» ni «tozalash-2» ga aylantirsa, keyingi deploy eski
// slug'ni topolmay YANGI turkum yaratardi — bazada bir xil ikkita
// «Tozalash» paydo bo'lardi, biri esa bo'sh. Nom, ikonka va holat esa
// tahrirlanadi: faqat slug o'zgarmaydi.
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
	// Hujjat OLDIN o'qiladi: yo'q turkumga 404 qaytarish, tizim turkumini
	// aniqlash va eski ikonkani o'chirish — hammasi shu bitta so'rovdan.
	var current adminCategoryRow
	if err := h.Cats.FindOne(r.Context(), bson.M{"_id": id},
		options.FindOne().SetProjection(catRowProjection)).Decode(&current); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "category not found"))
		return
	}
	set := bson.M{}
	nom := current.Name
	if strings.TrimSpace(req.Name) != "" {
		name, nameErr := categoryName(req.Name)
		if nameErr != nil {
			httpx.Err(w, nameErr)
			return
		}
		set["name"] = name
		nom = name
	}
	if slugify(req.Slug) != "" {
		slug, slugErr := categorySlug(req.Slug, "")
		if slugErr != nil {
			httpx.Err(w, slugErr)
			return
		}
		// O'zgarmagan slug xato emas — panel formani to'liq yuboradi.
		if slug != current.Slug {
			if current.IsSystemDefault {
				httpx.Err(w, httpx.NewError(400, "protected", "tizim turkumining slug'ini o'zgartirib bo'lmaydi"))
				return
			}
			set["slug"] = slug
		}
	}
	if req.Icon != nil {
		icon, iconErr := categoryIconURL(req.Icon)
		if iconErr != nil {
			httpx.Err(w, iconErr)
			return
		}
		set["icon"] = icon
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
	if req.Icon != nil && current.Icon != "" && current.Icon != set["icon"] {
		go deleteStoredCategoryIcon(h.Storage, current.Icon)
	}
	h.audit(r, "category_update", id.Hex(), nom)
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
