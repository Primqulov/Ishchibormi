package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// blockHandler — BlockUser uchun minimal handler (faqat kerakli
// kolleksiyalar). `Strikes` ATAYLAB bog'lanadi: u nil qolgan paytda blokni
// ochish jimgina ishlamasdi va admin panelida "muvaffaqiyatli" degan xabar
// ko'rinardi, foydalanuvchi esa baribir kira olmasdi.
func blockHandler(db *mongo.Database) *Handler {
	return &Handler{
		Users:    db.Collection("users"),
		Elons:    db.Collection("elons"),
		AuditCol: db.Collection("admin_audit"),
		Strikes:  moderation.NewStrikeStore(db, 3, 2*365*24*time.Hour),
	}
}

// blockRequest — {id} URL parametri va admin roli bilan so'rov quradi.
func blockRequest(t *testing.T, id primitive.ObjectID, role, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id.Hex())
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, httpx.CtxAdminID, primitive.NewObjectID().Hex())
	ctx = context.WithValue(ctx, httpx.CtxAdminRole, role)
	return r.WithContext(ctx)
}

func bannedUser(t *testing.T, db *mongo.Database, phone string) primitive.ObjectID {
	t.Helper()
	store := moderation.NewStrikeStore(db, 3, 2*365*24*time.Hour)
	id := primitive.NewObjectID()
	ctx := context.Background()
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": id, "phone": phone, "isBlocked": false, "isDeleted": false,
	}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := store.RecordByUser(ctx, id, moderation.KindElon, "HATE=HIGH"); err != nil {
			t.Fatalf("buzilish: %v", err)
		}
	}
	return id
}

// REGRESSIYA: blokni ochish "ok" qaytargan bo'lsa, foydalanuvchi rostdan ham
// blokdan chiqqan bo'lishi kerak. Ilgari javob 200 bo'lardi, lekin
// `moderationBannedUntil` joyida qolib, foydalanuvchi ilovaga kira olmasdi.
func TestUnblockClearsBothBlocks(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := bannedUser(t, db, "+998901113311")

	// Admin ustiga qo'lda ham bloklab qo'ygan bo'lsin — eng og'ir holat.
	if _, err := db.Collection("users").UpdateOne(ctx, bson.M{"_id": uid},
		bson.M{"$set": bson.M{"isBlocked": true}}); err != nil {
		t.Fatalf("admin block: %v", err)
	}

	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "superadmin", `{"isBlocked":false}`))
	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	var u struct {
		IsBlocked   bool       `bson:"isBlocked"`
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
		BlockReason string     `bson:"blockReason"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.IsBlocked {
		t.Error("isBlocked tozalanmadi")
	}
	if u.BannedUntil != nil {
		t.Error("moderationBannedUntil qolib ketdi — foydalanuvchi baribir kira olmasdi")
	}
	if u.BlockReason != "" {
		t.Errorf("blok sababi qolib ketdi: %q", u.BlockReason)
	}
	// Sanoq ham nolga tushishi kerak, aks holda keyingi bitta buzilish
	// foydalanuvchini darhol qayta bloklardi.
	n, err := db.Collection("moderation_strikes").CountDocuments(ctx, bson.M{"phone": "+998901113311"})
	if err != nil || n != 0 {
		t.Errorf("buzilishlar yozuvi o'chirilmadi (n=%d, err=%v)", n, err)
	}
}

// Moderator avtomatik blokni ocha olmaydi — va bu JIMGINA yarim ish bilan
// tugamasligi kerak: aniq xato qaytadi, holat esa o'zgarmaydi.
func TestUnblockModerationBanNeedsSuperadmin(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := bannedUser(t, db, "+998901113322")

	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "moderator", `{"isBlocked":false}`))
	if w.Code != 403 {
		t.Fatalf("status = %d, want 403; body = %s", w.Code, w.Body.String())
	}

	var u struct {
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BannedUntil == nil {
		t.Error("rad etilgan so'rov blokni baribir ochib yubordi")
	}
}

// Sabab MAJBURIY: usiz bloklash qabul qilinmaydi.
func TestBlockRequiresReason(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := primitive.NewObjectID()
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": uid, "phone": "+998901113333", "isBlocked": false,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "moderator", `{"isBlocked":true,"reason":"   "}`))
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400; body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Error.Code != "reason_required" {
		t.Errorf("code = %q, want reason_required", body.Error.Code)
	}

	// Sabab bilan — o'tadi va saqlanadi.
	w = httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "moderator", `{"isBlocked":true,"reason":"Spam e'lonlar"}`))
	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var u struct {
		IsBlocked   bool   `bson:"isBlocked"`
		BlockReason string `bson:"blockReason"`
		BlockSource string `bson:"blockSource"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if !u.IsBlocked || u.BlockReason != "Spam e'lonlar" || u.BlockSource != moderation.BlockSourceAdmin {
		t.Errorf("blok noto'g'ri saqlandi: %+v", u)
	}
}

// Qo'lda bloklangan (moderatsiya bloki yo'q) foydalanuvchini moderator ham
// blokdan chiqara oladi — superadmin sharti faqat avtomatik blokga tegishli.
func TestUnblockAdminBlockAllowedForModerator(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := primitive.NewObjectID()
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": uid, "phone": "+998901113344", "isBlocked": true,
		"blockReason": "Spam", "blockSource": moderation.BlockSourceAdmin,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "moderator", `{"isBlocked":false}`))
	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var u struct {
		IsBlocked   bool   `bson:"isBlocked"`
		BlockReason string `bson:"blockReason"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.IsBlocked || u.BlockReason != "" {
		t.Errorf("blok ochilmadi: %+v", u)
	}
}

// Strikes do'koni bog'lanmagan bo'lsa, blokni ochish JIMGINA muvaffaqiyat
// qaytarmasligi kerak.
//
// Aynan shu bo'lgan edi: cmd/api/main.go da `adminH.Strikes` hech qachon
// o'rnatilmagan, ya'ni nil bo'lgan. Eski kod undan umuman foydalanmasdi va
// 200 qaytarardi — admin "blokdan chiqarildi" degan xabarni ko'rar,
// foydalanuvchi esa ilovaga baribir kira olmasdi. Sozlama xatosi ovozli
// bo'lishi kerak, jim emas.
func TestUnblockWithoutStrikeStoreFails(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	h := blockHandler(db)
	uid := bannedUser(t, db, "+998901113355")
	h.Strikes = nil // sozlama xatosini taqlid qilamiz

	w := httptest.NewRecorder()
	h.BlockUser(w, blockRequest(t, uid, "superadmin", `{"isBlocked":false}`))
	if w.Code == 200 {
		t.Fatal("blok ochilmagani holda 200 qaytdi — admin xato xabarni ko'rardi")
	}

	var u struct {
		BannedUntil *time.Time `bson:"moderationBannedUntil"`
	}
	if err := db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatalf("user: %v", err)
	}
	if u.BannedUntil == nil {
		t.Error("blok yarim ochildi — xato qaytgan bo'lsa holat o'zgarmasligi kerak")
	}
}
