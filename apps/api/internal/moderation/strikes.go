package moderation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// StrikeStore — moderatsiya buzilishlarini sanaydi va chegaraga yetganda
// hisobni muddatli bloklaydi.
//
// # Nega TELEFON bo'yicha, foydalanuvchi id bo'yicha emas
//
// Hisobni o'chirish (internal/account.softDelete) telefon raqamini user
// hujjatidan UZIB oladi (`$unset phone`) va uni `deletedPhone` ga arxivlaydi.
// Shu raqam bilan qayta ro'yxatdan o'tilsa auth.upsertUser BUTUNLAY YANGI
// hujjat yaratadi. Ya'ni sanoq user hujjatida tursa, "o'chir — qayta
// ro'yxatdan o't" jazoni nolga qaytaradigan oddiy usul bo'lardi.
//
// Shu sabab yozuv alohida `moderation_strikes` kolleksiyasida, telefon
// raqami kaliti bilan saqlanadi va hisob o'chirilganda ham tegilmaydi.
type StrikeStore struct {
	col   *mongo.Collection
	users *mongo.Collection
	elons *mongo.Collection
	limit int
	ban   time.Duration
}

const (
	// DefaultStrikeLimit — necha marta buzilishdan keyin blok.
	DefaultStrikeLimit = 3
	// DefaultBanDuration — blok muddati (2 yil).
	DefaultBanDuration = 2 * 365 * 24 * time.Hour
)

// Buzilish turlari — hammasi BITTA umumiy hisobga qo'shiladi.
const (
	KindElon    = "elon"    // e'lon matni yoki rasmi
	KindProfile = "profile" // ism / "Men haqimda" / ko'nikmalar
	KindAvatar  = "avatar"  // profil rasmi
)

// maxStoredEvents — yozuvda saqlanadigan oxirgi hodisalar soni. Cheklov
// kerak: aks holda hujjat cheksiz o'sib borardi.
const maxStoredEvents = 20

// StrikeEvent — bitta buzilish.
type StrikeEvent struct {
	Kind   string    `bson:"kind" json:"kind"`
	Detail string    `bson:"detail,omitempty" json:"detail,omitempty"`
	At     time.Time `bson:"at" json:"at"`
}

// StrikeRecord — bitta telefon raqami bo'yicha yig'ilgan holat.
type StrikeRecord struct {
	ID      primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Phone   string             `bson:"phone" json:"phone"`
	Strikes int                `bson:"strikes" json:"strikes"`
	// BannedUntil — blok tugash vaqti. nil yoki o'tmishda bo'lsa blok yo'q.
	BannedUntil *time.Time    `bson:"bannedUntil,omitempty" json:"bannedUntil,omitempty"`
	Events      []StrikeEvent `bson:"events,omitempty" json:"events,omitempty"`
	UpdatedAt   time.Time     `bson:"updatedAt" json:"updatedAt"`
}

// Banned — hozir blokdami.
func (r *StrikeRecord) Banned(now time.Time) bool {
	return r != nil && r.BannedUntil != nil && r.BannedUntil.After(now)
}

// NewStrikeStore do'kon quradi. limit/ban musbat bo'lmasa standart qiymatlar.
func NewStrikeStore(db *mongo.Database, limit int, ban time.Duration) *StrikeStore {
	if limit <= 0 {
		limit = DefaultStrikeLimit
	}
	if ban <= 0 {
		ban = DefaultBanDuration
	}
	return &StrikeStore{
		col:   db.Collection("moderation_strikes"),
		users: db.Collection("users"),
		elons: db.Collection("elons"),
		limit: limit,
		ban:   ban,
	}
}

// Limit — bloklashgacha ruxsat etilgan buzilishlar soni.
func (s *StrikeStore) Limit() int {
	if s == nil {
		return DefaultStrikeLimit
	}
	return s.limit
}

// BanDuration — blok muddati.
func (s *StrikeStore) BanDuration() time.Duration {
	if s == nil {
		return DefaultBanDuration
	}
	return s.ban
}

// ErrNoPhone — foydalanuvchining telefon raqami topilmadi (sanoqni
// bog'lash mumkin emas).
var ErrNoPhone = errors.New("moderation: user has no phone")

// RecordByUser — foydalanuvchi id'si bo'yicha buzilishni qayd etadi.
//
// Telefon raqami user hujjatidan olinadi: barcha chaqiruv joylarida
// (e'lon, profil, avatar) qo'lda id bor, telefon esa yo'q.
func (s *StrikeStore) RecordByUser(ctx context.Context, userID primitive.ObjectID, kind, detail string) (*StrikeRecord, error) {
	if s == nil {
		return nil, nil
	}
	var u struct {
		Phone string `bson:"phone"`
	}
	if err := s.users.FindOne(ctx, bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{"phone": 1})).Decode(&u); err != nil {
		return nil, err
	}
	if strings.TrimSpace(u.Phone) == "" {
		return nil, ErrNoPhone
	}
	return s.record(ctx, u.Phone, userID, kind, detail)
}

