package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Admin sessiyasi: qisqa umrli access token + aylanuvchi refresh token.
//
// # MUAMMO
//
// Ilgari login FAQAT access token berardi (JWT_ADMIN_TTL_MIN, 30 daqiqa) va
// uni yangilash yo'li yo'q edi. Ya'ni admin har 30 daqiqada parol + 2FA kodini
// qaytadan kiritardi; veb panelda token sessionStorage da turgani uchun
// brauzerni yopish ham chiqarib yuborardi.
//
// # YECHIM
//
// Access token qisqa qoladi (o'g'irlansa tez o'ladi), lekin yoniga refresh
// token qo'shildi. U JWT emas — 256 bitlik tasodifiy satr, bazada esa faqat
// SHA-256 xesh saqlanadi. Sabab: bazani o'qiy olgan hujum tokenning o'zini
// tiklay olmasin. Bcrypt kerak emas — tokenda taxmin qilinadigan hech narsa
// yo'q (parol emas, CSPRNG chiqargan 32 bayt), tez xesh esa indeks bo'yicha
// qidirish imkonini beradi.
//
// # 3 KUNLIK "FOYDALANILMASA" OYNASI
//
// Muddat sessiya hujjatida emas, HISOB darajasida hisoblanadi
// (admins.lastActivityAt). Sabab talabning o'zida: veb yoki ilova — qaysi
// biridan foydalanilsa ham ikkalasi tirik qolishi kerak. Agar har sessiya o'z
// muddatini yuritganida, uch kun faqat telefondan ishlagan admin veb paneldan
// chiqib qolardi.
//
// Sessiya hujjatidagi expiresAt esa boshqa vazifani bajaradi: u QAT'IY yuqori
// chegara (sessionMaxLifetime) va TTL indeksi uchun tozalash belgisi — faol
// admin ham 30 kunda bir marta to'liq (parol + 2FA) qayta kiradi.
const (
	// refreshCookieName — veb panel refresh tokeni shu cookie da yuradi.
	// HttpOnly: JavaScript uni o'qiy olmaydi, ya'ni XSS topilgan taqdirda ham
	// uzoq muddatli admin sessiyasi o'g'irlanmaydi. Aynan shu sabab veb javob
	// tanasida refresh token UMUMAN qaytarilmaydi.
	refreshCookieName = "ib_admin_rt"

	// refreshCookiePath — cookie faqat admin API yo'llariga jo'natiladi;
	// saytning qolgan qismiga (rasm, sahifa, ommaviy API) tegmaydi.
	refreshCookiePath = "/api/admin"

	// sessionMaxLifetime — bitta sessiya qancha yashashi mumkinligining qatiy
	// chegarasi, faollikdan qat'i nazar. Uzluksiz uzayadigan sessiya amalda
	// "abadiy kirgan" degani bo'lardi.
	sessionMaxLifetime = 30 * 24 * time.Hour

	// rotationGrace — eski refresh token almashtirilgandan keyin ham qisqa
	// muddat qabul qilinadi.
	//
	// Nega kerak: rotatsiya atomik — yangi token berilgach eskisi darhol
	// kuchdan qoladi. Agar javob mijozga yetib bormasa (tarmoq uzildi, ilova
	// o'chdi), mijoz qo'lida faqat eski token qoladi va uni qayta yuboradi. Bu
	// imtiyoz oynasisiz shunday har bir uzilish adminni chiqarib yuborardi —
	// ya'ni tuzatilayotgan muammoning aynan o'zi.
	rotationGrace = 60 * time.Second
)

// newRefreshToken — CSPRNG dan 32 bayt, URL-xavfsiz base64 (43 belgi).
func newRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// hashToken — bazaga yoziladigan ko'rinish. Xom token hech qayerda (bazada
// ham, logda ham) saqlanmaydi.
func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// startSession — muvaffaqiyatli logindan keyin yangi sessiya ochadi va
// mijozga beriladigan xom refresh tokenni qaytaradi.
func (h *Handler) startSession(ctx context.Context, a *models.Admin, platform, ip string) (string, error) {
	tok, err := newRefreshToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	_, err = h.Sessions.InsertOne(ctx, models.AdminSession{
		AdminID:      a.ID,
		TokenHash:    hashToken(tok),
		TokenVersion: a.TokenVersion,
		Platform:     platform,
		IP:           ip,
		CreatedAt:    now,
		LastUsedAt:   now,
		ExpiresAt:    now.Add(sessionMaxLifetime),
	})
	if err != nil {
		return "", err
	}
	return tok, nil
}

