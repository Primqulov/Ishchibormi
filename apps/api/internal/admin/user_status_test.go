package admin

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
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
// unutilmaydi: audit yozuvi yo'q eski blok foydalanuvchi hujjatidan olinadi.
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

func TestStatusHistoryLegacyAutomaticExpiryUsesDeadline(t *testing.T) {
	at := time.Date(2026, 7, 19, 20, 50, 0, 0, time.UTC)
	until := at.Add(7 * 24 * time.Hour)
	u := models.User{
		CreatedAt: at.Add(-24 * time.Hour), BlockSource: moderation.BlockSourceModeration,
		BlockedAt: &at, BlockReason: "E'lon matni qoidaga zid", ModerationBannedUntil: &until,
	}
	h := &Handler{}
	before := h.statusHistoryAt(context.Background(), &u, nil, false, until.Add(-time.Second))
	if len(before) != 2 || before[0].Kind != statusKindBlock {
		t.Fatalf("unexpired ban gained an expiry event: %+v", before)
	}
	after := h.statusHistoryAt(context.Background(), &u, nil, false, until.Add(48*time.Hour))
	if len(after) != 3 || after[0].Kind != statusKindUnblock || !after[0].Auto ||
		!after[0].At.Equal(until) || after[0].Detail != "Blok muddati tugadi — o'z-o'zidan ochildi" {
		t.Fatalf("expiry must use its deadline, not read time: %+v", after)
	}
	if after[1].Detail != u.BlockReason || after[1].Until == nil || !after[1].Until.Equal(until) {
		t.Fatalf("original block details lost: %+v", after[1])
	}
}

func TestStatusHistoryAutomaticBanSurvivesManualUnblock(t *testing.T) {
	for _, action := range []string{"unblock", "moderation_lift"} {
		t.Run(action, func(t *testing.T) {
			db := filterDB(t)
			ctx := context.Background()
			h := blockHandler(db)
			uid := bannedUser(t, db, "+998901115601")
			var before models.User
			if err := h.Users.FindOne(ctx, bson.M{"_id": uid}).Decode(&before); err != nil {
				t.Fatal(err)
			}
			current := h.statusHistory(ctx, &before, nil, false)
			if len(current) != 1 || current[0].Kind != statusKindBlock || !current[0].Auto {
				t.Fatalf("current automatic ban was duplicated: %+v", current)
			}
			w := httptest.NewRecorder()
			r := blockRequest(t, uid, "superadmin", `{"isBlocked":false}`)
			if action == "unblock" {
				h.BlockUser(w, r)
			} else {
				h.LiftModerationBan(w, r)
			}
			if w.Code != 200 {
				t.Fatalf("lift failed: %d %s", w.Code, w.Body.String())
			}
			var after models.User
			if err := h.Users.FindOne(ctx, bson.M{"_id": uid}).Decode(&after); err != nil {
				t.Fatal(err)
			}
			if after.BlockedAt != nil || after.BlockReason != "" || after.ModerationBannedUntil != nil {
				t.Fatal("current ban metadata did not clear")
			}
			// Even after the original deadline, the early manual release must
			// not turn into a second automatic release.
			got := h.statusHistoryAt(ctx, &after, nil, false, before.ModerationBannedUntil.Add(time.Hour))
			if len(got) != 2 {
				t.Fatalf("expected retained ban and one manual unblock: %+v", got)
			}
			var block, release *statusEvent
			for i := range got {
				if got[i].Kind == statusKindBlock {
					block = &got[i]
				} else if got[i].Kind == statusKindUnblock {
					release = &got[i]
				}
			}
			if block == nil || !block.Auto || block.Detail != before.BlockReason ||
				!block.At.Equal(*before.BlockedAt) || block.Until == nil ||
				!block.Until.Equal(*before.ModerationBannedUntil) || release == nil || release.Auto {
				t.Fatalf("incorrect block/unblock history: %+v", got)
			}
		})
	}
}

func TestStatusHistoryRetainsExpiredLegacyBanBeforeClearing(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := primitive.NewObjectID()
	until := time.Now().Add(-24 * time.Hour).Truncate(time.Millisecond)
	at := until.Add(-7 * 24 * time.Hour)
	if _, err := h.Users.InsertOne(ctx, models.User{
		ID: uid, Phone: "+998901115602", BlockSource: moderation.BlockSourceModeration,
		BlockedAt: &at, BlockReason: "Eski avtomatik blok", ModerationBannedUntil: &until,
	}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "superadmin", `{"isBlocked":false}`))
	if w.Code != 200 {
		t.Fatalf("unblock failed: %d %s", w.Code, w.Body.String())
	}
	var user models.User
	if err := h.Users.FindOne(ctx, bson.M{"_id": uid}).Decode(&user); err != nil {
		t.Fatal(err)
	}
	got := h.statusHistory(ctx, &user, nil, false)
	var blockCount, expiryCount int
	for _, ev := range got {
		if ev.Kind == statusKindBlock && ev.Auto && ev.At.Equal(at) && ev.Detail == "Eski avtomatik blok" {
			blockCount++
		}
		if ev.Kind == statusKindUnblock && ev.Auto && ev.At.Equal(until) {
			expiryCount++
		}
	}
	if blockCount != 1 || expiryCount != 1 {
		t.Fatalf("known legacy history was lost or duplicated: %+v", got)
	}
}

func TestAutomaticExpiryDoesNotClaimAnOverlappingBlockOpened(t *testing.T) {
	at := time.Date(2026, 7, 19, 20, 50, 0, 0, time.UTC)
	until := at.Add(7 * 24 * time.Hour)
	laterUntil := until.Add(7 * 24 * time.Hour)
	for _, tc := range []struct {
		name  string
		extra statusEvent
		user  models.User
	}{
		{"newer automatic ban", statusEvent{
			Kind: statusKindBlock, Auto: true, At: at.Add(time.Hour), Until: &laterUntil,
		}, models.User{}},
		{"manual block", statusEvent{
			Kind: statusKindBlock, At: at.Add(time.Hour),
		}, models.User{}},
		{"legacy manual flag", statusEvent{}, models.User{IsBlocked: true}},
		{"deleted account", statusEvent{}, models.User{IsDeleted: true, DeletedAt: &at}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			history := []statusEvent{tc.extra, {
				Kind: statusKindBlock, Auto: true, At: at, Until: &until,
			}}
			if got := automaticExpirations(history, &tc.user, until.Add(time.Hour)); len(got) != 0 {
				t.Fatalf("account remained blocked at expiry: %+v", got)
			}
		})
	}
}
