package elon

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
)

// Bu testlar e'lon joylash tugmasi bosilganda ishga tushadigan avtomatik
// tekshiruvni qamraydi: sarlavha + tavsif, so'ng rasmlar. OpenAI o'rniga
// lokal stub turadi — haqiqiy kalit ham, tarmoq ham kerak emas.

// fakeClassifier — moderation.Classifier interfeysining test uchun
// amalga oshirilishi. Testlar haqiqiy Gemini API'ga chiqmaydi va
// GEMINI_API_KEY talab qilmaydi.
type fakeClassifier struct {
	fn func(in gemini.Input) (*gemini.Verdict, error)

	mu    sync.Mutex
	calls int
}

func (f *fakeClassifier) Configured() bool { return true }
func (f *fakeClassifier) Model() string    { return gemini.DefaultModel }

func (f *fakeClassifier) Classify(_ context.Context, in gemini.Input) (*gemini.Verdict, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	return f.fn(in)
}

func (f *fakeClassifier) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// verdict — hamma kategoriya NEGLIGIBLE; flag berilgan bo'lsa
// SEXUALLY_EXPLICIT HIGH bo'ladi.
func verdict(flag bool) *gemini.Verdict {
	r := map[string]string{}
	for _, c := range gemini.Categories {
		r[c] = gemini.ProbNegligible
	}
	if flag {
		r["HARM_CATEGORY_SEXUALLY_EXPLICIT"] = gemini.ProbHigh
	}
	return &gemini.Verdict{Ratings: r}
}

// stubModerator — flagOn: "" hech narsani belgilamaydi, "image" faqat
// rasmli so'rovlarni, "text" faqat matnli so'rovlarni belgilaydi.
func stubModerator(flagOn string) (*moderation.Service, *fakeClassifier) {
	f := &fakeClassifier{fn: func(in gemini.Input) (*gemini.Verdict, error) {
		hasImage := len(in.Image) > 0
		return verdict((flagOn == "image" && hasImage) || (flagOn == "text" && !hasImage)), nil
	}}
	return moderation.New(f), f
}

// failingModerator — tashqi xizmat ishlamay qolgan holat.
func failingModerator() (*moderation.Service, *fakeClassifier) {
	f := &fakeClassifier{fn: func(gemini.Input) (*gemini.Verdict, error) {
		return nil, &gemini.APIError{Status: 503, RPCStatus: "UNAVAILABLE", Message: "down"}
	}}
	return moderation.New(f), f
}

// localStorage — vaqtinchalik papkada lokal storage va unga yozilgan PNG.
// Rasm URL'i shu yerdan quriladi, ya'ni moderateImages baytlarni haqiqatan
// diskdan qaytarib o'qiydi.
func localStorage(t *testing.T, userID string) (*storage.Service, string) {
	t.Helper()
	svc, err := storage.NewLocal(t.TempDir(), "http://localhost:8080/uploads")
	if err != nil {
		t.Fatalf("NewLocal: %v", err)
	}
	return svc, addPNG(t, svc, userID, "test.png")
}

// addPNG storage'ga haqiqiy PNG yozadi va uning ommaviy URL'ini qaytaradi.
// Bir nechta rasmli holatlarni sinash uchun kerak.
func addPNG(t *testing.T, svc *storage.Service, userID, name string) string {
	t.Helper()
	key := "elons/" + userID + "/" + name
	full := filepath.Join(svc.LocalDir(), filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for x := 0; x < 32; x++ {
		for y := 0; y < 32; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 8), G: 0x40, B: 0x90, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png: %v", err)
	}
	if err := os.WriteFile(full, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return svc.PublicURL(key)
}

func newModeratedHandler(t *testing.T, flagOn string, opts moderation.GuardOptions) (*Handler, string) {
	t.Helper()
	const userID = "6a8da2b70fa2217969b754a8"
	store, imgURL := localStorage(t, userID)
	h := &Handler{Storage: store}
	svc, _ := stubModerator(flagOn)
	h.AttachModerator(moderation.NewGuard(svc, nil, opts), 8<<20)
	return h, imgURL
}

// httpStatus — httpx.HTTPError dan status va kodni ajratadi.
func httpStatus(t *testing.T, err error) (int, string) {
	t.Helper()
	if err == nil {
		return 0, ""
	}
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("err = %T (%v), want *httpx.HTTPError", err, err)
	}
	return he.Status, he.Code
}

