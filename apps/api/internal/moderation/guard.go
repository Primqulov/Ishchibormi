package moderation

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Guard — domen handlerlariga qo'shiladigan matn tekshiruvi va uning
// siyosati (bayroq, fail-open/fail-closed, HTTP xatosiga aylantirish).
//
// Nega alohida tur: bu mantiq e'lon, profil va taklif/shikoyat oqimlarida
// bir xil. Uni har bir domenda qayta yozish xavfsizlik qoidasini uch joyda
// ushlab turishni anglatardi — biri yangilanmay qolsa teshik paydo bo'ladi.
type Guard struct {
	svc     *Service
	strikes *StrikeStore
	opts    GuardOptions

	// quotaMu/quotaUntil — kvota tugaganda "sovish" oynasi.
	//
	// Kvota tugagan holat soatlab davom etishi mumkin. Har bir e'lon va
	// profil saqlash uchun bexosdan muvaffaqiyatsiz tugaydigan tashqi
	// so'rov qilish foydalanuvchiga sezilarli kechikish qo'shadi — u esa
	// hech narsani bilmasligi kerak. Shu sabab 429 dan keyin qisqa vaqt
	// umuman so'rov yubormaymiz.
	//
	// Oyna ataylab qisqa: kvota yangilangach tekshiruv o'zidan-o'zi,
	// hech qanday qo'lda aralashuvsiz davom etishi kerak.
	quotaMu    sync.Mutex
	quotaUntil time.Time
}

// quotaCooldown — 429 dan keyin qancha vaqt so'rov yubormaslik.
const quotaCooldown = time.Minute

// CheckOutcome — tekshiruv HAQIQATAN bajarildimi.
//
// Kerak, chunki "xato yo'q" degani "kontent tekshirildi" degani emas: kvota
// tugaganda kontent tekshirilmasdan o'tkaziladi. Chaqiruvchi bu farqni
// bilishi va bunday yozuvni keyinchalik qo'lda ko'rib chiqish uchun
// belgilab qo'yishi kerak.
type CheckOutcome int

const (
	// OutcomeOff — tekshiruv umuman o'chiq (bayroq yoki kalit yo'q).
	// Belgilashning ma'nosi yo'q: hech narsa tekshirilmayapti.
	OutcomeOff CheckOutcome = iota
	// OutcomeChecked — kontent tekshirildi va o'tdi.
	OutcomeChecked
	// OutcomeSkipped — tekshiruv YOQILGAN, lekin bajarilmadi (kvota tugadi
	// yoki xizmat uzildi) va kontent o'tkazib yuborildi. Keyin qo'lda
	// ko'rib chiqish kerak.
	OutcomeSkipped
)

// quotaPaused — hozir kvota sovish oynasidamizmi.
func (g *Guard) quotaPaused() bool {
	g.quotaMu.Lock()
	defer g.quotaMu.Unlock()
	return time.Now().Before(g.quotaUntil)
}

// noteQuotaExhausted — sovish oynasini ochadi.
func (g *Guard) noteQuotaExhausted() {
	g.quotaMu.Lock()
	defer g.quotaMu.Unlock()
	g.quotaUntil = time.Now().Add(quotaCooldown)
}

// GuardOptions — tekshiruv siyosati.
type GuardOptions struct {
	// Enforce — tekshiruv umuman ishlasinmi. false bo'lsa Guard hech narsa
	// qilmaydi va mavjud oqim bir zarracha o'zgarmaydi.
	Enforce bool
	// FailClosed — moderatsiya xizmati ishlamay qolsa so'rov rad etilsinmi.
	// false = o'tkaziladi (xato logga yoziladi).
	FailClosed bool
}

// NewGuard guard quradi. strikes nil bo'lsa buzilishlar sanalmaydi
// (bloklash o'chiq), qolgan hamma narsa avvalgidek ishlaydi.
func NewGuard(svc *Service, strikes *StrikeStore, opts GuardOptions) *Guard {
	return &Guard{svc: svc, strikes: strikes, opts: opts}
}

// Strikes — buzilishlar do'koni (nil bo'lishi mumkin).
func (g *Guard) Strikes() *StrikeStore {
	if g == nil {
		return nil
	}
	return g.strikes
}

// On — tekshiruv haqiqatan ishlaydimi (bayroq yoqilgan va kalit bor).
func (g *Guard) On() bool {
	return g != nil && g.opts.Enforce && g.svc != nil && g.svc.Enabled()
}

