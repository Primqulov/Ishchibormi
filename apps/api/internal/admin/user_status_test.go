package admin

import (
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
)

// Audit yozuvining `detail` maydoni KOD ICHIDAGI texnik belgi
// ("unblock (+moderatsiya bloki)"). U panelga o'z holida chiqib ketmasligi
// kerak: admin ekranda qavs ichidagi ingliz so'zini emas, o'zbekcha
// tushuntirishni ko'rishi lozim.
func TestStatusFromActionNormalizesUnblockDetail(t *testing.T) {
	kind, detail := statusFromAction("user_unblock", "unblock (+moderatsiya bloki)")
	if kind != statusKindUnblock {
		t.Errorf("tur = %q, kutilgan %q", kind, statusKindUnblock)
	}
	if detail != "Avtomatik moderatsiya bloki ham ochildi" {
		t.Errorf("detal = %q — texnik satr o'tib ketdi", detail)
	}

	// Oddiy qo'l blokini ochish — qo'shimcha izohsiz.
	if kind, detail := statusFromAction("user_unblock", "unblock"); kind != statusKindUnblock || detail != "" {
		t.Errorf("oddiy unblock -> (%q, %q), kutilgan (%q, \"\")", kind, detail, statusKindUnblock)
	}
}

// Blok sababi O'ZGARTIRILMASLIGI kerak: admin yozgan matn e'tirozni
// tekshirishdagi asosiy dalil.
func TestStatusFromActionKeepsBlockReasonVerbatim(t *testing.T) {
	sabab := "takroriy spam e'lonlar"
	kind, detail := statusFromAction("user_block", sabab)
	if kind != statusKindBlock || detail != sabab {
		t.Errorf("-> (%q, %q), kutilgan (%q, %q)", kind, detail, statusKindBlock, sabab)
	}
}

// Ro'yxat YOPIQ: hisob holatini o'zgartirmaydigan amal tarixga
// tushmasligi kerak. Aks holda "Holatlar tarixi" audit logning nusxasiga
// aylanardi va bloklanish sababi shovqin ichida ko'rinmay qolardi.
func TestStatusFromActionIgnoresUnrelatedActions(t *testing.T) {
	for _, a := range []string{
		"user_notify", "admin_login", "elon_hide", "broadcast_send", "", "USER_BLOCK",
	} {
		if kind, _ := statusFromAction(a, "x"); kind != "" {
			t.Errorf("%q amali tarixga tushdi (tur = %q)", a, kind)
		}
	}
}

// XAVFSIZLIK: adminning ROLI faqat superadminga ko'rsatiladi — adminlar
// ro'yxati ham faqat superadmin uchun ochiq, ya'ni moderator hamkasbining
// vakolat darajasini bilishi shart emas.
func TestAdminBriefLabelHidesRoleFromNonSuperadmin(t *testing.T) {
	b := adminBrief{Username: "nodira", Role: "moderator"}
	if got := b.label(false); got != "nodira" {
		t.Errorf("rol oshkor bo'ldi: %q", got)
	}
	if got := b.label(true); got != "nodira · moderator" {
		t.Errorf("superadmin uchun yorliq = %q", got)
	}
	// Admin bazadan o'chirilgan — nomi yo'q, rol ham chiqmasligi kerak.
	if got := (adminBrief{Role: "superadmin"}).label(true); got != "" {
		t.Errorf("nomsiz admin uchun yorliq = %q, kutilgan \"\"", got)
	}
}

// Tarix eng yangisidan boshlanadi va avtomatik moderatsiya bloki ham
// unutilmaydi: uni tizim qo'yadi, shuning uchun audit logda YO'Q — faqat
// foydalanuvchi hujjatidan olinadi.
func TestStatusHistoryOrderAndAutoBan(t *testing.T) {
	h := &Handler{} // kolleksiyalar nil — audit qismi o'tkazib yuboriladi
	yaratilgan := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	bloklangan := time.Date(2026, 5, 20, 14, 30, 0, 0, time.UTC)
	muddat := bloklangan.AddDate(2, 0, 0)

	u := models.User{
		CreatedAt:             yaratilgan,
		BlockedAt:             &bloklangan,
		BlockSource:           moderation.BlockSourceModeration,
		BlockReason:           moderation.AutoBanReason(3),
		ModerationBannedUntil: &muddat,
	}
	rec := &moderation.StrikeRecord{Events: []moderation.StrikeEvent{
		{Kind: moderation.KindElon, At: time.Date(2026, 4, 10, 12, 0, 0, 0, time.UTC)},
		{Kind: moderation.KindAvatar, At: time.Date(2026, 5, 20, 14, 29, 0, 0, time.UTC)},
	}}

	got := h.statusHistory(context.Background(), &u, rec, false)

	kutilgan := []string{statusKindBlock, statusKindWarn, statusKindWarn, statusKindSignup}
	if len(got) != len(kutilgan) {
		t.Fatalf("yozuvlar soni = %d, kutilgan %d: %+v", len(got), len(kutilgan), got)
	}
	for i, k := range kutilgan {
		if got[i].Kind != k {
			t.Errorf("%d-yozuv turi = %q, kutilgan %q", i, got[i].Kind, k)
		}
		if i > 0 && got[i-1].At.Before(got[i].At) {
			t.Errorf("%d-yozuv tartibi buzilgan: %v < %v", i, got[i-1].At, got[i].At)
		}
	}
	if !got[0].Auto || got[0].Until == nil || !got[0].Until.Equal(muddat) {
		t.Errorf("avtomatik blok noto'g'ri yozildi: %+v", got[0])
	}
	if got[0].Detail != u.BlockReason {
		t.Errorf("blok sababi yo'qoldi: %q", got[0].Detail)
	}
}

// Qo'lda qo'yilgan blok bu yerda IKKINCHI MARTA qo'shilmasligi kerak — u
// audit logdan keladi. Busiz panel bitta blokni ikki qator qilib
// ko'rsatardi.
func TestStatusHistorySkipsAdminBlock(t *testing.T) {
	h := &Handler{}
	bloklangan := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	u := models.User{
		CreatedAt:   time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC),
		IsBlocked:   true,
		BlockedAt:   &bloklangan,
		BlockSource: moderation.BlockSourceAdmin,
		BlockReason: "qo'lda bloklandi",
	}
	got := h.statusHistory(context.Background(), &u, nil, false)
	for _, ev := range got {
		if ev.Kind == statusKindBlock {
			t.Errorf("qo'l bloki hujjatdan ham qo'shildi: %+v", ev)
		}
	}
}

// Hisob yaratilgan vaqti yo'q (eski, ko'chirilgan yozuv) — sana o'rniga
// nol vaqt qo'yilmasligi kerak: "1-yanvar 1" degan yolg'on sana admin
// uchun chalkash dalil bo'lardi.
func TestStatusHistorySkipsZeroCreatedAt(t *testing.T) {
	h := &Handler{}
	got := h.statusHistory(context.Background(), &models.User{}, nil, false)
	if len(got) != 0 {
		t.Errorf("bo'sh hisob uchun %d yozuv qaytdi: %+v", len(got), got)
	}
}
