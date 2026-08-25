package moderation

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
)

func guardWith(t *testing.T, opts GuardOptions, fn func(gemini.Input) (*gemini.Verdict, error)) (*Guard, *fakeClassifier) {
	t.Helper()
	f := &fakeClassifier{configured: true, fn: fn}
	return NewGuard(New(f), nil, opts), f
}

func status(t *testing.T, err error) (int, string, string) {
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

func TestGuardAllowsCleanText(t *testing.T) {
	g, f := guardWith(t, GuardOptions{Enforce: true}, always(negligible()))

	if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "profile", "Profil saqlanmadi",
		"Aliyev", "Ali", "Qurilish ustasi"); err != nil {
		t.Fatalf("toza matn rad etildi: %v", err)
	}
	if f.callCount() != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (barcha bo'laklar BIRGA yuborilishi kerak)", f.callCount())
	}
	// Bo'laklar haqiqatan bitta matnga qo'shilganini tekshiramiz.
	sent := f.calls[0].Text
	for _, want := range []string{"Aliyev", "Ali", "Qurilish ustasi"} {
		if !strings.Contains(sent, want) {
			t.Errorf("yuborilgan matnda %q yo'q: %q", want, sent)
		}
	}
}

func TestGuardRejectsWithPrefix(t *testing.T) {
	g, _ := guardWith(t, GuardOptions{Enforce: true},
		always(flagged("HARM_CATEGORY_HARASSMENT", gemini.ProbHigh)))

	_, mErr := g.CheckText(context.Background(), primitive.NewObjectID(), "profile", "Profil saqlanmadi", "haqoratli bio")
	code, errCode, msg := statusOf(t, mErr)
	if code != http.StatusUnprocessableEntity || errCode != "content_rejected" {
		t.Errorf("status=%d code=%q, want 422/content_rejected", code, errCode)
	}
	if !strings.HasPrefix(msg, "Profil saqlanmadi:") {
		t.Errorf("xabar = %q, 'Profil saqlanmadi:' bilan boshlanishi kerak", msg)
	}
	// Foydalanuvchiga qaysi kategoriya ishlagani AYTILMAYDI.
	for _, leak := range []string{"haqorat", "seksual", "nafrat", "HARM_CATEGORY"} {
		if strings.Contains(msg, leak) {
			t.Errorf("xabar kategoriyani oshkor qildi (%q): %q", leak, msg)
		}
	}
	if !strings.Contains(msg, "nomaqbul") {
		t.Errorf("xabar = %q, umumiy 'nomaqbul' matni kutilgan", msg)
	}
}

// TestGuardOffIsNoop — bayroq o'chiq bo'lsa hech qanday tashqi chaqiruv
// bo'lmasligi kerak.
func TestGuardOffIsNoop(t *testing.T) {
	g, f := guardWith(t, GuardOptions{Enforce: false},
		always(flagged("HARM_CATEGORY_HARASSMENT", gemini.ProbHigh)))

	if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "yomon matn"); err != nil {
		t.Fatalf("o'chiq guard xato qaytardi: %v", err)
	}
	if f.callCount() != 0 {
		t.Errorf("chaqiruvlar = %d, want 0", f.callCount())
	}
}

func TestGuardEmptyTextSkipsCall(t *testing.T) {
	g, f := guardWith(t, GuardOptions{Enforce: true}, always(negligible()))

	if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "", "   ", ""); err != nil {
		t.Fatalf("bo'sh matn xato qaytardi: %v", err)
	}
	if f.callCount() != 0 {
		t.Errorf("chaqiruvlar = %d, want 0 (bo'sh matn uchun so'rov kerak emas)", f.callCount())
	}
}

// TestGuardFailOpenClosed — tashqi xizmat ishlamay qolganda siyosat.
func TestGuardFailOpenClosed(t *testing.T) {
	boom := func(gemini.Input) (*gemini.Verdict, error) {
		return nil, &gemini.APIError{Status: 503, RPCStatus: "UNAVAILABLE"}
	}

	open, _ := guardWith(t, GuardOptions{Enforce: true}, boom)
	if _, err := open.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "matn"); err != nil {
		t.Errorf("fail-open: o'tishi kerak edi, xato: %v", err)
	}

	closed, _ := guardWith(t, GuardOptions{Enforce: true, FailClosed: true}, boom)
	_, mErr := closed.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "matn")
	code, errCode, _ := statusOf(t, mErr)
	if code != http.StatusServiceUnavailable || errCode != "moderation_unavailable" {
		t.Errorf("fail-closed: status=%d code=%q, want 503/moderation_unavailable", code, errCode)
	}
}