// Service — asosiy xizmat. Rasm yo'lida o'z natijasini ko'rishi kerak
// bo'lgan domenlar (masalan e'lon — rad etilgan rasmni o'chirish uchun)
// shundan foydalanadi.
func (g *Guard) Service() *Service {
	if g == nil {
		return nil
	}
	return g.svc
}

// CheckText matn bo'laklarini BIRGA tekshiradi (bitta tashqi chaqiruv).
//
// prefix — foydalanuvchiga ko'rsatiladigan sabab boshlanishi, masalan
// "E'lon qabul qilinmadi". label — faqat log uchun.
//
// Qaytaradi: nil (o'tdi), 422 content_rejected (rad etildi) yoki
// FailClosed bo'lsa 503 moderation_unavailable.
func (g *Guard) CheckText(ctx context.Context, userID primitive.ObjectID, label, prefix string, parts ...string) (CheckOutcome, error) {
	if !g.On() {
		return OutcomeOff, nil
	}
	text := joinNonEmpty(parts)
	if text == "" {
		return OutcomeChecked, nil
	}
	// Kvota tugagan — so'rov ham yubormaymiz (foydalanuvchi bexosdan
	// kechikishni sezmasligi uchun).
	if g.quotaPaused() {
		return OutcomeSkipped, nil
	}
	res, err := g.svc.CheckText(ctx, text)
	if err != nil {
		return g.unavailableOutcome(label, err)
	}
	if !res.Allowed {
		return OutcomeChecked, g.Reject(ctx, userID, label, "content_rejected", res, prefix)
	}
	return OutcomeChecked, nil
}

// CheckImage — rasmni tekshiradi va rad etilsa TAYYOR HTTP xatosini
// qaytaradi (buzilish hisobga qo'shilgan holda).
//
// CheckText'dan farqi: natijani chaqiruvchiga qaytarmaydi. Bu ataylab —
// shu imzo tufayli internal/upload moderation paketini umuman import
// qilmaydi (aks holda moderation -> upload -> moderation halqasi hosil
// bo'lardi; moderation upload.ValidateImage'ni ishlatadi).
func (g *Guard) CheckImage(ctx context.Context, userID primitive.ObjectID, label, code, prefix, mime string, data []byte) (CheckOutcome, error) {
	if !g.On() {
		return OutcomeOff, nil
	}
	if g.quotaPaused() {
		return OutcomeSkipped, nil
	}
	res, err := g.svc.CheckImage(ctx, mime, data)
	if err != nil {
		return g.unavailableOutcome(label, err)
	}
	if res.Allowed {
		return OutcomeChecked, nil
	}
	return OutcomeChecked, g.Reject(ctx, userID, label, code, res, prefix)
}

// CheckImageErr — CheckImage'ning faqat xato qaytaradigan varianti.
//
// internal/upload uchun: u bu paketni import qila olmaydi (moderation ->
// upload halqasi), demak interfeysida CheckOutcome turini ishlata olmaydi.
//
// Kvota tugaganda avatar tekshirilmasdan o'tadi va bu yerda "keyin ko'rish"
// bayrog'i qo'yilmaydi — buning hojati ham yo'q: xuddi shu kvota oynasida
// profilni saqlash ham o'tkazib yuboriladi va bayroq user hujjatiga
// o'sha yerda qo'yiladi.
func (g *Guard) CheckImageErr(ctx context.Context, userID primitive.ObjectID, label, code, prefix, mime string, data []byte) error {
	_, err := g.CheckImage(ctx, userID, label, code, prefix, mime, data)
	return err
}

// Reject — rad etish xatosini quradi VA buzilishni hisobga qo'shadi.
//
// Matn va rasm yo'llari uchun umumiy: ikkalasi ham bitta hisobga qo'shilishi
// kerak (e'lon + profil matni + profil rasmi = umumiy sanoq).
//
// Qaytgan xatoda `details` bo'ladi — klient modal oynada sabab va
// ogohlantirishni alohida ko'rsatishi uchun.
func (g *Guard) Reject(ctx context.Context, userID primitive.ObjectID, label, code string, res *Result, prefix string) error {
	// Foydalanuvchiga umumiy sabab, logga aniq tafsilot: chegarani sozlash
	// va noto'g'ri ishlagan tasniflarni topish uchun.
	log.Printf("moderation rejected (%s): %s", label, res.Detail())

	reason := res.ReasonWithPrefix(prefix)
	details := map[string]any{"reason": reason}

	rec := g.recordStrike(ctx, userID, label, res.Detail())
	if rec == nil {
		return httpx.NewErrorWithDetails(http.StatusUnprocessableEntity, code, reason, details)
	}

	limit := g.strikes.Limit()
	details["strikes"] = rec.Strikes
	details["strikeLimit"] = limit

	// Chegaraga yetildi — endi bu shunchaki rad etish emas, blok.
	if rec.Banned(time.Now()) {
		details["bannedUntil"] = *rec.BannedUntil
		details["warning"] = BanMessage(*rec.BannedUntil)
		return httpx.NewErrorWithDetails(http.StatusForbidden, "account_banned",
			reason+" "+BanMessage(*rec.BannedUntil), details)
	}
	if w := WarnMessage(rec.Strikes, limit); w != "" {
		details["warning"] = w
		reason += " " + w
	}
	return httpx.NewErrorWithDetails(http.StatusUnprocessableEntity, code, reason, details)
}

