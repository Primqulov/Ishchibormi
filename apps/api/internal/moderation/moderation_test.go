package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ishchibormi/backend/pkg/gemini"
)

// ─── Mock klassifikator ──────────────────────────────────────────────────────
//
// Unit testlar hech qachon haqiqiy Gemini API'ga chiqmaydi: Service
// Classifier interfeysini oladi, testlar esa quyidagi mock'ni beradi.
// Shu sabab testlar tarmoqsiz, kalitsiz va tez ishlaydi.

type fakeClassifier struct {
	model      string
	configured bool
	fn         func(in gemini.Input) (*gemini.Verdict, error)

	mu    sync.Mutex
	calls []gemini.Input
}

func (f *fakeClassifier) Configured() bool { return f.configured }

func (f *fakeClassifier) Model() string {
	if f.model == "" {
		return gemini.DefaultModel
	}
	return f.model
}

func (f *fakeClassifier) Classify(_ context.Context, in gemini.Input) (*gemini.Verdict, error) {
	f.mu.Lock()
	f.calls = append(f.calls, in)
	f.mu.Unlock()
	return f.fn(in)
}

func (f *fakeClassifier) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// negligible — hamma kategoriya NEGLIGIBLE bo'lgan xulosa (toza kontent).
func negligible() *gemini.Verdict {
	r := map[string]string{}
	for _, c := range gemini.Categories {
		r[c] = gemini.ProbNegligible
	}
	return &gemini.Verdict{Ratings: r}
}

// flagged — bitta kategoriyani berilgan darajada belgilaydi.
func flagged(category, level string) *gemini.Verdict {
	v := negligible()
	v.Ratings[category] = level
	return v
}

// newService — berilgan javob funksiyasi bilan Service quradi.
func newService(fn func(in gemini.Input) (*gemini.Verdict, error)) (*Service, *fakeClassifier) {
	f := &fakeClassifier{configured: true, fn: fn}
	return New(f), f
}

// always — kirishdan qat'i nazar bitta xulosa qaytaradi.
func always(v *gemini.Verdict) func(gemini.Input) (*gemini.Verdict, error) {
	return func(gemini.Input) (*gemini.Verdict, error) { return v, nil }
}

// byInput — matn va rasm uchun alohida xulosa qaytaradi.
func byInput(text, img *gemini.Verdict) func(gemini.Input) (*gemini.Verdict, error) {
	return func(in gemini.Input) (*gemini.Verdict, error) {
		if len(in.Image) > 0 {
			return img, nil
		}
		return text, nil
	}
}

// ─── Matn moderatsiyasi ──────────────────────────────────────────────────────

func TestTextNormalIsAllowed(t *testing.T) {
	svc, f := newService(always(negligible()))

	res, err := svc.CheckText(context.Background(), "Ofis tozalash uchun 2 nafar ishchi kerak")
	if err != nil {
		t.Fatalf("CheckText: %v", err)
	}
	if !res.Allowed {
		t.Errorf("Allowed = false, want true (%+v)", res)
	}
	if res.Flagged {
		t.Error("Flagged = true, want false")
	}
	if len(res.Categories) != 0 {
		t.Errorf("Categories = %v, want empty", res.Categories)
	}
	if len(res.Levels) != len(gemini.Categories) {
		t.Errorf("Levels = %v, har bir kategoriya bo'lishi kerak", res.Levels)
	}
	if res.Reason != "" {
		t.Errorf("Reason = %q, want empty", res.Reason)
	}
	if f.callCount() != 1 {
		t.Errorf("chaqiruvlar = %d, want 1", f.callCount())
	}
}

