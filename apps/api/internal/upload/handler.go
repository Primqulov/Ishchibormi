// Package upload exposes REST endpoints for uploading files to S3 and
// removing them. Every upload is attributed to the authenticated user.
package upload

import (
	"bytes"
	"context"
	"image"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// Rasm siqishda uzun tomon uchun maksimal o'lcham (px), fayl turi bo'yicha.
// Avatar kichik ko'rsatiladi, e'lon rasmlari kattaroq.
var maxDimByKind = map[string]int{
	"avatar": 512,
	"elon":   1600,
}

type Handler struct {
	Storage       *storage.Service
	AvatarUploads *mongo.Collection

	// Ixtiyoriy kontent tekshiruvi (AttachModerator orqali). Profil rasmi
	// ham, e'lon rasmi ham SAQLASHDAN OLDIN tekshiriladi.
	guard Moderator
}

// Moderator — profil rasmini tekshiruvchi.
//
// Interfeys ATAYLAB shu yerda e'lon qilingan: internal/moderation paketi
// bu paketdagi ValidateImage'ni ishlatadi, ya'ni to'g'ridan-to'g'ri import
// halqa hosil qilardi. internal/moderation.Guard shu interfeysni
// qanoatlantiradi.
type Moderator interface {
	// On — tekshiruv ishlayaptimi.
	On() bool
	// CheckImage — rad etilsa tayyor HTTP xatosini qaytaradi (buzilish
	// hisobga qo'shilgan holda), aks holda nil.
	// CheckImageErr — rad etilsa tayyor HTTP xatosini qaytaradi (buzilish
	// hisobga qo'shilgan holda), aks holda nil. Kvota tugagan bo'lsa ham
	// nil qaytadi: kontent tekshirilmasdan o'tadi va foydalanuvchi buni
	// sezmaydi.
	CheckImageErr(ctx context.Context, userID primitive.ObjectID, label, code, prefix, mime string, data []byte) error
}

func NewHandler(s *storage.Service) *Handler { return &Handler{Storage: s} }

// AttachModerator ixtiyoriy kontent tekshiruvini ulaydi. Guard o'chiq bo'lsa
// fayl yuklash oqimi bir zarracha o'zgarmaydi.
func (h *Handler) AttachModerator(m Moderator) { h.guard = m }

// imageReasonPrefix — rasm rad etilganda ko'rsatiladigan sabab.
const imageReasonPrefix = "Rasm qabul qilinmadi"

// moderateUpload — rasmni SAQLASHDAN OLDIN tekshiradi.
//
// Nega aynan shu yerda: rasm bir marta storage'ga tushsa, u ommaviy URL'da
// ochiq bo'ladi — profilga yoki e'longa biriktirilmagan bo'lsa ham. Ya'ni
// keyinroq (profilni saqlashda yoki e'lon joylashda) tekshirish kech
// bo'lardi: nomaqbul rasm allaqachon internetda turgan bo'ladi.
//
// label buzilish hisobiga qaysi tur sifatida yozilishini belgilaydi:
// "avatar" -> profil rasmi, "elon-image" -> e'lon rasmi. Ikkalasi ham
// BITTA umumiy hisobga qo'shiladi.
func (h *Handler) moderateUpload(ctx context.Context, uid primitive.ObjectID, kind, mime string, data []byte) error {
	if h.guard == nil || !h.guard.On() {
		return nil
	}
	label := "elon-image"
	if kind == "avatar" {
		label = "avatar"
	}
	return h.guard.CheckImageErr(ctx, uid, label, "image_rejected", imageReasonPrefix, mime, data)
}

// allowed kinds & their constraints
var allowed = map[string]struct {
	prefix   string
	mimes    []string
	maxBytes int64
}{
	"avatar": {prefix: "avatars", mimes: []string{"image/jpeg", "image/png", "image/webp"}, maxBytes: 5 << 20},
	"elon":   {prefix: "elons", mimes: []string{"image/jpeg", "image/png", "image/webp"}, maxBytes: 8 << 20},
}

// POST /api/uploads?kind=avatar|elon   (multipart form, field: "file")
// Returns: {key, url}
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		httpx.Err(w, httpx.NewError(503, "storage_disabled", "fayl yuklash sozlanmagan"))
		return
	}
	uid := httpx.UserID(r)
	if uid == "" {
		httpx.Err(w, httpx.NewError(401, "unauthorized", "kirish talab qilinadi"))
		return
	}
	kind := strings.ToLower(r.URL.Query().Get("kind"))
	rule, ok := allowed[kind]
	if !ok {
		httpx.Err(w, httpx.NewError(400, "bad_kind", "noma'lum fayl turi"))
		return
	}
	// Limit total request size (multipart overhead included).
	r.Body = http.MaxBytesReader(w, r.Body, rule.maxBytes+1<<20)
	if err := r.ParseMultipartForm(rule.maxBytes); err != nil {
		httpx.Err(w, httpx.NewError(413, "too_large", "fayl hajmi katta"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "no_file", "fayl topilmadi"))
		return
	}
	defer file.Close()

	if header.Size > rule.maxBytes {
		httpx.Err(w, httpx.NewError(413, "too_large", "fayl hajmi katta"))
		return
	}

	// Determine the real content type by sniffing the file bytes rather than
	// trusting the client-supplied multipart Content-Type header (which can be
	// forged to smuggle an HTML/SVG/script payload past the allow-list).
	sniff := make([]byte, 512)
	n, _ := io.ReadFull(file, sniff)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		httpx.Err(w, httpx.NewError(400, "no_file", "fayl o'qib bo'lmadi"))
		return
	}
	ct := http.DetectContentType(sniff[:n])
	// Fall back to extension only when the sniffer is unsure (octet-stream)
	// and the declared type is allowed.
	if ct == "application/octet-stream" {
		if g := guessContentType(header.Filename); g != "" {
			ct = g
		}
	}
	if !mimeOK(ct, rule.mimes) {
		httpx.Err(w, httpx.NewError(415, "bad_type", "fayl turi qabul qilinmaydi"))
		return
	}

	// Butun faylni o'qib olamiz (maxBytes cheklovi yuqorida qo'yilgan), so'ng
	// rasm bo'lsa hajmini kichraytiramiz — sifatni ko'zga ko'rinarli darajada
	// buzmasdan. Siqib bo'lmasa (webp yoki xato) asl baytlar ishlatiladi.
	raw, err := io.ReadAll(file)
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "no_file", "fayl o'qib bo'lmadi"))
		return
	}
	if !ValidateImage(raw, ct) {
		httpx.Err(w, httpx.NewError(http.StatusUnprocessableEntity, "invalid_image", "rasm buzilgan yoki o'lchami juda katta"))
		return
	}
	// Kontent tekshiruvi — siqishdan OLDIN: model asl rasmni ko'rishi kerak,
	// siqilgan variantni emas. Profil rasmi ham, e'lon rasmi ham shu yerdan
	// o'tadi, ya'ni rad etilgan rasm storage'ga UMUMAN yozilmaydi.
	ownerID, _ := primitive.ObjectIDFromHex(uid)
	moderationStatus, err := h.moderateWithStatus(r.Context(), ownerID, kind, ct, raw)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	body := raw
	// The viewer/download preserves the avatar's original bytes and aspect ratio.
	if kind != "avatar" {
		body = compressImage(raw, ct, maxDimByKind[kind])
	}

	// Build a prefix that scopes the object to this user (and entity, if any).
	// The optional scope is always nested UNDER the user's own prefix so a
	// client can't redirect uploads into another user's namespace.
	prefix := rule.prefix + "/" + uid
	if scope := r.URL.Query().Get("scope"); scope != "" {
		prefix = prefix + "/" + sanitize(scope)
	}

	out, err := h.Storage.Upload(r.Context(), prefix, header.Filename, ct, bytes.NewReader(body))
	if err != nil {
		log.Printf("upload failed: %v", err)
		httpx.Err(w, httpx.NewError(500, "upload_failed", "fayl yuklab bo'lmadi"))
		return
	}
	if kind == "avatar" && h.AvatarUploads != nil {
		cfg, _, _ := image.DecodeConfig(bytes.NewReader(body))
		now := time.Now().UTC()
		record := models.AvatarUpload{ID: out.URL, UserID: ownerID, Metadata: models.AvatarMetadata{
			URL: out.URL, Width: cfg.Width, Height: cfg.Height, SizeBytes: int64(len(body)),
			ContentType: ct, UploadedAt: &now, ModerationStatus: moderationStatus,
		}}
		if _, err := h.AvatarUploads.InsertOne(r.Context(), record); err != nil {
			DeleteByURL(h.Storage, out.URL)
			httpx.Err(w, httpx.NewError(503, "upload_metadata_failed", "rasm ma'lumotlarini saqlab bo'lmadi"))
			return
		}
	}
	httpx.JSON(w, 201, out)
}