// TestGuardDisabledServiceIsNoop — kalit berilmagan bo'lsa bayroq yoqilgan
// bo'lsa ham hech narsa qilinmaydi (backend kalitsiz ham ishlashi kerak).
func TestGuardDisabledServiceIsNoop(t *testing.T) {
	f := &fakeClassifier{configured: false, fn: always(flagged("HARM_CATEGORY_HARASSMENT", gemini.ProbHigh))}
	g := NewGuard(New(f), nil, GuardOptions{Enforce: true, FailClosed: true})

	if g.On() {
		t.Fatal("On() = true kalitsiz")
	}
	if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "yomon"); err != nil {
		t.Errorf("kalitsiz guard xato qaytardi: %v", err)
	}
}

// TestReasonWithPrefix — foydalanuvchiga ko'rsatiladigan sabab HAR DOIM
// umumiy: qaysi kategoriya ishlagani oshkor qilinmaydi.
func TestReasonWithPrefix(t *testing.T) {
	r := &Result{
		Allowed:    false,
		Categories: map[string]bool{"HARM_CATEGORY_SEXUALLY_EXPLICIT": true},
		Levels:     map[string]string{"HARM_CATEGORY_SEXUALLY_EXPLICIT": gemini.ProbHigh},
	}
	if got := r.ReasonWithPrefix("Xabar yuborilmadi"); got != "Xabar yuborilmadi: nomaqbul kontent." {
		t.Errorf("ReasonWithPrefix = %q", got)
	}
	// Kategoriyasiz blok ham xuddi shu matnni beradi — foydalanuvchi uchun
	// ikki holat farqlanmaydi.
	blocked := &Result{Allowed: false, Categories: map[string]bool{}, BlockReason: "IMAGE_SAFETY"}
	if got := blocked.ReasonWithPrefix("Profil saqlanmadi"); got != "Profil saqlanmadi: nomaqbul kontent." {
		t.Errorf("blok sababi = %q", got)
	}
	// Ruxsat berilgan natija sabab bermaydi.
	if got := (&Result{Allowed: true}).ReasonWithPrefix("X"); got != "" {
		t.Errorf("ruxsat berilgan natija uchun sabab = %q, want empty", got)
	}
}

// TestDetail — tafsilot SERVER LOGI uchun saqlanadi: sabab umumiy bo'lgani
// uchun, bunisiz nima uchun rad etilganini bilib bo'lmasdi.
func TestDetail(t *testing.T) {
	r := &Result{
		Allowed:    false,
		Categories: map[string]bool{"HARM_CATEGORY_SEXUALLY_EXPLICIT": true, "HARM_CATEGORY_HARASSMENT": true},
		Levels: map[string]string{
			"HARM_CATEGORY_SEXUALLY_EXPLICIT": gemini.ProbHigh,
			"HARM_CATEGORY_HARASSMENT":        gemini.ProbMedium,
		},
	}
	// Tartib barqaror (alifbo bo'yicha) — loglarni taqqoslash uchun.
	want := "HARM_CATEGORY_HARASSMENT=MEDIUM HARM_CATEGORY_SEXUALLY_EXPLICIT=HIGH"
	if got := r.Detail(); got != want {
		t.Errorf("Detail = %q, want %q", got, want)
	}
	blocked := &Result{Categories: map[string]bool{}, BlockReason: "IMAGE_SAFETY"}
	if got := blocked.Detail(); got != "blockReason=IMAGE_SAFETY" {
		t.Errorf("Detail = %q", got)
	}
}

// statusOf — status'ning taxallusi (CheckText ikki qiymat qaytargani uchun
// chaqiruv ikki qatorga bo'lingan).
func statusOf(t *testing.T, err error) (int, string, string) {
	t.Helper()
	return status(t, err)
}

// ─── Kvota tugashi ───────────────────────────────────────────────────────────

func quotaErr() error {
	return &gemini.APIError{Status: 429, RPCStatus: "RESOURCE_EXHAUSTED", Message: "quota"}
}

// TestQuotaAlwaysFailsOpen — kvota tugaganda kontent O'TKAZIB YUBORILADI,
// FailClosed yoqilgan bo'lsa ham.
//
// Sabab: kvota tugashi kutilgan va o'z-o'zidan tiklanadigan holat. Uni
// fail-closed qilib qo'yish e'lon joylashni butunlay to'xtatib qo'yardi.
func TestQuotaAlwaysFailsOpen(t *testing.T) {
	for _, failClosed := range []bool{false, true} {
		g, _ := guardWith(t, GuardOptions{Enforce: true, FailClosed: failClosed},
			func(gemini.Input) (*gemini.Verdict, error) { return nil, quotaErr() })

		out, err := g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "E'lon qabul qilinmadi", "matn")
		if err != nil {
			t.Errorf("failClosed=%v: kvota tugaganda xato qaytdi: %v", failClosed, err)
		}
		if out != OutcomeSkipped {
			t.Errorf("failClosed=%v: outcome = %v, want OutcomeSkipped", failClosed, out)
		}
	}
}

