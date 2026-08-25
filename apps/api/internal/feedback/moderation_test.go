package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/pkg/gemini"
)

// fakeClassifier — moderation.Classifier mock'i. Testlar haqiqiy Gemini
// API'ga chiqmaydi.
type fakeClassifier struct {
	flag  bool
	err   error
	calls int
}

func (f *fakeClassifier) Configured() bool { return true }
func (f *fakeClassifier) Model() string    { return gemini.DefaultModel }

func (f *fakeClassifier) Classify(context.Context, gemini.Input) (*gemini.Verdict, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	r := map[string]string{}
	for _, c := range gemini.Categories {
		r[c] = gemini.ProbNegligible
	}
	if f.flag {
		r["HARM_CATEGORY_HARASSMENT"] = gemini.ProbHigh
	}
	return &gemini.Verdict{Ratings: r}, nil
}

func guardFor(f *fakeClassifier, opts moderation.GuardOptions) *moderation.Guard {
	return moderation.NewGuard(moderation.New(f), nil, opts)
}

// TestModerateFeedbackRejectsAbusiveText — nomaqbul taklif/shikoyat matni
// bazaga yozilmasdan va adminlarga tarqalmasdan rad etiladi.
func TestModerateFeedbackRejectsAbusiveText(t *testing.T) {
	f := &fakeClassifier{flag: true}
	h := &Handler{}
	h.AttachModerator(guardFor(f, moderation.GuardOptions{Enforce: true}))

	err := h.moderateFeedback(context.Background(), primitive.NewObjectID(), "Shikoyat", "haqoratli matn")
	if err == nil {
		t.Fatal("rad etilishi kerak edi")
	}
	if !strings.Contains(err.Error(), "Xabar yuborilmadi") {
		t.Errorf("xabar = %q, 'Xabar yuborilmadi' kutilgan", err.Error())
	}
	if f.calls != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (mavzu va matn BIRGA)", f.calls)
	}
}

func TestModerateFeedbackAllowsNormalText(t *testing.T) {
	f := &fakeClassifier{}
	h := &Handler{}
	h.AttachModerator(guardFor(f, moderation.GuardOptions{Enforce: true}))

	if err := h.moderateFeedback(context.Background(), primitive.NewObjectID(), "Taklif", "Ilovaga xarita qo'shsangiz yaxshi bo'lardi"); err != nil {
		t.Fatalf("oddiy taklif rad etildi: %v", err)
	}
}

// TestFeedbackModerationOffIsNoop — guard ulanmagan bo'lsa mavjud oqim
// bir zarracha o'zgarmaydi.
func TestFeedbackModerationOffIsNoop(t *testing.T) {
	h := &Handler{} // AttachModerator umuman chaqirilmagan
	if err := h.moderateFeedback(context.Background(), primitive.NewObjectID(), "x", "yomon matn"); err != nil {
		t.Fatalf("moderator ulanmagan holatda xato: %v", err)
	}

	f := &fakeClassifier{flag: true}
	h2 := &Handler{}
	h2.AttachModerator(guardFor(f, moderation.GuardOptions{Enforce: false}))
	if err := h2.moderateFeedback(context.Background(), primitive.NewObjectID(), "x", "yomon matn"); err != nil {
		t.Fatalf("o'chiq bayroqda xato: %v", err)
	}
	if f.calls != 0 {
		t.Errorf("chaqiruvlar = %d, want 0", f.calls)
	}
}

// TestFeedbackFailClosed — tashqi xizmat ishlamay qolsa fail-closed rejimda
// xabar qabul qilinmaydi.
func TestFeedbackFailClosed(t *testing.T) {
	f := &fakeClassifier{err: errors.New("down")}
	h := &Handler{}
	h.AttachModerator(guardFor(f, moderation.GuardOptions{Enforce: true, FailClosed: true}))

	if err := h.moderateFeedback(context.Background(), primitive.NewObjectID(), "x", "matn"); err == nil {
		t.Error("fail-closed: rad etilishi kerak edi")
	}

	f2 := &fakeClassifier{err: errors.New("down")}
	h2 := &Handler{}
	h2.AttachModerator(guardFor(f2, moderation.GuardOptions{Enforce: true}))
	if err := h2.moderateFeedback(context.Background(), primitive.NewObjectID(), "x", "matn"); err != nil {
		t.Errorf("fail-open: o'tishi kerak edi: %v", err)
	}
}

// TestCreateRejectsBeforeWriting — HTTP darajasida: nomaqbul xabar 422
// qaytaradi va Mongo'ga umuman tegilmaydi (Col nil bo'lsa ham panic yo'q,
// ya'ni yozuv bosqichiga yetib bormaydi).
func TestCreateRejectsBeforeWriting(t *testing.T) {
	h := &Handler{} // Col/Users/Admins nil — yozuvga yetsa panic bo'lardi
	h.AttachModerator(guardFor(&fakeClassifier{flag: true}, moderation.GuardOptions{Enforce: true}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/feedback",
		strings.NewReader(`{"type":"complaint","subject":"Shikoyat","message":"haqoratli matn"}`))
	h.Create(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (%s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error.Code != "content_rejected" {
		t.Errorf("code = %q, want content_rejected", body.Error.Code)
	}
	if !strings.Contains(body.Error.Message, "Xabar yuborilmadi") {
		t.Errorf("message = %q", body.Error.Message)
	}
}