// record — sanoqni oshiradi va chegaraga yetilsa bloklaydi.
func (s *StrikeStore) record(ctx context.Context, phone string, userID primitive.ObjectID, kind, detail string) (*StrikeRecord, error) {
	now := time.Now()
	ev := StrikeEvent{Kind: kind, Detail: detail, At: now}

	// $inc + $push bitta atomik yangilanishda: ikki parallel so'rov
	// (masalan e'lon va profil bir vaqtda) sanoqni yo'qotmasligi kerak.
	update := bson.M{
		"$inc":         bson.M{"strikes": 1},
		"$set":         bson.M{"updatedAt": now},
		"$setOnInsert": bson.M{"phone": phone},
		"$push": bson.M{"events": bson.M{
			"$each":  bson.A{ev},
			"$slice": -maxStoredEvents,
		}},
	}
	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)
	var rec StrikeRecord
	if err := s.col.FindOneAndUpdate(ctx, bson.M{"phone": phone}, update, opts).Decode(&rec); err != nil {
		return nil, err
	}

	// Chegaraga yetdi — bloklaymiz. Allaqachon bloklangan bo'lsa muddatni
	// uzaytirmaymiz: jazo bir marta beriladi, har bir keyingi urinish uni
	// cheksiz cho'zib yubormasligi kerak.
	if rec.Strikes >= s.limit && !rec.Banned(now) {
		until := now.Add(s.ban)
		if _, err := s.col.UpdateOne(ctx, bson.M{"_id": rec.ID},
			bson.M{"$set": bson.M{"bannedUntil": until, "updatedAt": now}}); err != nil {
			return &rec, err
		}
		rec.BannedUntil = &until
		s.applyBan(ctx, userID, until, rec.Strikes)
	}
	return &rec, nil
}

// applyBan — blokni foydalanuvchi hujjatiga va uning e'lonlariga ko'chiradi.
//
// `isBlocked` ATAYLAB tegilmaydi: u admin qo'lidagi bayroq va uni bu yerda
// yoqib qo'ysak, 2 yil o'tgach kim o'chirishini bilib bo'lmasdi. Buning
// o'rniga alohida `moderationBannedUntil` maydoni ishlatiladi — u vaqt
// o'tishi bilan o'z-o'zidan kuchini yo'qotadi.
//
// `ownerBlocked` esa e'lonlarni ommaviy feeddan darhol olib tashlaydi
// (admin bloklashda ham xuddi shunday qilinadi).
func (s *StrikeStore) applyBan(ctx context.Context, userID primitive.ObjectID, until time.Time, strikes int) {
	if userID.IsZero() {
		return
	}
	now := time.Now()
	// Sabab hujjatga yoziladi, faqat sana emas: admin panelida "bu odam nega
	// bloklangan?" degan savolga ertaga ham javob bo'lishi kerak. Matn tayyor
	// va bexatar — qaysi tasnif ishlagani bu yerga tushmaydi (u faqat
	// `moderation_strikes.events[].detail` da, admin ko'rinishida).
	_, _ = s.users.UpdateOne(ctx, bson.M{"_id": userID},
		bson.M{"$set": bson.M{
			"moderationBannedUntil": until,
			"blockReason":           AutoBanReason(strikes),
			"blockSource":           BlockSourceModeration,
			"blockedAt":             now,
			"updatedAt":             now,
		}})
	_, _ = s.elons.UpdateMany(ctx, bson.M{"ownerId": userID},
		bson.M{"$set": bson.M{"ownerBlocked": true, "updatedAt": now}})
}

// Blok manbalari — models.User.BlockSource qiymatlari.
const (
	// BlockSourceModeration — nomaqbul kontent uchun tizim qo'ygan blok.
	BlockSourceModeration = "moderation"
	// BlockSourceAdmin — admin qo'lda qo'ygan blok.
	BlockSourceAdmin = "admin"
)

// AutoBanReason — avtomatik blok sababi, admin panelida ko'rsatish uchun.
//
// Tayyor jumla, chunki avtomatik blokda "sababni kim yozadi" degan savol yo'q:
// uni tizim qo'yadi va sabab har doim bir xil. Buzilishlar tafsiloti (qaysi
// e'lon, qaysi tasnif, qachon) alohida — `moderation_strikes` yozuvidagi
// hodisalar ro'yxatida.
func AutoBanReason(strikes int) string {
	if strikes <= 0 {
		strikes = DefaultStrikeLimit
	}
	return fmt.Sprintf(
		"Nomaqbul kontent joylashga %d marta urinildi (avtomatik moderatsiya).",
		strikes)
}

// FindByUser — foydalanuvchining buzilishlar yozuvi (telefon bo'yicha).
//
// Admin panelining "batafsil" ko'rinishi uchun: blok sababi bitta jumla, lekin
// admin qaysi buzilishlar qachon bo'lganini ham ko'rishi kerak — masalan
// foydalanuvchi "men hech narsa qilmadim" desa.
//
// Yozuv topilmasa (yoki telefon yo'q bo'lsa) nil qaytaradi — bu xato emas:
// hech qachon qoida buzmagan foydalanuvchida yozuv bo'lmaydi.
func (s *StrikeStore) FindByUser(ctx context.Context, userID primitive.ObjectID) (*StrikeRecord, error) {
	if s == nil {
		return nil, nil
	}
	var u struct {
		Phone string `bson:"phone"`
	}
	if err := s.users.FindOne(ctx, bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{"phone": 1})).Decode(&u); err != nil {
		return nil, err
	}
	if strings.TrimSpace(u.Phone) == "" {
		return nil, nil
	}
	var rec StrikeRecord
	err := s.col.FindOne(ctx, bson.M{"phone": u.Phone}).Decode(&rec)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// BanByPhone — shu raqam bloklanganmi. Login oqimi shundan foydalanadi:
// hisob o'chirilgan bo'lsa ham yozuv joyida qoladi.
//
// Muddati o'tgan blok jimgina tozalanadi va sanoq nolga tushadi — aks holda
// 2 yildan keyin qaytgan foydalanuvchi birinchi xatosida darhol qayta
// bloklanardi, ya'ni jazo amalda abadiy bo'lib qolardi.
func (s *StrikeStore) BanByPhone(ctx context.Context, phone string) (until time.Time, banned bool, err error) {
	if s == nil || strings.TrimSpace(phone) == "" {
		return time.Time{}, false, nil
	}
	var rec StrikeRecord
	err = s.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&rec)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	now := time.Now()
	if rec.Banned(now) {
		return *rec.BannedUntil, true, nil
	}
	if rec.BannedUntil != nil {
		// Muddat tugagan — yozuvni tiklaymiz.
		_, _ = s.col.UpdateOne(ctx, bson.M{"_id": rec.ID}, bson.M{
			"$set":   bson.M{"strikes": 0, "updatedAt": now},
			"$unset": bson.M{"bannedUntil": ""},
		})
	}
	return time.Time{}, false, nil
}

// LiftBanByUser — foydalanuvchining avtomatik moderatsiya blokini bekor
// qiladi (admin qarori bilan).
//
// Uch narsa birga bajariladi, chunki blok uch joyda iz qoldirgan:
//  1. `moderation_strikes` yozuvi — TELEFON bo'yicha. O'chirilmasa sanoq
//     chegarada qolib, keyingi bitta buzilish darhol qayta bloklardi.
//  2. user hujjatidagi `moderationBannedUntil` — mavjud seansni to'xtatadi.
//  3. e'lonlardagi `ownerBlocked` — ular feeddan yashiringan edi.
//
// `isBlocked` ga TEGILMAYDI: u admin qo'lidagi alohida bayroq. Admin
// foydalanuvchini qo'lda ham bloklagan bo'lsa, moderatsiya blokini ochish
// uni tiklab yubormasligi kerak — shu sabab e'lonlar ham faqat qo'lda blok
// yo'q bo'lgandagina ochiladi.
func (s *StrikeStore) LiftBanByUser(ctx context.Context, userID primitive.ObjectID) error {
	if s == nil {
		return errors.New("moderation: strike store not configured")
	}
	var u struct {
		Phone     string `bson:"phone"`
		IsBlocked bool   `bson:"isBlocked"`
	}
	if err := s.users.FindOne(ctx, bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{"phone": 1, "isBlocked": 1})).Decode(&u); err != nil {
		return err
	}
	if strings.TrimSpace(u.Phone) != "" {
		if _, err := s.col.DeleteOne(ctx, bson.M{"phone": u.Phone}); err != nil {
			return err
		}
	}
	// Sabab maydonlari blok bilan birga tozalanadi — lekin FAQAT moderatsiya
	// bloki bo'lsa. Admin qo'lda ham bloklab qo'ygan bo'lsa, uning sababi
	// o'z kuchida qolishi kerak: moderatsiya blokini ochish admin qarorini
	// bekor qilmaydi.
	unset := bson.M{"moderationBannedUntil": ""}
	if !u.IsBlocked {
		unset["blockReason"] = ""
		unset["blockSource"] = ""
		unset["blockedAt"] = ""
		unset["blockedBy"] = ""
	}
	if _, err := s.users.UpdateOne(ctx, bson.M{"_id": userID}, bson.M{
		"$unset": unset,
		"$set":   bson.M{"updatedAt": time.Now()},
	}); err != nil {
		return err
	}
	if !u.IsBlocked {
		_, _ = s.elons.UpdateMany(ctx, bson.M{"ownerId": userID, "ownerBlocked": true},
			bson.M{"$set": bson.M{"ownerBlocked": false, "updatedAt": time.Now()}})
	}
	return nil
}

// BanMessage — foydalanuvchiga ko'rsatiladigan blok xabari.
func BanMessage(until time.Time) string {
	return fmt.Sprintf("Hisobingiz qoidabuzarlik sababli %s gacha bloklandi.",
		until.Format("2006-01-02"))
}

// WarnMessage — blokgacha qolgan urinishlar haqida ogohlantirish.
// Klient buni modal oynada ko'rsatadi.
func WarnMessage(strikes, limit int) string {
	if strikes >= limit {
		return ""
	}
	return fmt.Sprintf("Ogohlantirish %d/%d — %d marta takrorlansa hisobingiz bloklanadi.",
		strikes, limit, limit)
}