func TestModerateElonAllowsCleanListing(t *testing.T) {
	h, imgURL := newModeratedHandler(t, "", moderation.GuardOptions{Enforce: true})

	req := &upsertReq{
		Title:       "Ofis tozalash",
		Description: "Ikki nafar ishchi kerak, kunlik ish.",
		Images:      []string{imgURL},
	}
	if _, err := h.moderateElon(context.Background(), primitive.NewObjectID(), req); err != nil {
		t.Fatalf("toza e'lon rad etildi: %v", err)
	}
}

func TestModerateElonRejectsBadText(t *testing.T) {
	h, imgURL := newModeratedHandler(t, "text", moderation.GuardOptions{Enforce: true})

	req := &upsertReq{Title: "x", Description: "y", Images: []string{imgURL}}
	_, mErr := h.moderateElon(context.Background(), primitive.NewObjectID(), req)
	status, code := httpStatusFrom(t, mErr)
	if status != http.StatusUnprocessableEntity || code != "content_rejected" {
		t.Errorf("status=%d code=%q, want 422/content_rejected", status, code)
	}
}

// TestModerateElonRejectsBadImage — matn toza, rasm nomaqbul: e'lon
// baribir rad etilishi va sabab rasmga tegishli bo'lishi kerak.
func TestModerateElonRejectsBadImage(t *testing.T) {
	h, imgURL := newModeratedHandler(t, "image", moderation.GuardOptions{Enforce: true})

	req := &upsertReq{
		Title:       "Ofis tozalash",
		Description: "Ikki nafar ishchi kerak.",
		Images:      []string{imgURL},
	}
	_, mErr := h.moderateElon(context.Background(), primitive.NewObjectID(), req)
	status, code := httpStatusFrom(t, mErr)
	if status != http.StatusUnprocessableEntity || code != "image_rejected" {
		t.Errorf("status=%d code=%q, want 422/image_rejected", status, code)
	}
}

// TestModerateElonSkipsImagesWhenTextRejected — matn rad etilsa rasmlarga
// umuman so'rov ketmasligi kerak (bekorga pul sarflanmasin).
func TestModerateElonSkipsImagesWhenTextRejected(t *testing.T) {
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	svc, f := stubModerator("text")
	h := &Handler{Storage: store}
	h.AttachModerator(moderation.NewGuard(svc, nil, moderation.GuardOptions{Enforce: true}), 8<<20)

	req := &upsertReq{Title: "bad", Description: "bad", Images: []string{imgURL, imgURL, imgURL}}
	if _, err := h.moderateElon(context.Background(), primitive.NewObjectID(), req); err == nil {
		t.Fatal("rad etilishi kerak edi")
	}
	if f.count() != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (matn rad etilgach rasmlar tekshirilmasligi kerak)", f.count())
	}
}

// TestModerateElonDisabledIsNoop — bayroq o'chiq bo'lsa hech qanday tashqi
// chaqiruv bo'lmasligi va e'lon o'tishi kerak (mavjud xatti-harakat).
func TestModerateElonDisabledIsNoop(t *testing.T) {
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	svc, f := failingModerator()
	h := &Handler{Storage: store}
	h.AttachModerator(moderation.NewGuard(svc, nil, moderation.GuardOptions{Enforce: false}), 8<<20)

	req := &upsertReq{Title: "x", Description: "y", Images: []string{imgURL}}
	if _, err := h.moderateElon(context.Background(), primitive.NewObjectID(), req); err != nil {
		t.Fatalf("o'chiq moderatsiya xato qaytardi: %v", err)
	}
	if f.count() != 0 {
		t.Errorf("chaqiruvlar = %d, want 0", f.count())
	}
}

