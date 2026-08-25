package moderation

import (
	"context"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Strike/ban mantiqi Mongo ustida ishlaydi (atomik $inc, telefon bo'yicha
// unikal yozuv), shuning uchun testlar ham haqiqiy Mongo talab qiladi.
// Ulanib bo'lmasa o'tkazib yuboriladi — bo'sh checkout'da ham `go test ./...`
// yashil qoladi.
func strikeDB(t *testing.T) *mongo.Database {
	t.Helper()
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	if err := cli.Ping(ctx, nil); err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	db := cli.Database("ishchibormi_strikes_test")
	t.Cleanup(func() {
		_ = db.Drop(context.Background())
		_ = cli.Disconnect(context.Background())
	})
	return db
}

// seedUser — telefon raqami bor foydalanuvchi yaratadi.
func seedUser(t *testing.T, db *mongo.Database, phone string) primitive.ObjectID {
	t.Helper()
	id := primitive.NewObjectID()
	if _, err := db.Collection("users").InsertOne(context.Background(),
		bson.M{"_id": id, "phone": phone, "isBlocked": false, "isDeleted": false}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}

// TestStrikesReachLimitAndBan — uchta buzilishdan keyin blok qo'yiladi.
func TestStrikesReachLimitAndBan(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901112233")

	for i := 1; i <= 2; i++ {
		rec, err := store.RecordByUser(ctx, uid, KindElon, "SEXUAL=HIGH")
		if err != nil {
			t.Fatalf("%d-buzilish: %v", i, err)
		}
		if rec.Strikes != i {
			t.Errorf("strikes = %d, want %d", rec.Strikes, i)
		}
		if rec.Banned(time.Now()) {
			t.Errorf("%d-buzilishda blok qo'yildi — chegara 3", i)
		}
	}

	rec, err := store.RecordByUser(ctx, uid, KindAvatar, "SEXUAL=HIGH")
	if err != nil {
		t.Fatalf("3-buzilish: %v", err)
	}
	if !rec.Banned(time.Now()) {
		t.Fatalf("3-buzilishdan keyin blok kutilgan: %+v", rec)
	}
	// ~2 yil (kun aniqligida tekshiramiz).
	if days := time.Until(*rec.BannedUntil).Hours() / 24; days < 720 || days > 740 {
		t.Errorf("blok muddati %.0f kun, ~730 kutilgan", days)
	}

	// Blok user hujjatiga ko'chirilgan bo'lishi kerak (mavjud seansni
	// darhol to'xtatish uchun).
	var u struct {
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
		IsBlocked   bool       `bson:"isBlocked"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BannedUntil == nil {
		t.Error("moderationBannedUntil user hujjatiga yozilmadi")
	}
	// isBlocked — admin bayrog'i, unga tegilmasligi kerak.
	if u.IsBlocked {
		t.Error("isBlocked o'zgartirildi — u admin bayrog'i, tegilmasligi kerak")
	}
}

// TestBanSurvivesAccountDeletion — ASOSIY talab: hisobni o'chirib, o'sha
// raqam bilan qayta ro'yxatdan o'tish blokni chetlab o'tmasligi kerak.
func TestBanSurvivesAccountDeletion(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, 2*365*24*time.Hour)
	ctx := context.Background()
	const phone = "+998901112244"
	uid := seedUser(t, db, phone)

	for i := 0; i < 3; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindProfile, "HATE=HIGH"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	if _, banned, _ := store.BanByPhone(ctx, phone); !banned {
		t.Fatal("blok qo'yilmadi")
	}

	// Hisobni o'chirishni taqlid qilamiz: internal/account.softDelete
	// telefonni user hujjatidan UZADI va deletedPhone ga arxivlaydi.
	if _, err := db.Collection("users").UpdateOne(ctx, bson.M{"_id": uid}, bson.M{
		"$set":   bson.M{"isDeleted": true, "deletedPhone": phone},
		"$unset": bson.M{"phone": ""},
	}); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	// Yangi hisob — auth.upsertUser xuddi shunday qiladi.
	newID := seedUser(t, db, phone)
	if newID == uid {
		t.Fatal("yangi hisob eskisi bilan bir xil")
	}

	until, banned, err := store.BanByPhone(ctx, phone)
	if err != nil {
		t.Fatalf("BanByPhone: %v", err)
	}
	if !banned {
		t.Fatal("hisob o'chirib qayta yaratilgach blok yo'qoldi — jazoni chetlab o'tish mumkin")
	}
	if until.Before(time.Now()) {
		t.Errorf("bannedUntil o'tmishda: %v", until)
	}
}

// TestBanExpiryResetsStrikes — muddat tugagach sanoq nolga tushadi, aks
// holda qaytgan foydalanuvchi birinchi xatosida darhol qayta bloklanardi.
func TestBanExpiryResetsStrikes(t *testing.T) {
	db := strikeDB(t)
	// Blok muddati 1 millisekund — darhol tugaydi.
	store := NewStrikeStore(db, 2, time.Millisecond)
	ctx := context.Background()
	const phone = "+998901112255"
	uid := seedUser(t, db, phone)

	for i := 0; i < 2; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindElon, "x"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	time.Sleep(20 * time.Millisecond)

	_, banned, err := store.BanByPhone(ctx, phone)
	if err != nil {
		t.Fatalf("BanByPhone: %v", err)
	}
	if banned {
		t.Fatal("muddati o'tgan blok hali kuchda")
	}
	var rec StrikeRecord
	if err := store.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&rec); err != nil {
		t.Fatalf("yozuv: %v", err)
	}
	if rec.Strikes != 0 {
		t.Errorf("strikes = %d, muddat tugagach 0 ga tushishi kerak", rec.Strikes)
	}
	if rec.BannedUntil != nil {
		t.Errorf("bannedUntil = %v, tozalanishi kerak", rec.BannedUntil)
	}
}

// TestBanNotExtendedByFurtherStrikes — bloklangandan keyingi urinishlar
// muddatni cheksiz cho'zmasligi kerak.
func TestBanNotExtendedByFurtherStrikes(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 1, 2*365*24*time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901112266")

	first, err := store.RecordByUser(ctx, uid, KindElon, "x")
	if err != nil {
		t.Fatalf("1-buzilish: %v", err)
	}
	if !first.Banned(time.Now()) {
		t.Fatal("blok kutilgan")
	}
	firstUntil := *first.BannedUntil

	time.Sleep(10 * time.Millisecond)
	second, err := store.RecordByUser(ctx, uid, KindElon, "x")
	if err != nil {
		t.Fatalf("2-buzilish: %v", err)
	}
	// Aniq tenglik emas: Mongo vaqtni millisekund aniqligida saqlaydi, ya'ni
	// birinchi qiymat xotirada nanosekundli, bazadan qaytgani esa yaxlitlangan.
	// Muhimi — muddat UZAYTIRILMAGAN bo'lsin.
	if diff := second.BannedUntil.Sub(firstUntil); diff > time.Second || diff < -time.Second {
		t.Errorf("muddat o'zgardi: %v -> %v (farq %v)", firstUntil, *second.BannedUntil, diff)
	}
}

// TestStrikesSharedAcrossSources — e'lon, profil va avatar BITTA umumiy
// hisobga qo'shiladi.
func TestStrikesSharedAcrossSources(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901112277")

	for _, kind := range []string{KindElon, KindProfile, KindAvatar} {
		if _, err := store.RecordByUser(ctx, uid, kind, "x"); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	_, banned, err := store.BanByPhone(ctx, "+998901112277")
	if err != nil {
		t.Fatalf("BanByPhone: %v", err)
	}
	if !banned {
		t.Error("uch xil manbadan uchta buzilish blokga olib kelishi kerak")
	}
}

func TestBanByPhoneUnknown(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 3, time.Hour)
	if _, banned, err := store.BanByPhone(context.Background(), "+998900000000"); err != nil || banned {
		t.Errorf("noma'lum raqam: banned=%v err=%v", banned, err)
	}
}

func TestWarnMessage(t *testing.T) {
	if got := WarnMessage(1, 3); got == "" {
		t.Error("1/3 uchun ogohlantirish kutilgan")
	}
	if got := WarnMessage(3, 3); got != "" {
		t.Errorf("chegaraga yetilganda ogohlantirish = %q, bo'sh kutilgan (blok xabari beriladi)", got)
	}
}

// TestLiftBanByUser — superadmin blokni ochganda uchala iz ham tozalanishi
// kerak: strike yozuvi, user hujjatidagi muddat va e'lonlardagi yashirish.
func TestLiftBanByUser(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 2, 2*365*24*time.Hour)
	ctx := context.Background()
	const phone = "+998901113311"
	uid := seedUser(t, db, phone)

	// Foydalanuvchining e'loni ham bo'lsin — blokda u yashirinadi.
	if _, err := db.Collection("elons").InsertOne(ctx,
		bson.M{"ownerId": uid, "title": "Test", "ownerBlocked": false}); err != nil {
		t.Fatalf("seed elon: %v", err)
	}

	for i := 0; i < 2; i++ {
		if _, err := store.RecordByUser(ctx, uid, KindElon, "x"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	if _, banned, _ := store.BanByPhone(ctx, phone); !banned {
		t.Fatal("blok qo'yilmadi")
	}
	if n, _ := db.Collection("elons").CountDocuments(ctx, bson.M{"ownerId": uid, "ownerBlocked": true}); n != 1 {
		t.Errorf("blokda e'lon yashirilmadi (ownerBlocked=true: %d)", n)
	}

	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatalf("LiftBanByUser: %v", err)
	}

	if _, banned, _ := store.BanByPhone(ctx, phone); banned {
		t.Error("blok hali kuchda")
	}
	if n, _ := store.col.CountDocuments(ctx, bson.M{"phone": phone}); n != 0 {
		t.Errorf("strike yozuvi qoldi (%d) — keyingi bitta buzilish darhol qayta bloklardi", n)
	}
	var u struct {
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BannedUntil != nil {
		t.Errorf("moderationBannedUntil tozalanmadi: %v", u.BannedUntil)
	}
	if n, _ := db.Collection("elons").CountDocuments(ctx, bson.M{"ownerId": uid, "ownerBlocked": true}); n != 0 {
		t.Errorf("e'lonlar ochilmadi (ownerBlocked=true: %d)", n)
	}
}

// TestLiftBanKeepsAdminBlock — admin QO'LDA bloklagan foydalanuvchining
// e'lonlari moderatsiya blokini ochganda ham yashirinligicha qolishi kerak:
// bu ikki blok bir-biridan mustaqil.
func TestLiftBanKeepsAdminBlock(t *testing.T) {
	db := strikeDB(t)
	store := NewStrikeStore(db, 1, time.Hour)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901113322")

	// Admin qo'lda bloklagan.
	if _, err := db.Collection("users").UpdateOne(ctx, bson.M{"_id": uid},
		bson.M{"$set": bson.M{"isBlocked": true}}); err != nil {
		t.Fatalf("admin block: %v", err)
	}
	if _, err := db.Collection("elons").InsertOne(ctx,
		bson.M{"ownerId": uid, "title": "Test", "ownerBlocked": true}); err != nil {
		t.Fatalf("seed elon: %v", err)
	}
	if _, err := store.RecordByUser(ctx, uid, KindElon, "x"); err != nil {
		t.Fatalf("buzilish: %v", err)
	}

	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatalf("LiftBanByUser: %v", err)
	}
	if n, _ := db.Collection("elons").CountDocuments(ctx, bson.M{"ownerId": uid, "ownerBlocked": true}); n != 1 {
		t.Errorf("admin bloki bekor qilindi — e'lonlar ochilib ketdi (ownerBlocked=true: %d)", n)
	}
}
