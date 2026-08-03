package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// Telegram Mini App kirishi.
//
// Mini App ochilganda Telegram klienti `initData` deb ataladigan imzolangan
// query-string beradi. Imzo botning tokeni bilan hisoblangani uchun uni
// server tomonda tekshirish — foydalanuvchi haqiqatan ham o'sha Telegram
// hisobiga egaligining isboti. Ya'ni bu yerda OTP kabi alohida "kod" kerak
// emas: qaytgan foydalanuvchi Mini App'ni ochishi bilanoq kiradi.
//
// Nima uchun bu OTP oqimini ALMASHTIRMAYDI: `initData` telefon raqamini
// bermaydi, models.User da esa telefon majburiy. Shuning uchun mutlaqo yangi
// foydalanuvchi baribir bir marta botda kontaktini ulashishi kerak — bu holat
// need_contact bilan qaytariladi va klient mavjud OTP oqimiga o'tadi. Bir marta
// ro'yxatdan o'tgach, keyingi barcha kirishlar shu endpoint orqali avtomatik.

// initDataTelegramUser — `initData` ichidagi `user` maydonining bizga kerakli
// qismi. Telegram bu yerda boshqa maydonlarni ham beradi (username, til, ...),
// lekin foydalanuvchi hujjatining haqiqat manbai bizning bazamiz, shuning
// uchun ulardan hech biri saqlanmaydi.
type initDataTelegramUser struct {
	ID int64 `json:"id"`
}

// errInitData — imzo yoki format bilan bog'liq har qanday nosozlik. Sabab
// ataylab bitta xatoga yig'ilgan: klientga "hash noto'g'ri" bilan "auth_date
// eskirgan" o'rtasidagi farqni aytish soxtalashtiruvchiga bepul ma'lumot berish
// bo'lar edi. Batafsil sabab faqat serverda qoladi.
var errInitData = errors.New("invalid initData")

// verifyInitData — Telegram Mini App imzosini tekshiradi va foydalanuvchining
// Telegram ID sini qaytaradi.
//
// Algoritm (Telegram hujjatlari, "Validating data received via the Mini App"):
//  1. `hash` maydoni ajratib olinadi, qolgan barcha maydonlar `key=value`
//     ko'rinishida kalit bo'yicha alifbo tartibida saralanib `\n` bilan
//     birlashtiriladi (data-check-string).
//  2. secretKey = HMAC_SHA256(kalit: "WebAppData", ma'lumot: botToken)
//  3. kutilgan hash = HMAC_SHA256(kalit: secretKey, ma'lumot: dataCheckString)
//
// Funksiya ataylab sof (pure): na tarmoq, na baza — shuning uchun to'g'ri,
// buzilgan va eskirgan initData holatlari testda to'g'ridan-to'g'ri
// tekshiriladi (webapp_test.go).
func verifyInitData(initData, botToken string, now time.Time, ttl time.Duration) (int64, error) {
	if strings.TrimSpace(initData) == "" || botToken == "" {
		return 0, errInitData
	}
	// ParseQuery qiymatlarni URL-dekod qiladi — data-check-string aynan
	// dekodlangan qiymatlardan tuziladi.
	values, err := url.ParseQuery(initData)
	if err != nil {
		return 0, errInitData
	}
	gotHash := values.Get("hash")
	if gotHash == "" {
		return 0, errInitData
	}

	pairs := make([]string, 0, len(values))
	for k, v := range values {
		// `hash` imzoning o'zi, `signature` esa Telegram'ning yangi Ed25519
		// imzosi — ikkalasi ham data-check-string'ga kirmaydi.
		if k == "hash" || k == "signature" {
			continue
		}
		if len(v) == 0 {
			continue
		}
		pairs = append(pairs, k+"="+v[0])
	}
	sort.Strings(pairs)
	dataCheckString := strings.Join(pairs, "\n")

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(dataCheckString))
	want := mac.Sum(nil)

	got, err := hex.DecodeString(gotHash)
	if err != nil {
		return 0, errInitData
	}
	// Doimiy vaqtli solishtirish: oddiy == bilan solishtirish hash'ni bayt-bayt
	// topib olishga imkon beruvchi vaqt kanalini ochadi.
	if !hmac.Equal(got, want) {
		return 0, errInitData
	}

	// Imzo to'g'ri bo'lsa ham initData qayta ishlatilishi mumkin — uni ushlab
	// olgan kishi keyinroq o'ynatib ko'rmasligi uchun yoshini cheklaymiz.
	authDate, err := strconv.ParseInt(values.Get("auth_date"), 10, 64)
	if err != nil || authDate <= 0 {
		return 0, errInitData
	}
	issued := time.Unix(authDate, 0)
	if ttl > 0 && now.Sub(issued) > ttl {
		return 0, errInitData
	}
	// Kelajakdagi sana — soat farqi emas, soxtalashtirishga urinish belgisi.
	// Kichik zaxira qoldiramiz, chunki qurilma soati bir necha daqiqaga
	// oldinda bo'lishi odatiy hol.
	if issued.After(now.Add(5 * time.Minute)) {
		return 0, errInitData
	}

	var tgUser initDataTelegramUser
	if err := json.Unmarshal([]byte(values.Get("user")), &tgUser); err != nil {
		return 0, errInitData
	}
	if tgUser.ID <= 0 {
		return 0, errInitData
	}
	return tgUser.ID, nil
}