// TestNonQuotaFailureRespectsPolicy — kvotadan BOSHQA uzilishlar uchun
// avvalgi FailClosed siyosati kuchda qoladi.
func TestNonQuotaFailureRespectsPolicy(t *testing.T) {
	down := func(gemini.Input) (*gemini.Verdict, error) {
		return nil, &gemini.APIError{Status: 503, RPCStatus: "UNAVAILABLE"}
	}

	open, _ := guardWith(t, GuardOptions{Enforce: true}, down)
	if _, err := open.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "matn"); err != nil {
		t.Errorf("fail-open: o'tishi kerak edi: %v", err)
	}

	closed, _ := guardWith(t, GuardOptions{Enforce: true, FailClosed: true}, down)
	_, err := closed.CheckText(context.Background(), primitive.NewObjectID(), "x", "X", "matn")
	code, errCode, _ := statusOf(t, err)
	if code != http.StatusServiceUnavailable || errCode != "moderation_unavailable" {
		t.Errorf("fail-closed: status=%d code=%q, want 503/moderation_unavailable", code, errCode)
	}
}

// TestQuotaCooldownStopsCalls — 429 dan keyin qisqa vaqt umuman so'rov
// yuborilmaydi (foydalanuvchi bexosdan kechikishni sezmasligi uchun).
func TestQuotaCooldownStopsCalls(t *testing.T) {
	g, f := guardWith(t, GuardOptions{Enforce: true},
		func(gemini.Input) (*gemini.Verdict, error) { return nil, quotaErr() })

	for i := 0; i < 5; i++ {
		if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "X", "matn"); err != nil {
			t.Fatalf("%d: %v", i, err)
		}
	}
	if f.callCount() != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (birinchi 429 dan keyin sovish oynasi)", f.callCount())
	}
}

// TestQuotaRecovers — sovish oynasi tugagach tekshiruv O'ZIDAN-O'ZI davom
// etadi: hech qanday qo'lda aralashuv kerak emas.
func TestQuotaRecovers(t *testing.T) {
	var fail bool
	f := &fakeClassifier{configured: true, fn: func(gemini.Input) (*gemini.Verdict, error) {
		if fail {
			return nil, quotaErr()
		}
		return flagged("HARM_CATEGORY_SEXUALLY_EXPLICIT", gemini.ProbHigh), nil
	}}
	g := NewGuard(New(f), nil, GuardOptions{Enforce: true})

	// Kvota tugadi — o'tkazib yuboriladi.
	fail = true
	out, err := g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "X", "matn")
	if err != nil || out != OutcomeSkipped {
		t.Fatalf("kvota tugagan: out=%v err=%v", out, err)
	}

	// Kvota yangilandi va sovish oynasi tugadi — tekshiruv qayta ishlaydi.
	fail = false
	g.quotaMu.Lock()
	g.quotaUntil = time.Now().Add(-time.Second)
	g.quotaMu.Unlock()

	out, err = g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "X", "matn")
	if err == nil {
		t.Fatal("kvota tiklangach nomaqbul kontent rad etilishi kerak edi")
	}
	if out != OutcomeChecked {
		t.Errorf("outcome = %v, want OutcomeChecked", out)
	}
}

// TestQuotaMessageNeverLeaksToUser — foydalanuvchi AI kvotasi tugaganini
// BILMASLIGI kerak: javob butunlay odatdagidek qaytadi.
func TestQuotaMessageNeverLeaksToUser(t *testing.T) {
	g, _ := guardWith(t, GuardOptions{Enforce: true, FailClosed: true},
		func(gemini.Input) (*gemini.Verdict, error) { return nil, quotaErr() })

	_, err := g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "E'lon qabul qilinmadi", "matn")
	if err != nil {
		t.Fatalf("foydalanuvchiga xato qaytdi: %v", err)
	}
}

// TestQuotaDoesNotCountAsStrike — tekshirilmagan kontent buzilish emas:
// foydalanuvchi hisobiga strike qo'shilmasligi kerak.
func TestQuotaDoesNotCountAsStrike(t *testing.T) {
	g, _ := guardWith(t, GuardOptions{Enforce: true},
		func(gemini.Input) (*gemini.Verdict, error) { return nil, quotaErr() })

	// Strike do'koni nil — agar kod strike yozmoqchi bo'lsa, nil'ga
	// murojaat qilib panic bo'lardi. Panic yo'qligi strike yozilmaganini
	// bilvosita tasdiqlaydi; asosiy dalil esa xato qaytmasligi.
	if _, err := g.CheckText(context.Background(), primitive.NewObjectID(), "elon", "X", "matn"); err != nil {
		t.Fatalf("xato: %v", err)
	}
}
