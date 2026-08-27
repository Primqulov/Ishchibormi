package moderation

import (
	"context"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

// Admin paneli "bu foydalanuvchi nega bloklangan?" degan savolga javob bera
// olishi kerak — ertaga ham, blokni qo'ygan admin allaqachon ishdan ketgan
// bo'lsa ham. Avtomatik blokda bu javobni tizim yozib qo'yadi.
func TestAutoBanWritesReason(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901119911")

	for i := 0; i < 3; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindElon, "HARASSMENT=HIGH"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}

	var u struct {
		BlockReason string     `bson:"blockReason"`
		BlockSource string     `bson:"blockSource"`
		BlockedAt   *time.Time `bson:"blockedAt"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BlockReason == "" {
		t.Fatal("blockReason yozilmadi — admin panelida sabab bo'sh qolardi")
	}
	if !strings.Contains(u.BlockReason, "3") {
		t.Errorf("sabab necha marta urinilganini aytmaydi: %q", u.BlockReason)
	}
	if u.BlockSource != BlockSourceModeration {
		t.Errorf("blockSource = %q, want %q", u.BlockSource, BlockSourceModeration)
	}
	if u.BlockedAt == nil {
		t.Error("blockedAt yozilmadi")
	}
	// Sabab foydalanuvchiga ham ko'rinishi mumkin bo'lgan matn: qaysi tasnif
	// ishlagani unga hech qachon aytilmaydi (u faqat serverda va admin
	// ko'radigan hodisalar ro'yxatida qoladi).
	if strings.Contains(u.BlockReason, "HARASSMENT") {
		t.Errorf("sabab tasnif nomini oshkor qildi: %q", u.BlockReason)
	}
}

// Blok ochilganda sabab ham tozalanishi kerak: qolib ketgan sabab keyingi
// safar "bloklangan" bo'lmagan foydalanuvchida ko'rinib, adminni chalg'itardi.
func TestLiftBanClearsReason(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901119922")

	for i := 0; i < 3; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindProfile, "HATE=HIGH"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatalf("lift: %v", err)
	}

	var u struct {
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
		BlockReason string     `bson:"blockReason"`
		BlockSource string     `bson:"blockSource"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BannedUntil != nil {
		t.Error("moderationBannedUntil tozalanmadi")
	}
	if u.BlockReason != "" || u.BlockSource != "" {
		t.Errorf("sabab qolib ketdi: reason=%q source=%q", u.BlockReason, u.BlockSource)
	}
}

// Admin qo'lda ham bloklab qo'ygan bo'lsa, moderatsiya blokini ochish uning
// sababini o'chirib yubormasligi kerak — bu ikki alohida qaror.
func TestLiftBanKeepsAdminBlockReason(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901119933")

	for i := 0; i < 3; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	// Admin ustiga o'z blokini ham qo'ydi.
	if _, err := db.Collection("users").UpdateOne(ctx, bson.M{"_id": uid}, bson.M{"$set": bson.M{
		"isBlocked":   true,
		"blockReason": "Foydalanuvchilarga tahdid",
		"blockSource": BlockSourceAdmin,
	}}); err != nil {
		t.Fatalf("admin block: %v", err)
	}

	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatalf("lift: %v", err)
	}

	var u struct {
		BlockReason string `bson:"blockReason"`
		IsBlocked   bool   `bson:"isBlocked"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if !u.IsBlocked {
		t.Fatal("admin bloki bekor qilindi — moderatsiya bloki unga tegmasligi kerak")
	}
	if u.BlockReason != "Foydalanuvchilarga tahdid" {
		t.Errorf("admin sababi yo'qoldi: %q", u.BlockReason)
	}
}

// Buzilishlar tarixi admin ko'rinishi uchun o'qib olinishi kerak: sabab bitta
// jumla, tarix esa uning dalili.
func TestFindByUserReturnsHistory(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901119944")

	if rec, err := store.FindByUser(ctx, uid); err != nil || rec != nil {
		t.Fatalf("qoida buzmagan foydalanuvchida yozuv bo'lmasligi kerak: %v %v", rec, err)
	}

	if _, err := store.RecordByUser(ctx, uid, KindAvatar, "SEXUAL=MEDIUM"); err != nil {
		t.Fatalf("buzilish: %v", err)
	}
	rec, err := store.FindByUser(ctx, uid)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if rec == nil || rec.Strikes != 1 || len(rec.Events) != 1 {
		t.Fatalf("tarix noto'g'ri: %+v", rec)
	}
	if rec.Events[0].Kind != KindAvatar || rec.Events[0].Detail != "SEXUAL=MEDIUM" {
		t.Errorf("hodisa noto'g'ri: %+v", rec.Events[0])
	}
}