// revokeSessions — hisobning BARCHA sessiyalarini o'chiradi (veb ham, ilova
// ham). Logout, parol/rol o'zgarishi va 3 kunlik oyna yopilganda chaqiriladi.
func (h *Handler) revokeSessions(ctx context.Context, adminID primitive.ObjectID) {
	_, _ = h.Sessions.DeleteMany(ctx, bson.M{"adminId": adminID})
}

// setRefreshCookie — veb mijoz uchun. Secure faqat productionda: lokal
// backend HTTP orqali ishlaydi va Secure cookie u yerda o'rnatilmasdi.
func (h *Handler) setRefreshCookie(w http.ResponseWriter, tok string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    tok,
		Path:     refreshCookiePath,
		MaxAge:   int(sessionMaxLifetime / time.Second),
		HttpOnly: true,
		Secure:   h.Cfg.IsProd(),
		// Strict — panel va admin API bitta originda (boshqaruv subdomeni),
		// shuning uchun qatiy rejim hech narsani buzmaydi va CSRF yuzasini
		// butunlay yopadi.
		SameSite: http.SameSiteStrictMode,
	})
}

// clearRefreshCookie — chiqishda va yaroqsiz token kelganda. Cookie ni
// o'chirish uchun bir xil Name/Path bilan bo'sh qiymat va MaxAge=-1 kerak.
func (h *Handler) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.Cfg.IsProd(),
		SameSite: http.SameSiteStrictMode,
	})
}

type refreshReq struct {
	// RefreshToken — mobil klient uchun. Veb uni yubormaydi: u yerda token
	// HttpOnly cookie da bo'lgani uchun JavaScript unga umuman yeta olmaydi.
	RefreshToken string `json:"refreshToken"`
}

// refreshTokenFromRequest — avval cookie (veb), keyin JSON tanasi (mobil).
func refreshTokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	var req refreshReq
	if err := httpx.Decode(r, &req); err != nil {
		return ""
	}
	return req.RefreshToken
}