// recordStrike — buzilishni qayd etadi. Xatolar jimgina yutiladi (lekin
// log qilinadi): sanoqni yozib bo'lmagani foydalanuvchiga rad etish
// xabarini ko'rsatishga to'sqinlik qilmasligi kerak.
func (g *Guard) recordStrike(ctx context.Context, userID primitive.ObjectID, kind, detail string) *StrikeRecord {
	if g == nil || g.strikes == nil || userID.IsZero() {
		return nil
	}
	rec, err := g.strikes.RecordByUser(ctx, userID, strikeKind(kind), detail)
	if err != nil {
		log.Printf("moderation: strike not recorded (%s): %v", kind, err)
		return nil
	}
	return rec
}

// strikeKind — ichki yorliqni (masalan "elon-update") hisob turiga
// keltiradi. Uch manba BITTA umumiy hisobga qo'shiladi, tur faqat
// tarixni o'qish uchun saqlanadi.
func strikeKind(label string) string {
	switch {
	case strings.HasPrefix(label, "avatar"):
		return KindAvatar
	case strings.HasPrefix(label, "profile"):
		return KindProfile
	default:
		return KindElon
	}
}

// Unavailable — tashqi xizmat xatosini siyosatga aylantiradi: fail-closed
// bo'lsa 503, aks holda nil (so'rov o'tadi). Har doim logga yoziladi.
//
// Log qatorida faqat xato matni bo'ladi — API kalit pkg/gemini da
// redactString bilan allaqachon olib tashlangan.
func (g *Guard) Unavailable(label string, err error) error {
	_, e := g.unavailableOutcome(label, err)
	return e
}

// unavailableOutcome — tashqi xizmat xatosini siyosatga aylantiradi.
//
// KVOTA TUGASHI alohida ko'rib chiqiladi: u har doim o'tkazib yuboriladi,
// FailClosed yoqilgan bo'lsa ham. Sabab — bu kutilgan va o'z-o'zidan
// tiklanadigan holat: kvota yangilangach tekshiruv davom etadi. Uni
// fail-closed qilib qo'yish e'lon joylashni butunlay to'xtatib qo'yardi,
// holbuki foydalanuvchi bu haqda hech narsa bilmasligi kerak.
//
// Bunday yozuvlar OutcomeSkipped bilan belgilanadi va chaqiruvchi ularni
// keyinchalik qo'lda ko'rib chiqish uchun bazada belgilab qo'yadi.
//
// Qolgan xatolar (noto'g'ri kalit, tarmoq, 5xx) — sozlama/uzilish muammosi
// va ular uchun avvalgi FailClosed siyosati kuchda qoladi.
func (g *Guard) unavailableOutcome(label string, err error) (CheckOutcome, error) {
	var apiErr *gemini.APIError
	if errors.As(err, &apiErr) && apiErr.QuotaExceeded() {
		g.noteQuotaExhausted()
		// Faqat log — foydalanuvchiga javob butunlay odatdagidek qaytadi.
		log.Printf("moderation skipped (%s): gemini quota exhausted, content published unchecked", label)
		return OutcomeSkipped, nil
	}
	log.Printf("moderation unavailable (%s): %v", label, err)
	if g != nil && g.opts.FailClosed {
		return OutcomeSkipped, httpx.NewError(http.StatusServiceUnavailable, "moderation_unavailable",
			"tekshirib bo'lmadi, keyinroq urinib ko'ring")
	}
	return OutcomeSkipped, nil
}

// joinNonEmpty — bo'sh bo'lmagan bo'laklarni qator uzilishi bilan qo'shadi.
// Bir necha maydonni (sarlavha + tavsif, ism + bio) bitta so'rovda
// tekshirish uchun: alohida yuborish tashqi chaqiruvlar sonini ko'paytirardi,
// holbuki qaror bir xil.
func joinNonEmpty(parts []string) string {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, "\n")
}