// TestModerateElonFailOpen — OpenAI ishlamay qolsa standart holatda e'lon
// o'tadi; FailClosed bilan esa 503 qaytadi.
func TestModerateElonFailOpen(t *testing.T) {
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	req := &upsertReq{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}

	openSvc, _ := failingModerator()
	openHandler := &Handler{Storage: store}
	openHandler.AttachModerator(moderation.NewGuard(openSvc, nil, moderation.GuardOptions{Enforce: true}), 8<<20)
	if _, err := openHandler.moderateElon(context.Background(), primitive.NewObjectID(), req); err != nil {
		t.Errorf("fail-open: e'lon o'tishi kerak edi, xato: %v", err)
	}

	closedSvc, _ := failingModerator()
	closedHandler := &Handler{Storage: store}
	closedHandler.AttachModerator(moderation.NewGuard(closedSvc, nil, moderation.GuardOptions{Enforce: true, FailClosed: true}), 8<<20)
	_, mErr := closedHandler.moderateElon(context.Background(), primitive.NewObjectID(), req)
	status, code := httpStatus(t, mErr)
	if status != http.StatusServiceUnavailable || code != "moderation_unavailable" {
		t.Errorf("fail-closed: status=%d code=%q, want 503/moderation_unavailable", status, code)
	}
}

// TestModerateElonMissingImageIsNotFatal — storage'da rasm topilmasa (yoki
// o'chirilgan bo'lsa) e'lon fail-open qoidasi bo'yicha o'tadi.
func TestModerateElonMissingImageIsNotFatal(t *testing.T) {
	h, _ := newModeratedHandler(t, "", moderation.GuardOptions{Enforce: true})

	req := &upsertReq{
		Title:       "Ofis tozalash",
		Description: "Ishchi kerak.",
		Images:      []string{"http://localhost:8080/uploads/elons/6a8da2b70fa2217969b754a8/yoq.png"},
	}
	if _, err := h.moderateElon(context.Background(), primitive.NewObjectID(), req); err != nil {
		t.Errorf("yo'q rasm e'lonni to'xtatmasligi kerak: %v", err)
	}
}

func TestSniffImageMIME(t *testing.T) {
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	data, err := store.Download(context.Background(), store.KeyFromURL(imgURL), 1<<20)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if got := sniffImageMIME(data); got != "image/png" {
		t.Errorf("sniffImageMIME = %q, want image/png", got)
	}
	if got := sniffImageMIME([]byte("<html>")); got == "image/png" {
		t.Errorf("HTML rasm deb topildi: %q", got)
	}
}

// ─── Tahrirlash (PATCH /api/elons/{id}) ──────────────────────────────────────

func updateHandler(t *testing.T, flagOn string) (*Handler, string, *fakeClassifier) {
	t.Helper()
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	svc, f := stubModerator(flagOn)
	h := &Handler{Storage: store}
	h.AttachModerator(moderation.NewGuard(svc, nil, moderation.GuardOptions{Enforce: true}), 8<<20)
	return h, imgURL, f
}

// TestUpdateRejectsNewlyAddedBadText — asosiy teshik: toza e'lon joylab,
// keyin tahrirlash orqali nomaqbul matn qo'shib bo'lmaydi.
func TestUpdateRejectsNewlyAddedBadText(t *testing.T) {
	h, imgURL, _ := updateHandler(t, "text")

	prev := &models.Elon{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}
	req := &upsertReq{Title: "Escort service", Description: "Explicit acts.", Images: []string{imgURL}}

	_, mErr := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev)
	status, code := httpStatusFrom(t, mErr)
	if status != http.StatusUnprocessableEntity || code != "content_rejected" {
		t.Errorf("status=%d code=%q, want 422/content_rejected", status, code)
	}
}

// TestUpdateRejectsNewlyAddedBadImage — tahrirlashda qo'shilgan yangi rasm
// tekshiriladi.
func TestUpdateRejectsNewlyAddedBadImage(t *testing.T) {
	h, imgURL, _ := updateHandler(t, "image")

	prev := &models.Elon{Title: "Ofis tozalash", Description: "Ishchi kerak."}
	req := &upsertReq{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}

	_, mErr := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev)
	status, code := httpStatusFrom(t, mErr)
	if status != http.StatusUnprocessableEntity || code != "image_rejected" {
		t.Errorf("status=%d code=%q, want 422/image_rejected", status, code)
	}
}

