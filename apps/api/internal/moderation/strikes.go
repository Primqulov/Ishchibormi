package moderation

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
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
	audit *mongo.Collection
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
	// Cleared only after user/listing enforcement and history all succeed.
	// A retry keeps the original start/reason/deadline instead of extending it.
	PendingBan *pendingBan `bson:"pendingBan,omitempty" json:"-"`
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
		audit: db.Collection("admin_audit"),
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
	var u models.User
	if err := s.users.FindOne(ctx, bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{
			"phone": 1, "blockSource": 1, "blockReason": 1,
			"blockedAt": 1, "moderationBannedUntil": 1,
		})).Decode(&u); err != nil {
		return nil, err
	}
	if strings.TrimSpace(u.Phone) == "" {
		return nil, ErrNoPhone
	}
	return s.record(ctx, u.Phone, userID, kind, detail, &u)
}

// record — sanoqni oshiradi va chegaraga yetilsa bloklaydi.
func (s *StrikeStore) record(ctx context.Context, phone string, userID primitive.ObjectID, kind, detail string, previous *models.User) (*StrikeRecord, error) {
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
		pending := pendingBan{
			UserID: userID, At: now, Until: until, Reason: AutoBanReason(rec.Strikes),
			Previous: knownBanSnapshot(previous),
		}
		// An older expired claim can still await audit recovery. Carry its
		// exact targets/snapshots forward if history is still unavailable;
		// starting the new punishment must not discard that retained history.
		if err := s.flushPendingBanHistory(ctx, rec.PendingBan); err != nil {
			pending.Retained = rec.PendingBan.snapshots()
		}
		// Only one concurrent threshold-crossing request may start this ban.
		// Otherwise its deadline and durable history would be duplicated.
		err := s.col.FindOneAndUpdate(ctx, bson.M{
			"_id": rec.ID,
			"$or": bson.A{
				bson.M{"bannedUntil": nil},
				bson.M{"bannedUntil": bson.M{"$lte": now}},
			},
		}, bson.M{"$set": bson.M{
			"bannedUntil": until, "updatedAt": now, "pendingBan": pending,
		}},
			options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&rec)
		if errors.Is(err, mongo.ErrNoDocuments) {
			rec = StrikeRecord{}
			err = s.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&rec)
		}
		if err != nil {
			return &rec, err
		}
	}
	// A prior attempt may have claimed the ban but failed to write history
	// or enforce one of its projections. Retry that same claim while active.
	// Expired pending state is never applied as a new punishment.
	if rec.PendingBan != nil && rec.Banned(time.Now()) {
		if err := s.applyBan(ctx, rec.PendingBan); err != nil {
			return &rec, err
		}
		if _, err := s.col.UpdateOne(ctx, bson.M{
			"_id": rec.ID, "bannedUntil": *rec.BannedUntil, "pendingBan.at": rec.PendingBan.At,
		}, bson.M{"$unset": bson.M{"pendingBan": ""}}); err != nil {
			return &rec, err
		}
		rec.PendingBan = nil
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
func (s *StrikeStore) applyBan(ctx context.Context, pending *pendingBan) error {
	if pending.UserID.IsZero() || pending.At.IsZero() || pending.Until.IsZero() {
		return errors.New("moderation: pending ban identity, start or deadline missing")
	}
	userID := pending.UserID
	until := pending.Until
	var writeErrors []error
	// Sabab hujjatga yoziladi, faqat sana emas: admin panelida "bu odam nega
	// bloklangan?" degan savolga ertaga ham javob bo'lishi kerak. Matn tayyor
	// va bexatar — qaysi tasnif ishlagani bu yerga tushmaydi (u faqat
	// `moderation_strikes.events[].detail` da, admin ko'rinishida).
	result, userErr := s.users.UpdateOne(ctx, bson.M{"_id": userID},
		bson.M{"$set": bson.M{
			"moderationBannedUntil": until,
			"blockReason":           pending.Reason,
			"blockSource":           BlockSourceModeration,
			"blockedAt":             pending.At,
			"updatedAt":             time.Now(),
		}})
	if userErr == nil && result.MatchedCount == 0 {
		userErr = mongo.ErrNoDocuments
	}
	if userErr != nil {
		writeErrors = append(writeErrors, userErr)
	}
	// A history error must never bypass enforcement for existing sessions
	// or leave the user's listings public. Attempt both independently.
	if _, err := s.elons.UpdateMany(ctx, bson.M{"ownerId": userID},
		bson.M{"$set": bson.M{"ownerBlocked": true, "updatedAt": time.Now()}}); err != nil {
		writeErrors = append(writeErrors, err)
	}
	if err := s.flushPendingBanHistory(ctx, pending); err != nil {
		writeErrors = append(writeErrors, err)
	}
	return errors.Join(writeErrors...)
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
	if rec.BannedUntil != nil || rec.PendingBan != nil {
		// Expiry never waits for the audit service to recover. Retain failed
		// history snapshots privately, then flush them on a later login even
		// when the effective bannedUntil has already been removed.
		historyErr := s.flushPendingBanHistory(ctx, rec.PendingBan)
		if historyErr != nil {
			log.Printf("moderation: pending ban history not saved: %v", historyErr)
		}
		filter := bson.M{"_id": rec.ID, "bannedUntil": rec.BannedUntil}
		set := bson.M{"updatedAt": now}
		unset := bson.M{}
		if rec.BannedUntil != nil {
			set["strikes"] = 0
			unset["bannedUntil"] = ""
		}
		if rec.PendingBan != nil {
			filter["pendingBan.at"] = rec.PendingBan.At
			filter["pendingBan.userId"] = rec.PendingBan.UserID
			if historyErr == nil {
				unset["pendingBan"] = ""
			}
		}
		if len(unset) > 0 {
			_, _ = s.col.UpdateOne(ctx, filter, bson.M{"$set": set, "$unset": unset})
		}
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
	var u models.User
	if err := s.users.FindOne(ctx, bson.M{"_id": userID},
		options.FindOne().SetProjection(bson.M{
			"phone": 1, "isBlocked": 1, "blockSource": 1, "blockReason": 1,
			"blockedAt": 1, "moderationBannedUntil": 1,
		})).Decode(&u); err != nil {
		return err
	}
	if err := RecordBanHistory(ctx, s.audit, &u); err != nil {
		return err
	}
	if strings.TrimSpace(u.Phone) != "" {
		var rec StrikeRecord
		err := s.col.FindOne(ctx, bson.M{"phone": u.Phone}).Decode(&rec)
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			return err
		}
		if err == nil {
			if err := s.flushPendingBanHistory(ctx, rec.PendingBan); err != nil {
				return err
			}
			if _, err := s.col.DeleteOne(ctx, bson.M{"_id": rec.ID}); err != nil {
				return err
			}
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
