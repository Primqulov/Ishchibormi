package user

import (
	"context"
	"errors"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/pkg/gemini"
)

// fakeClassifier — moderation.Classifier mock'i (tarmoqsiz, kalitsiz).
type fakeClassifier struct {
	flag  bool
	err   error
	calls int
	last  string
}

func (f *fakeClassifier) Configured() bool { return true }
func (f *fakeClassifier) Model() string    { return gemini.DefaultModel }

func (f *fakeClassifier) Classify(_ context.Context, in gemini.Input) (*gemini.Verdict, error) {
	f.calls++
	f.last = in.Text
	if f.err != nil {
		return nil, f.err
	}
	r := map[string]string{}
	for _, c := range gemini.Categories {
		r[c] = gemini.ProbNegligible
	}
	if f.flag {
		r["HARM_CATEGORY_HATE_SPEECH"] = gemini.ProbHigh
	}
	return &gemini.Verdict{Ratings: r}, nil
}

func handlerWith(f *fakeClassifier, opts moderation.GuardOptions) *Handler {
	h := &Handler{}
	h.AttachModerator(moderation.NewGuard(moderation.New(f), nil, opts))
	return h
}

func ptr(s string) *string { return &s }

func TestProfileAllowsNormalFields(t *testing.T) {
	f := &fakeClassifier{}
	h := handlerWith(f, moderation.GuardOptions{Enforce: true})

	req := updateMeReq{
		FirstName: ptr("Ali"), LastName: ptr("Valiyev"),
		Bio:    ptr("10 yillik qurilish tajribasi bor."),
		Skills: []string{"g'isht terish", "suvoq"},
	}
	if _, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), req); err != nil {
		t.Fatalf("oddiy profil rad etildi: %v", err)
	}
	if f.calls != 1 {
		t.Errorf("chaqiruvlar = %d, want 1 (barcha maydonlar BIRGA)", f.calls)
	}
	for _, want := range []string{"Ali", "Valiyev", "qurilish", "suvoq"} {
		if !strings.Contains(f.last, want) {
			t.Errorf("yuborilgan matnda %q yo'q: %q", want, f.last)
		}
	}
}

func TestProfileRejectsHatefulBio(t *testing.T) {
	h := handlerWith(&fakeClassifier{flag: true}, moderation.GuardOptions{Enforce: true})

	_, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("nafrat matni")})
	if err == nil {
		t.Fatal("rad etilishi kerak edi")
	}
	if !strings.Contains(err.Error(), "Profil saqlanmadi") {
		t.Errorf("xabar = %q, 'Profil saqlanmadi' kutilgan", err.Error())
	}
	// Kategoriya nomi foydalanuvchiga oshkor qilinmaydi.
	for _, leak := range []string{"nafrat", "seksual", "haqorat", "HARM_CATEGORY"} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("xabar kategoriyani oshkor qildi (%q): %q", leak, err.Error())
		}
	}
	if !strings.Contains(err.Error(), "nomaqbul") {
		t.Errorf("xabar = %q, umumiy 'nomaqbul' matni kutilgan", err.Error())
	}
}

// TestProfileChecksOnlyChangedFields — PATCH semantikasi: tegilmagan
// maydonlar nil bo'lgani uchun tekshirilmaydi.
func TestProfileChecksOnlyChangedFields(t *testing.T) {
	f := &fakeClassifier{}
	h := handlerWith(f, moderation.GuardOptions{Enforce: true})

	// Faqat mintaqa o'zgardi — erkin matn yo'q, tashqi chaqiruv kerak emas.
	if _, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Region: ptr("Toshkent")}); err != nil {
		t.Fatalf("kutilmagan xato: %v", err)
	}
	if f.calls != 0 {
		t.Errorf("chaqiruvlar = %d, want 0 (faqat region o'zgardi)", f.calls)
	}

	// Faqat bio o'zgardi — bitta chaqiruv, ichida faqat bio.
	if _, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("Yangi bio")}); err != nil {
		t.Fatalf("kutilmagan xato: %v", err)
	}
	if f.calls != 1 {
		t.Errorf("chaqiruvlar = %d, want 1", f.calls)
	}
	if f.last != "Yangi bio" {
		t.Errorf("yuborilgan matn = %q, want %q", f.last, "Yangi bio")
	}
}

func TestProfileModerationOffIsNoop(t *testing.T) {
	// Guard umuman ulanmagan.
	h := &Handler{}
	if _, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("yomon")}); err != nil {
		t.Fatalf("moderator ulanmagan holatda xato: %v", err)
	}

	f := &fakeClassifier{flag: true}
	h2 := handlerWith(f, moderation.GuardOptions{Enforce: false})
	if _, err := h2.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("yomon")}); err != nil {
		t.Fatalf("o'chiq bayroqda xato: %v", err)
	}
	if f.calls != 0 {
		t.Errorf("chaqiruvlar = %d, want 0", f.calls)
	}
}

func TestProfileFailClosed(t *testing.T) {
	h := handlerWith(&fakeClassifier{err: errors.New("down")},
		moderation.GuardOptions{Enforce: true, FailClosed: true})
	if _, err := h.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("matn")}); err == nil {
		t.Error("fail-closed: rad etilishi kerak edi")
	}

	h2 := handlerWith(&fakeClassifier{err: errors.New("down")},
		moderation.GuardOptions{Enforce: true})
	if _, err := h2.moderateProfile(context.Background(), primitive.NewObjectID(), updateMeReq{Bio: ptr("matn")}); err != nil {
		t.Errorf("fail-open: o'tishi kerak edi: %v", err)
	}
}