// Refresh — access tokenni yangilaydi va refresh tokenni aylantiradi.
//
// Autentifikatsiyasiz endpoint: mijozning access tokeni allaqachon eskirgan
// bo'lishi mumkin, ya'ni AdminAuth bu yerda ishlay olmaydi. Orniga tokenning
// o'zi dalil bo'lib xizmat qiladi.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	tok := refreshTokenFromRequest(r)
	// 43 — base64(32 bayt) uzunligi; undan qisqasi hech qachon haqiqiy token
	// emas, shuning uchun bazaga umuman bormaymiz.
	if len(tok) < 40 || len(tok) > 512 {
		h.clearRefreshCookie(w)
		httpx.Err(w, httpx.NewError(401, "bad_refresh", "invalid refresh token"))
		return
	}

	now := time.Now()
	hash := hashToken(tok)

	// Eski token ham rotationGrace ichida qabul qilinadi — yuqoridagi izohga
	// qarang. Ikkala shart ham xesh bo'yicha indekslangan.
	var sess models.AdminSession
	err := h.Sessions.FindOne(r.Context(), bson.M{"$or": []bson.M{
		{"tokenHash": hash},
		{"prevTokenHash": hash, "prevValidUntil": bson.M{"$gt": now}},
	}}).Decode(&sess)
	if err != nil {
		h.clearRefreshCookie(w)
		httpx.Err(w, httpx.NewError(401, "bad_refresh", "invalid refresh token"))
		return
	}
	if !sess.ExpiresAt.IsZero() && !sess.ExpiresAt.After(now) {
		_, _ = h.Sessions.DeleteOne(r.Context(), bson.M{"_id": sess.ID})
		h.clearRefreshCookie(w)
		httpx.Err(w, httpx.NewError(401, "session_expired", "session expired, sign in again"))
		return
	}

	var a models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"_id": sess.AdminID}).Decode(&a); err != nil ||
		!a.IsActive || a.TokenVersion != sess.TokenVersion {
		h.revokeSessions(r.Context(), sess.AdminID)
		h.clearRefreshCookie(w)
		httpx.Err(w, httpx.NewError(401, "session_revoked", "admin session revoked"))
		return
	}

	// 3 kunlik oyna — hisob darajasida. Veb va ilova bitta oynani bo'lishadi.
	if h.isIdle(a.LastActivityAt, now) {
		h.revokeSessions(r.Context(), a.ID)
		h.clearRefreshCookie(w)
		h.auditRaw(r.Context(), a.ID, "session_idle_expired", a.Username,
			"no activity for "+h.Cfg.AdminIdleTTL.String())
		httpx.Err(w, httpx.NewError(401, "session_idle_expired",
			"session closed after inactivity, sign in again"))
		return
	}

	// Rotatsiya. Filtrda eski xesh turgani muhim: bir vaqtda kelgan ikkinchi
	// so'rov mos kelmaydi va ikkita amal bitta sessiyadan ikkita yangi token
	// yasab yubora olmaydi.
	next, err := newRefreshToken()
	if err != nil {
		httpx.Err(w, err)
		return
	}
	res, err := h.Sessions.UpdateOne(r.Context(),
		bson.M{"_id": sess.ID, "tokenHash": sess.TokenHash},
		bson.M{"$set": bson.M{
			"tokenHash":      hashToken(next),
			"prevTokenHash":  sess.TokenHash,
			"prevValidUntil": now.Add(rotationGrace),
			"lastUsedAt":     now,
			// Qatiy chegara UZAYTIRILMAYDI: sessiya baribir 30 kunda tugaydi
			// va admin to'liq qayta kiradi.
		}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		// Poyga: boshqa so'rov shu sessiyani allaqachon aylantirgan. Mijoz
		// yangi tokenni osha javobda oldi, bu esa eskirgan urinish.
		h.clearRefreshCookie(w)
		httpx.Err(w, httpx.NewError(401, "bad_refresh", "invalid refresh token"))
		return
	}

	// Yangilash ham faollik: aks holda faqat fon refreshi bilan ishlaydigan
	// klient oynani uzaytira olmasdi.
	h.touchActivity(r.Context(), a.ID, a.LastActivityAt, now)

	access, err := httpx.IssueVersionedAdminToken(
		h.Cfg.JWTAccessSecret, a.ID.Hex(), a.Role, a.TokenVersion, h.Cfg.JWTAdminTTL)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.respondSession(w, r, &a, access, next)
}

// respondSession — login va refresh uchun yagona javob shakli.
//
// Refresh token QAYERDA qaytishi klientga bog'liq:
//   - veb   — faqat HttpOnly cookie da (javob tanasida YOQ, XSS o'qiy olmasin);
//   - mobil — faqat javob tanasida (u tokenni qurilma keychain ida saqlaydi,
//     cookie idorasini yuritmaydi).
func (h *Handler) respondSession(w http.ResponseWriter, r *http.Request, a *models.Admin, access, refresh string) {
	body := map[string]any{
		"accessToken": access,
		"admin":       a,
		// Klient tokenni muddati tugashidan oldin yangilab qo'yishi uchun.
		"expiresIn": int(h.Cfg.JWTAdminTTL / time.Second),
		// Panel "sessiya N kundan keyin yopiladi" deb ko'rsatishi uchun.
		"idleTimeoutSec": int(h.Cfg.AdminIdleTTL / time.Second),
	}
	if httpx.ClientPlatform(r) == httpx.PlatformWeb {
		h.setRefreshCookie(w, refresh)
	} else {
		body["refreshToken"] = refresh
	}
	httpx.JSON(w, 200, body)
}