// Optional richer interface avoids the moderation -> upload import cycle.
// A legacy moderator returning only nil cannot prove a check happened.
func (h *Handler) moderateWithStatus(ctx context.Context, uid primitive.ObjectID, kind, mime string, data []byte) (string, error) {
	if m, ok := h.guard.(interface {
		CheckImageStatus(context.Context, primitive.ObjectID, string, string, string, string, []byte) (string, error)
	}); ok && h.guard.On() {
		label := "elon-image"
		if kind == "avatar" {
			label = "avatar"
		}
		return m.CheckImageStatus(ctx, uid, label, "image_rejected", imageReasonPrefix, mime, data)
	}
	return "unknown", h.moderateUpload(ctx, uid, kind, mime, data)
}

// DELETE /api/uploads?key=...  or  DELETE /api/uploads?url=...
// Deletes the underlying S3 object. The key must be under the authenticated
// user's own avatars/<uid>/ or elons/<uid>/ namespace. This endpoint is called
// directly by clients for best-effort cleanup, so ownership must be enforced
// here rather than assumed to have happened in a domain handler.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	uid := httpx.UserID(r)
	if uid == "" {
		httpx.Err(w, httpx.NewError(401, "unauthorized", "kirish talab qilinadi"))
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		key = h.Storage.KeyFromURL(r.URL.Query().Get("url"))
	}
	if key == "" {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if !h.Storage.KeyBelongsToUser(key, uid) {
		httpx.Err(w, httpx.NewError(http.StatusForbidden, "forbidden", "fayl sizga tegishli emas"))
		return
	}
	if err := h.Storage.Delete(r.Context(), key); err != nil {
		log.Printf("storage delete failed: %v", err)
		httpx.Err(w, httpx.NewError(500, "delete_failed", "faylni o'chirib bo'lmadi"))
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func mimeOK(ct string, list []string) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	for _, m := range list {
		if m == ct {
			return true
		}
	}
	return false
}

func guessContentType(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	case ".zip":
		return "application/zip"
	}
	return ""
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "misc"
	}
	return b.String()
}

// Helper for other domains: best-effort delete by URL.
// Use this in user/elon delete paths so storage stays in sync with Mongo.
// Ko'p chaqiruv joylari buni `go`-bilan uzib yuboradi — shu sabab muddat shu
// yerda chegaralanadi (S3 qotib qolsa goroutine abadiy osilib qolmasin) va
// xato jim yutilmay log qilinadi (fayl storage'da yetim qolganini bilish uchun).
func DeleteByURL(s *storage.Service, url string) {
	if s == nil || url == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.DeleteByURL(ctx, url); err != nil {
		log.Printf("upload: delete by url failed (orphaned file?) url=%s err=%v", url, err)
	}
}