// TestUpdateSkipsUnchangedContent — faqat narx o'zgargan tahrir bitta ham
// tashqi chaqiruv qilmasligi kerak.
func TestUpdateSkipsUnchangedContent(t *testing.T) {
	h, imgURL, f := updateHandler(t, "")

	prev := &models.Elon{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}
	req := &upsertReq{
		Title: "Ofis tozalash", Description: "Ishchi kerak.",
		Images: []string{imgURL}, PriceAmount: 999000,
	}
	if _, err := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev); err != nil {
		t.Fatalf("o'zgarmagan kontent rad etildi: %v", err)
	}
	if f.count() != 0 {
		t.Errorf("chaqiruvlar = %d, want 0 (matn ham, rasm ham o'zgarmagan)", f.count())
	}
}

// TestUpdateChecksOnlyAddedImages — eski rasm qayta tekshirilmaydi, faqat
// yangisi.
func TestUpdateChecksOnlyAddedImages(t *testing.T) {
	h, imgURL, f := updateHandler(t, "")

	// Ikkinchi HAQIQIY rasm: ro'yxatda eskisi bor, bittasi yangi qo'shilgan.
	newURL := addPNG(t, h.Storage, "6a8da2b70fa2217969b754a8", "ikkinchi.png")
	prev := &models.Elon{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}
	req := &upsertReq{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL, newURL}}

	if _, err := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev); err != nil {
		t.Fatalf("kutilmagan xato: %v", err)
	}
	if f.count() != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (faqat yangi rasm tekshirilishi kerak)", f.count())
	}
}

// TestUpdateWithoutImagesFieldTouchesNothing — `images` umuman yuborilmasa
// rasmlarga tegilmaydi.
func TestUpdateWithoutImagesFieldTouchesNothing(t *testing.T) {
	h, imgURL, f := updateHandler(t, "image")

	prev := &models.Elon{Title: "Ofis tozalash", Description: "Ishchi kerak.", Images: []string{imgURL}}
	req := &upsertReq{Title: "Ofis tozalash", Description: "Ishchi kerak."} // Images == nil

	if _, err := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev); err != nil {
		t.Fatalf("kutilmagan xato: %v", err)
	}
	if f.count() != 0 {
		t.Errorf("chaqiruvlar = %d, want 0", f.count())
	}
}

// TestUpdateWithoutPrevChecksEverything — avvalgi hujjat topilmasa hammasi
// tekshiriladi (xavfsiz tomon).
func TestUpdateWithoutPrevChecksEverything(t *testing.T) {
	h, imgURL, _ := updateHandler(t, "text")

	req := &upsertReq{Title: "Escort service", Description: "Explicit.", Images: []string{imgURL}}
	_, mErr := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, nil)
	status, _ := httpStatusFrom(t, mErr)
	if status != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", status)
	}
}

func TestAddedImages(t *testing.T) {
	cases := []struct {
		name       string
		next, prev []string
		want       []string
	}{
		{"eski yo'q", []string{"a", "b"}, nil, []string{"a", "b"}},
		{"hammasi eski", []string{"a", "b"}, []string{"a", "b"}, []string{}},
		{"bittasi yangi", []string{"a", "b"}, []string{"a"}, []string{"b"}},
		{"o'chirilgan hisobga olinmaydi", []string{"a"}, []string{"a", "b"}, []string{}},
		{"bo'sh", nil, []string{"a"}, []string{}},
	}
	for _, c := range cases {
		got := addedImages(c.next, c.prev)
		if len(got) != len(c.want) {
			t.Errorf("%s: addedImages = %v, want %v", c.name, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("%s: addedImages = %v, want %v", c.name, got, c.want)
				break
			}
		}
	}
}

// ─── Rad etish xabarlari ─────────────────────────────────────────────────────

