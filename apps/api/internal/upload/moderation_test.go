package upload

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// fakeModerator — Moderator interfeysining test uchun amalga oshirilishi.
// Haqiqiy Gemini API'ga chiqilmaydi.
type fakeModerator struct {
	on     bool
	reject bool
	labels []string
}

func (f *fakeModerator) On() bool { return f.on }

func (f *fakeModerator) CheckImageErr(_ context.Context, _ primitive.ObjectID, label, code, prefix, _ string, _ []byte) error {
	f.labels = append(f.labels, label)
	if !f.reject {
		return nil
	}
	return httpx.NewError(http.StatusUnprocessableEntity, code, prefix+": nomaqbul kontent.")
}

func pngBytes(t *testing.T, n int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	for x := 0; x < n; x++ {
		for y := 0; y < n; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 0x70, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png: %v", err)
	}
	return buf.Bytes()
}

// uploadReq — kind bo'yicha multipart yuklash so'rovi (autentifikatsiya
// qilingan foydalanuvchi konteksti bilan).
func uploadReq(t *testing.T, kind string, data []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "x.png")
	if err != nil {
		t.Fatalf("form: %v", err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/uploads?kind="+kind, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	ctx := context.WithValue(req.Context(), httpx.CtxUserID, "6a8da2b70fa2217969b754a8")
	return req.WithContext(ctx)
}

func handlerFor(t *testing.T, m *fakeModerator) *Handler {
	t.Helper()
	svc, err := storage.NewLocal(t.TempDir(), "http://localhost:8080/uploads")
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	h := NewHandler(svc)
	h.AttachModerator(m)
	return h
}

// TestElonImageIsModeratedOnUpload — ASOSIY talab: e'lon rasmi ham profil
// rasmi kabi YUKLASH paytida tekshiriladi.
func TestElonImageIsModeratedOnUpload(t *testing.T) {
	for _, tc := range []struct{ kind, wantLabel string }{
		{"avatar", "avatar"},
		{"elon", "elon-image"},
	} {
		m := &fakeModerator{on: true}
		h := handlerFor(t, m)

		rec := httptest.NewRecorder()
		h.Upload(rec, uploadReq(t, tc.kind, pngBytes(t, 32)))

		if rec.Code != http.StatusCreated {
			t.Fatalf("%s: status = %d, want 201 (%s)", tc.kind, rec.Code, rec.Body.String())
		}
		if len(m.labels) != 1 || m.labels[0] != tc.wantLabel {
			t.Errorf("%s: tekshiruv yorliqlari = %v, want [%s]", tc.kind, m.labels, tc.wantLabel)
		}
	}
}

// TestRejectedImageIsNeverStored — rad etilgan rasm storage'ga UMUMAN
// yozilmasligi kerak (aks holda u ommaviy URL'da ochiq qolardi).
func TestRejectedImageIsNeverStored(t *testing.T) {
	for _, kind := range []string{"avatar", "elon"} {
		m := &fakeModerator{on: true, reject: true}
		h := handlerFor(t, m)

		rec := httptest.NewRecorder()
		h.Upload(rec, uploadReq(t, kind, pngBytes(t, 32)))

		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: status = %d, want 422 (%s)", kind, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "image_rejected") {
			t.Errorf("%s: body = %s", kind, rec.Body.String())
		}
		// Storage papkasi bo'sh qolishi kerak.
		entries, err := readDirCount(h.Storage.LocalDir())
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if entries != 0 {
			t.Errorf("%s: rad etilgan rasm diskka yozildi (%d ta yozuv)", kind, entries)
		}
	}
}

// TestModeratorOffIsNoop — guard o'chiq bo'lsa yuklash oqimi o'zgarmaydi.
func TestModeratorOffIsNoop(t *testing.T) {
	m := &fakeModerator{on: false, reject: true}
	h := handlerFor(t, m)

	rec := httptest.NewRecorder()
	h.Upload(rec, uploadReq(t, "elon", pngBytes(t, 32)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	if len(m.labels) != 0 {
		t.Errorf("o'chiq guard chaqirildi: %v", m.labels)
	}
}

// TestNoModeratorAttached — AttachModerator umuman chaqirilmagan holat.
func TestNoModeratorAttached(t *testing.T) {
	svc, err := storage.NewLocal(t.TempDir(), "http://localhost:8080/uploads")
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	h := NewHandler(svc)

	rec := httptest.NewRecorder()
	h.Upload(rec, uploadReq(t, "elon", pngBytes(t, 32)))

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
}

// readDirCount — papkadagi fayllar sonini rekursiv sanaydi.
func readDirCount(dir string) (int, error) {
	n := 0
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			n++
		}
		return nil
	})
	return n, err
}