func TestTextSexuallyExplicitIsRejected(t *testing.T) {
	svc, _ := newService(always(flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", gemini.ProbHigh)))

	res, err := svc.CheckText(context.Background(), "Escort service wanted, explicit acts for money")
	if err != nil {
		t.Fatalf("CheckText: %v", err)
	}
	if res.Allowed {
		t.Fatalf("Allowed = true, want false (%+v)", res)
	}
	if !res.Categories["HARM_CATEGORY_SEXUALLY_EXPLICIT"] {
		t.Errorf("Categories = %v, want SEXUALLY_EXPLICIT", res.Categories)
	}
	if got := res.Levels["HARM_CATEGORY_SEXUALLY_EXPLICIT"]; got != gemini.ProbHigh {
		t.Errorf("Levels[SEXUALLY_EXPLICIT] = %q, want HIGH", got)
	}
	// Foydalanuvchiga umumiy sabab; kategoriya nomi oshkor qilinmaydi.
	if res.Reason != "E'lon qabul qilinmadi: nomaqbul kontent." {
		t.Errorf("Reason = %q", res.Reason)
	}
	// Tafsilot esa log uchun saqlanadi.
	if !strings.Contains(res.Detail(), "HARM_CATEGORY_SEXUALLY_EXPLICIT=HIGH") {
		t.Errorf("Detail = %q, kategoriya tafsiloti kutilgan", res.Detail())
	}
}

func TestTextHarassmentIsRejected(t *testing.T) {
	svc, _ := newService(always(flagged("HARM_CATEGORY_HARASSMENT", gemini.ProbHigh)))

	res, err := svc.CheckText(context.Background(), "I will beat you to death, you worthless garbage")
	if err != nil {
		t.Fatalf("CheckText: %v", err)
	}
	if res.Allowed {
		t.Fatalf("Allowed = true, want false (%+v)", res)
	}
	if !res.Categories["HARM_CATEGORY_HARASSMENT"] {
		t.Errorf("Categories = %v, want HARASSMENT", res.Categories)
	}
	if res.Reason != "E'lon qabul qilinmadi: nomaqbul kontent." {
		t.Errorf("Reason = %q", res.Reason)
	}
	if !strings.Contains(res.Detail(), "HARM_CATEGORY_HARASSMENT=HIGH") {
		t.Errorf("Detail = %q", res.Detail())
	}
}

// TestEveryBlockingCategoryRejects — ro'yxatdagi HAR BIR kategoriya
// haqiqatan bloklashini tekshiradi. Kategoriya nomi noto'g'ri yozilgan
// bo'lsa shu test yiqiladi.
func TestEveryBlockingCategoryRejects(t *testing.T) {
	for _, cat := range BlockingCategories {
		svc, _ := newService(always(flagged(cat, gemini.ProbHigh)))
		res, err := svc.CheckText(context.Background(), "x")
		if err != nil {
			t.Fatalf("%s: %v", cat, err)
		}
		if res.Allowed {
			t.Errorf("%s: Allowed = true, want false", cat)
		}
		if res.Reason == "" {
			t.Errorf("%s: Reason bo'sh", cat)
		}
	}
}

// TestThreshold — chegara MEDIUM: LOW o'tadi, MEDIUM va HIGH rad etiladi.
// Ish e'lonlarida LOW da bloklash noto'g'ri ishlagan bo'lardi.
func TestThreshold(t *testing.T) {
	cases := []struct {
		level       string
		wantAllowed bool
	}{
		{gemini.ProbNegligible, true},
		{gemini.ProbLow, true},
		{gemini.ProbMedium, false},
		{gemini.ProbHigh, false},
	}
	for _, c := range cases {
		svc, _ := newService(always(flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", c.level)))
		res, err := svc.CheckText(context.Background(), "x")
		if err != nil {
			t.Fatalf("%s: %v", c.level, err)
		}
		if res.Allowed != c.wantAllowed {
			t.Errorf("%s: Allowed = %v, want %v", c.level, res.Allowed, c.wantAllowed)
		}
	}
}

// TestUnknownLevelDoesNotBlock — Google yangi daraja nomi qo'shsa e'lonlar
// to'satdan rad etila boshlamasligi kerak.
func TestUnknownLevelDoesNotBlock(t *testing.T) {
	svc, _ := newService(always(flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", "SOMETHING_NEW")))

	res, err := svc.CheckText(context.Background(), "x")
	if err != nil {
		t.Fatalf("CheckText: %v", err)
	}
	if !res.Allowed {
		t.Error("Allowed = false — noma'lum daraja bloklamasligi kerak")
	}
}

// TestBlockReasonRejects — Gemini kirishning o'zini bloklasa (masalan
// IMAGE_SAFETY) kategoriyalar bo'sh bo'lsa ham rad etiladi.
func TestBlockReasonRejects(t *testing.T) {
	svc, _ := newService(always(&gemini.Verdict{
		Ratings: map[string]string{}, BlockReason: "IMAGE_SAFETY",
	}))

	res, err := svc.CheckImage(context.Background(), "image/png", []byte{1, 2, 3})
	if err != nil {
		t.Fatalf("CheckImage: %v", err)
	}
	if res.Allowed {
		t.Fatalf("Allowed = true, want false (%+v)", res)
	}
	if res.BlockReason != "IMAGE_SAFETY" {
		t.Errorf("BlockReason = %q, want IMAGE_SAFETY", res.BlockReason)
	}
	if res.Reason == "" {
		t.Error("Reason bo'sh — foydalanuvchiga sabab ko'rsatilishi kerak")
	}
}

func TestDisabledService(t *testing.T) {
	svc := New(&fakeClassifier{configured: false, fn: always(negligible())})
	if svc.Enabled() {
		t.Fatal("Enabled() = true kalitsiz")
	}
	if _, err := svc.CheckText(context.Background(), "x"); !errors.Is(err, ErrDisabled) {
		t.Errorf("err = %v, want ErrDisabled", err)
	}

	h := NewHandler(svc, 0)
	rec := httptest.NewRecorder()
	h.Text(rec, httptest.NewRequest(http.MethodPost, "/api/moderation/text",
		strings.NewReader(`{"text":"salom"}`)))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "moderation_disabled") {
		t.Errorf("body = %s", rec.Body.String())
	}
}

// ─── Rasm moderatsiyasi ──────────────────────────────────────────────────────

// pngBytes n×n haqiqiy PNG qaytaradi — tashqi test fayli kerak emas.
func pngBytes(t *testing.T, n int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	for x := 0; x < n; x++ {
		for y := 0; y < n; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 0x80, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return buf.Bytes()
}

func multipartReq(t *testing.T, path, field, filename string, data []byte, extra map[string]string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range extra {
		_ = mw.WriteField(k, v)
	}
	if data != nil {
		fw, err := mw.CreateFormFile(field, filename)
		if err != nil {
			t.Fatalf("CreateFormFile: %v", err)
		}
		if _, err := fw.Write(data); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestImageNormalIsAllowed(t *testing.T) {
	svc, f := newService(always(negligible()))
	h := NewHandler(svc, 0)

	rec := httptest.NewRecorder()
	h.Image(rec, multipartReq(t, "/api/moderation/image", "image", "ok.png", pngBytes(t, 32), nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		Allowed bool   `json:"allowed"`
		MIME    string `json:"mime"`
		Model   string `json:"model"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !out.Allowed {
		t.Error("allowed = false, want true")
	}
	if out.MIME != "image/png" {
		t.Errorf("mime = %q, want image/png", out.MIME)
	}
	if out.Model != gemini.DefaultModel {
		t.Errorf("model = %q, want %q", out.Model, gemini.DefaultModel)
	}
	// Rasm haqiqatan klassifikatorga baytlar bilan yetib borganini tekshiramiz.
	if f.callCount() != 1 || len(f.calls[0].Image) == 0 {
		t.Errorf("klassifikatorga rasm baytlari yuborilmadi: %+v", f.calls)
	}
}

func TestImageNSFWIsRejected(t *testing.T) {
	svc, _ := newService(always(flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", gemini.ProbHigh)))
	h := NewHandler(svc, 0)

	rec := httptest.NewRecorder()
	h.Image(rec, multipartReq(t, "/api/moderation/image", "image", "nsfw.png", pngBytes(t, 32), nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out Result
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Allowed {
		t.Errorf("allowed = true, want false (%s)", rec.Body.String())
	}
	if !out.Categories["HARM_CATEGORY_SEXUALLY_EXPLICIT"] {
		t.Errorf("categories = %v", out.Categories)
	}
}

// TestImageRejectsNonImage — klient Content-Type'iga ishonilmaydi:
// ".png" nomi bilan kelgan HTML ham rad etilishi kerak.
func TestImageRejectsNonImage(t *testing.T) {
	svc, f := newService(always(negligible()))
	h := NewHandler(svc, 0)

	rec := httptest.NewRecorder()
	h.Image(rec, multipartReq(t, "/api/moderation/image", "image", "evil.png",
		[]byte("<html><script>alert(1)</script>"), nil))

	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("status = %d, want 415 (%s)", rec.Code, rec.Body.String())
	}
	if f.callCount() != 0 {
		t.Error("yaroqsiz fayl uchun tashqi chaqiruv bo'lmasligi kerak")
	}
}

func TestImageRejectsOversized(t *testing.T) {
	svc, _ := newService(always(negligible()))
	img := pngBytes(t, 256)
	h := NewHandler(svc, int64(len(img))-1)

	rec := httptest.NewRecorder()
	h.Image(rec, multipartReq(t, "/api/moderation/image", "image", "big.png", img, nil))

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413 (%s)", rec.Code, rec.Body.String())
	}
}

func TestImageRequiresFile(t *testing.T) {
	svc, _ := newService(always(negligible()))
	h := NewHandler(svc, 0)

	rec := httptest.NewRecorder()
	h.Image(rec, multipartReq(t, "/api/moderation/image", "image", "", nil, map[string]string{"text": "salom"}))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

// ─── Combined moderatsiya (/api/moderation/check) ────────────────────────────

func TestCombinedModeration(t *testing.T) {
	bad := flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", gemini.ProbHigh)
	ok := negligible()

	cases := []struct {
		name             string
		text, img        *gemini.Verdict
		wantAllowed      bool
		wantTextAllowed  bool
		wantImageAllowed bool
	}{
		{"toza matn + toza rasm", ok, ok, true, true, true},
		{"toza matn + yomon rasm", ok, bad, false, true, false},
		{"yomon matn + toza rasm", bad, ok, false, false, true},
		{"yomon matn + yomon rasm", bad, bad, false, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc, _ := newService(byInput(c.text, c.img))
			h := NewHandler(svc, 0)

			rec := httptest.NewRecorder()
			h.Check(rec, multipartReq(t, "/api/moderation/check", "image", "a.png",
				pngBytes(t, 32), map[string]string{"text": "e'lon matni"}))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
			}
			var out CheckResult
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if out.Allowed != c.wantAllowed {
				t.Errorf("allowed = %v, want %v (%s)", out.Allowed, c.wantAllowed, rec.Body.String())
			}
			if out.Text == nil || out.Image == nil {
				t.Fatalf("text va image bo'limlari bo'lishi kerak: %s", rec.Body.String())
			}
			if out.Text.Allowed != c.wantTextAllowed {
				t.Errorf("text.allowed = %v, want %v", out.Text.Allowed, c.wantTextAllowed)
			}
			if out.Image.Allowed != c.wantImageAllowed {
				t.Errorf("image.allowed = %v, want %v", out.Image.Allowed, c.wantImageAllowed)
			}
			if out.Model != gemini.DefaultModel {
				t.Errorf("model = %q", out.Model)
			}
		})
	}
}

// TestCheckJSONOnly — rasm yubormoqchi bo'lmagan klient oddiy JSON bilan
// ham murojaat qila oladi.
func TestCheckJSONOnly(t *testing.T) {
	svc, _ := newService(always(negligible()))
	h := NewHandler(svc, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/moderation/check",
		strings.NewReader(`{"text":"Qurilishga 3 ta ishchi kerak"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.Check(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var out CheckResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !out.Allowed {
		t.Error("allowed = false, want true")
	}
	if out.Image != nil {
		t.Errorf("image = %+v, rasm yuborilmagan edi", out.Image)
	}
}

func TestTextHandlerRejectsEmpty(t *testing.T) {
	svc, _ := newService(always(negligible()))
	h := NewHandler(svc, 0)

	rec := httptest.NewRecorder()
	h.Text(rec, httptest.NewRequest(http.MethodPost, "/api/moderation/text",
		strings.NewReader(`{"text":"   "}`)))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

// ─── Xato holatlari ──────────────────────────────────────────────────────────

// TestUpstreamErrorMapping — Gemini xatolari mijozga to'g'ri HTTP status
// bilan yetkaziladi va backend yiqilmaydi.
func TestUpstreamErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"kalit yo'q", gemini.ErrNotConfigured, http.StatusServiceUnavailable, "moderation_disabled"},
		{"unauthorized", &gemini.APIError{Status: 401, RPCStatus: "UNAUTHENTICATED"}, http.StatusBadGateway, "moderation_failed"},
		{"forbidden", &gemini.APIError{Status: 403, RPCStatus: "PERMISSION_DENIED"}, http.StatusBadGateway, "moderation_failed"},
		{"kvota", &gemini.APIError{Status: 429, RPCStatus: "RESOURCE_EXHAUSTED"}, http.StatusServiceUnavailable, "moderation_unavailable"},
		{"server xatosi", &gemini.APIError{Status: 503, RPCStatus: "UNAVAILABLE"}, http.StatusServiceUnavailable, "moderation_unavailable"},
		{"yaroqsiz so'rov", &gemini.APIError{Status: 400, RPCStatus: "INVALID_ARGUMENT"}, http.StatusBadGateway, "moderation_failed"},
		{"timeout", context.DeadlineExceeded, http.StatusGatewayTimeout, "moderation_timeout"},
		{"noma'lum", errors.New("boom"), http.StatusBadGateway, "moderation_failed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc, _ := newService(func(gemini.Input) (*gemini.Verdict, error) { return nil, c.err })
			h := NewHandler(svc, 0)

			rec := httptest.NewRecorder()
			h.Text(rec, httptest.NewRequest(http.MethodPost, "/api/moderation/text",
				strings.NewReader(`{"text":"salom"}`)))

			if rec.Code != c.wantStatus {
				t.Errorf("status = %d, want %d (%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), c.wantCode) {
				t.Errorf("body = %s, want code %q", rec.Body.String(), c.wantCode)
			}
		})
	}
}