// TestCreateAndUpdateMessagesDiffer — yaratish va tahrirlash xabarlari
// FARQ QILISHI kerak. Tahrirda e'lon o'z joyida qoladi, shuning uchun
// "E'lon qabul qilinmadi" desak foydalanuvchi e'loni o'chib ketdi deb
// o'ylaydi.
func TestCreateAndUpdateMessagesDiffer(t *testing.T) {
	h, imgURL, _ := updateHandler(t, "text")
	req := &upsertReq{Title: "bad", Description: "bad", Images: []string{imgURL}}

	_, mErr := h.moderateElon(context.Background(), primitive.NewObjectID(), req)
	_, _, createMsg := httpStatusMsgFrom(t, mErr)
	if createMsg != "E'lon qabul qilinmadi: nomaqbul kontent." {
		t.Errorf("yaratish xabari = %q", createMsg)
	}

	prev := &models.Elon{Title: "Ombor", Description: "Ishchi kerak."}
	_, mErr = h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev)
	_, _, updateMsg := httpStatusMsgFrom(t, mErr)
	if !strings.HasPrefix(updateMsg, "O'zgartirish saqlanmadi:") {
		t.Errorf("tahrir xabari = %q, 'O'zgartirish saqlanmadi:' kutilgan", updateMsg)
	}
	if !strings.Contains(updateMsg, "E'lon avvalgi holatida qoldi.") {
		t.Errorf("tahrir xabari = %q, tinchlantiruvchi jumla kutilgan", updateMsg)
	}
	if createMsg == updateMsg {
		t.Error("yaratish va tahrir xabarlari bir xil — foydalanuvchi chalg'iydi")
	}
}

// TestUpdateImageRejectionCarriesNote — tahrirda RASM rad etilganda ham
// xuddi shu izoh qo'shilishi kerak.
func TestUpdateImageRejectionCarriesNote(t *testing.T) {
	h, imgURL, _ := updateHandler(t, "image")

	prev := &models.Elon{Title: "Ombor", Description: "Ishchi kerak."}
	req := &upsertReq{Title: "Ombor", Description: "Ishchi kerak.", Images: []string{imgURL}}

	_, mErr := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev)
	_, code, msg := httpStatusMsgFrom(t, mErr)
	if code != "image_rejected" {
		t.Fatalf("code = %q, want image_rejected", code)
	}
	if !strings.HasPrefix(msg, "O'zgartirish saqlanmadi:") {
		t.Errorf("xabar = %q", msg)
	}
	if !strings.Contains(msg, "E'lon avvalgi holatida qoldi.") {
		t.Errorf("xabar = %q, izoh kutilgan", msg)
	}
}

// TestUnavailableHasNoNote — moderatsiya ishlamay qolganda (503) izoh
// qo'shilmasligi kerak: u yerda tekshiruv umuman bo'lmagan.
func TestUnavailableHasNoNote(t *testing.T) {
	store, imgURL := localStorage(t, "6a8da2b70fa2217969b754a8")
	svc, _ := failingModerator()
	h := &Handler{Storage: store}
	h.AttachModerator(moderation.NewGuard(svc, nil,
		moderation.GuardOptions{Enforce: true, FailClosed: true}), 8<<20)

	prev := &models.Elon{Title: "Ombor", Description: "Ishchi kerak."}
	req := &upsertReq{Title: "Yangi", Description: "Yangi tavsif.", Images: []string{imgURL}}

	_, mErr := h.moderateElonUpdate(context.Background(), primitive.NewObjectID(), req, prev)
	status, code, msg := httpStatusMsgFrom(t, mErr)
	if status != http.StatusServiceUnavailable || code != "moderation_unavailable" {
		t.Fatalf("status=%d code=%q, want 503/moderation_unavailable", status, code)
	}
	if strings.Contains(msg, "avvalgi holatida") {
		t.Errorf("xabar = %q, 503 da izoh bo'lmasligi kerak", msg)
	}
}

// httpStatusMsg — httpStatus'ning xabar ham qaytaradigan varianti.
func httpStatusMsg(t *testing.T, err error) (int, string, string) {
	t.Helper()
	if err == nil {
		return 0, "", ""
	}
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("err = %T (%v), want *httpx.HTTPError", err, err)
	}
	return he.Status, he.Code, he.Message
}

// httpStatusFrom / httpStatusMsgFrom — moderateElon* endi (skipped, error)
// qaytaradi; birinchi qiymatni tashlab, xatoni tekshiruvchilarga uzatadi.
func httpStatusFrom(t *testing.T, err error) (int, string) {
	t.Helper()
	return httpStatus(t, err)
}

func httpStatusMsgFrom(t *testing.T, err error) (int, string, string) {
	t.Helper()
	return httpStatusMsg(t, err)
}