type webAppLoginReq struct {
	InitData string `json:"initData"`
}

// webAppNeedContactResp — hali hisobi yo'q foydalanuvchiga qaytariladigan
// javob. BotURL bo'sh bo'lishi mumkin (TELEGRAM_BOT_USERNAME sozlanmagan
// bo'lsa); klientda buni hisobga olish kerak.
type webAppNeedContactResp struct {
	Error  httpx.APIError `json:"error"`
	BotURL string         `json:"botUrl,omitempty"`
}

// TelegramWebApp — POST /api/auth/telegram/webapp
//
// Mini App ochilganda birinchi bo'lib shu chaqiriladi. Uchta natija bo'lishi
// mumkin: sessiya (mavjud hisob), need_contact (hali ro'yxatdan o'tmagan) yoki
// xato.
func (h *Handler) TelegramWebApp(w http.ResponseWriter, r *http.Request) {
	token := h.cfg.MiniAppBotToken()
	if token == "" {
		// Fail-closed: token bo'lmasa imzoni tekshirib bo'lmaydi, tekshirilmagan
		// initData bilan esa kimdir ixtiyoriy telegramId yozib bera oladi.
		httpx.Err(w, httpx.NewError(http.StatusServiceUnavailable,
			"miniapp_disabled", "mini app login is not configured"))
		return
	}

	var req webAppLoginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}

	tgID, err := verifyInitData(req.InitData, token, time.Now(), h.cfg.MiniAppInitDataTTL)
	if err != nil {
		httpx.Err(w, httpx.NewError(http.StatusUnauthorized,
			"invalid_init_data", "invalid or expired Telegram data"))
		return
	}

	// Hisobni FAQAT telegramId bo'yicha qidiramiz va hech qachon yaratmaymiz:
	// telefon initData da yo'q, telefonsiz hujjat esa upsertUser o'rnatadigan
	// invariantni buzadi. Yangi foydalanuvchi OTP oqimidan o'tadi.
	var u models.User
	filter := bson.M{"telegramId": tgID, "isDeleted": bson.M{"$ne": true}}
	if err := h.users.FindOne(r.Context(), filter).Decode(&u); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			resp := webAppNeedContactResp{
				Error: httpx.APIError{
					Code:    "need_contact",
					Message: "phone number is not linked yet",
				},
			}
			if h.cfg.TelegramBotUsername != "" {
				resp.BotURL = "https://t.me/" + h.cfg.TelegramBotUsername
			}
			httpx.JSON(w, http.StatusConflict, resp)
			return
		}
		httpx.Err(w, err)
		return
	}

	// Bloklangan hisobga token bermaymiz: RequireActiveUser keyingi har bir
	// so'rovni baribir rad etadi, ya'ni sessiya berish faqat "kirdim, lekin
	// hech narsa ishlamayapti" holatini yaratadi. VerifyOTP ham xuddi shunday
	// qiladi.
	if u.IsBlocked {
		httpx.Err(w, httpx.NewError(http.StatusForbidden,
			"account_blocked", "account is blocked"))
		return
	}

	h.issueSession(w, &u)
}
