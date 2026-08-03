// Package upload exposes REST endpoints for uploading files to S3 and
// removing them. Every upload is attributed to the authenticated user.
package upload

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
)

// Rasm siqishda uzun tomon uchun maksimal o'lcham (px), fayl turi bo'yicha.
// Avatar kichik ko'rsatiladi, e'lon rasmlari kattaroq.
var maxDimByKind = map[string]int{
	"avatar": 512,
	"elon":   1600,
}

type Handler struct {
	Storage *storage.Service
}

func NewHandler(s *storage.Service) *Handler { return &Handler{Storage: s} }

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
	body := compressImage(raw, ct, maxDimByKind[kind])

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
	httpx.JSON(w, 201, out)
}

// DELETE /api/uploads?key=...  or  DELETE /api/uploads?url=...
// Deletes the underlying S3 object. Authenticated users only — strict
// ownership check is performed by the calling domain (user/elon) before
// invoking this; this endpoint is best-effort for cleanup.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if httpx.UserID(r) == "" {
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
