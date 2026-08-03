package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ishchibormi/backend/config"
	"go.mongodb.org/mongo-driver/bson"
)

const testBotToken = "123456:TEST-BOT-TOKEN-FOR-SIGNING"

// signInitData quradi va imzolaydi — ya'ni Telegram klienti nima yuborsa,
// aynan shuni. Test faqat handler'ni emas, imzo algoritmining o'zini ham
// tekshirishi uchun bu yerda hash mustaqil ravishda qaytadan hisoblanadi
// (verifyInitData ichidagi kodni chaqirmaydi).
func signInitData(t *testing.T, botToken string, tgID int64, authDate time.Time, extra ...map[string]string) string {
	t.Helper()
	userJSON := `{"id":` + strconv.FormatInt(tgID, 10) + `,"first_name":"Test","language_code":"uz"}`
	fields := map[string]string{
		"auth_date": strconv.FormatInt(authDate.Unix(), 10),
		"query_id":  "AAHdF6IQAAAAAN0XohDhrOrc",
		"user":      userJSON,
	}
	// Klient versiyasiga qarab qo'shiladigan maydonlar (masalan `signature`).
	for _, m := range extra {
		for k, v := range m {
			fields[k] = v
		}
	}

	pairs := make([]string, 0, len(fields))
	for k, v := range fields {
		pairs = append(pairs, k+"="+v)
	}
	sort.Strings(pairs)

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(strings.Join(pairs, "\n")))

	q := url.Values{}
	for k, v := range fields {
		q.Set(k, v)
	}
	q.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return q.Encode()
}

// ---------------------------------------------------------------------------
// Imzo tekshiruvi (bazasiz — sof funksiya)
// ---------------------------------------------------------------------------

func TestVerifyInitDataAcceptsGenuineSignature(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now)

	got, err := verifyInitData(data, testBotToken, now, 24*time.Hour)
	if err != nil {
		t.Fatalf("haqiqiy initData rad etildi: %v", err)
	}
	if got != 555000111 {
		t.Fatalf("telegramId = %d, kutilgan 555000111", got)
	}
}

// Regressiya: yangi Telegram klientlari `signature` maydonini ham yuboradi.
//
// U bir vaqtlar data-check-string'dan `hash` bilan birga chiqarib tashlangandi
// va natijada YANGI klientlarda har bir kirish 401 bo'lardi. Eski testlar buni
// tuta olmasdi, chunki fixture `signature` ni umuman yubormasdi — ya'ni xato
// bor kod yo'li testda hech qachon bosilmagan.
//
// `signature` faqat UCHINCHI TARAF (Ed25519) tekshiruvida chiqariladi; bu
// yerdagi bot-token HMAC usulida u oddiy maydon va imzoga kiradi.
func TestVerifyInitDataAcceptsSignatureField(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now, map[string]string{
		"signature": "Rhx_nliDJcu1NunbUgJuqyBls-x5GGh-Q5OYEvysPgrViBMMA0g4htyE6befIZDgpihWJJ",
	})

	if !strings.Contains(data, "signature=") {
		t.Fatal("test yaroqsiz: signature maydoni qo'shilmadi")
	}

	got, err := verifyInitData(data, testBotToken, now, 24*time.Hour)
	if err != nil {
		t.Fatalf("signature maydoni bor initData rad etildi: %v", err)
	}
	if got != 555000111 {
		t.Fatalf("telegramId = %d, kutilgan 555000111", got)
	}
}

// `signature` imzoga kirgani uchun uni o'zgartirish ham hash'ni buzishi kerak.
func TestVerifyInitDataRejectsTamperedSignatureField(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now, map[string]string{
		"signature": "AAAA_original_value_AAAA",
	})
	tampered := strings.Replace(data, "AAAA_original_value_AAAA", "BBBB_swapped_value_BBBB", 1)
	if tampered == data {
		t.Fatal("test yaroqsiz: signature o'zgarmadi")
	}
	if _, err := verifyInitData(tampered, testBotToken, now, 24*time.Hour); err == nil {
		t.Fatal("o'zgartirilgan signature bilan initData qabul qilindi")
	}
}

func TestVerifyInitDataRejectsTamperedPayload(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now)

	// Hujumchi imzoni tegmasdan boshqa hisobga o'tishga urinadi — aynan shu
	// hash nimadan himoya qilishi kerak.
	tampered := strings.Replace(data, "555000111", "999000222", 1)
	if tampered == data {
		t.Fatal("test yaroqsiz: payload o'zgarmadi")
	}
	if _, err := verifyInitData(tampered, testBotToken, now, 24*time.Hour); err == nil {
		t.Fatal("o'zgartirilgan initData qabul qilindi")
	}
}

func TestVerifyInitDataRejectsForeignBotToken(t *testing.T) {
	now := time.Now()
	// Boshqa bot tomonidan imzolangan initData — o'z botimizning kirishi emas.
	data := signInitData(t, "999999:SOME-OTHER-BOT", 555000111, now)

	if _, err := verifyInitData(data, testBotToken, now, 24*time.Hour); err == nil {
		t.Fatal("begona bot tokeni bilan imzolangan initData qabul qilindi")
	}
}

func TestVerifyInitDataRejectsStaleAuthDate(t *testing.T) {
	now := time.Now()
	// Imzo to'g'ri, lekin initData eski — ushlab olingan qiymatni keyinroq
	// qayta o'ynatishga qarshi yagona to'siq shu.
	data := signInitData(t, testBotToken, 555000111, now.Add(-48*time.Hour))

	if _, err := verifyInitData(data, testBotToken, now, 24*time.Hour); err == nil {
		t.Fatal("eskirgan initData qabul qilindi")
	}
	// TTL nolga teng bo'lsa yosh tekshirilmaydi (ataylab o'chirish imkoni).
	if _, err := verifyInitData(data, testBotToken, now, 0); err != nil {
		t.Fatalf("TTL o'chirilganda eski initData ham o'tishi kerak edi: %v", err)
	}
}

func TestVerifyInitDataRejectsFutureAuthDate(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now.Add(2*time.Hour))

	if _, err := verifyInitData(data, testBotToken, now, 24*time.Hour); err == nil {
		t.Fatal("kelajakdagi auth_date qabul qilindi")
	}
}

func TestVerifyInitDataRejectsMalformedInput(t *testing.T) {
	now := time.Now()
	valid := signInitData(t, testBotToken, 555000111, now)

	cases := map[string]string{
		"bo'sh":            "",
		"hash yo'q":        "auth_date=" + strconv.FormatInt(now.Unix(), 10) + "&user=%7B%22id%22%3A1%7D",
		"hash hex emas":    strings.Replace(valid, "hash=", "hash=zzzz", 1),
		"user maydonsiz":   "auth_date=" + strconv.FormatInt(now.Unix(), 10) + "&hash=abcd",
		"auth_date raqam emas": strings.Replace(valid, "auth_date=", "auth_date=x", 1),
	}
	for name, data := range cases {
		if _, err := verifyInitData(data, testBotToken, now, 24*time.Hour); err == nil {
			t.Errorf("%s: yaroqsiz initData qabul qilindi", name)
		}
	}
}

func TestVerifyInitDataRequiresBotToken(t *testing.T) {
	now := time.Now()
	data := signInitData(t, testBotToken, 555000111, now)

	// Token sozlanmagan bo'lsa hech narsa tekshirilmaydi — bunday holatda
	// funksiya "ok" demasligi kerak (handler ham 503 bilan to'xtatadi).
	if _, err := verifyInitData(data, "", now, 24*time.Hour); err == nil {
		t.Fatal("bot tokensiz initData qabul qilindi")
	}
}

// ---------------------------------------------------------------------------
// Handler (Mongo talab qiladi — lokal mongo bo'lmasa o'tkazib yuboriladi)
// ---------------------------------------------------------------------------

func webAppTestConfig() config.Config {
	cfg := loginTestConfig()
	cfg.TelegramMiniAppBotToken = testBotToken
	cfg.MiniAppInitDataTTL = 24 * time.Hour
	cfg.TelegramBotUsername = "Ishchi_bormi_auth_bot"
	return cfg
}

// callWebApp — handler'ni haqiqiy HTTP so'rovi bilan chaqiradi.
func callWebApp(t *testing.T, h *Handler, initData string) (status int, accessToken, errCode string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"initData": initData})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/telegram/webapp", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	h.TelegramWebApp(rec, req)

	var parsed struct {
		AccessToken string `json:"accessToken"`
		Error       struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return rec.Code, parsed.AccessToken, parsed.Error.Code
}

func TestWebAppLoginIssuesSessionForLinkedAccount(t *testing.T) {
	db := testDB(t)
	h := NewHandler(webAppTestConfig(), db)

	const tgID int64 = 700100200
	if _, err := h.users.InsertOne(context.Background(), bson.M{
		"phone": "+998901112233", "telegramId": tgID,
		"firstName": "Ali", "lastName": "Valiyev",
		"isPhoneVerified": true, "isBlocked": false, "isDeleted": false,
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}

	status, token, errCode := callWebApp(t, h, signInitData(t, testBotToken, tgID, time.Now()))
	if status != http.StatusOK {
		t.Fatalf("status = %d (%s), kutilgan 200", status, errCode)
	}
	if token == "" {
		t.Fatal("accessToken bo'sh")
	}
}

func TestWebAppLoginAsksForContactWhenNotRegistered(t *testing.T) {
	db := testDB(t)
	h := NewHandler(webAppTestConfig(), db)

	// Bazada bunday telegramId yo'q — hisob YARATILMASLIGI va klient OTP
	// oqimiga yo'naltirilishi kerak (telefon initData da yo'q).
	status, _, errCode := callWebApp(t, h, signInitData(t, testBotToken, 111222333, time.Now()))
	if status != http.StatusConflict || errCode != "need_contact" {
		t.Fatalf("status = %d code = %q, kutilgan 409 need_contact", status, errCode)
	}

	n, err := h.users.CountDocuments(context.Background(), bson.M{"telegramId": 111222333})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("telefonsiz hisob yaratilib qolgan (%d ta)", n)
	}
}

func TestWebAppLoginIsRefusedForBlockedAccount(t *testing.T) {
	db := testDB(t)
	h := NewHandler(webAppTestConfig(), db)

	const tgID int64 = 700100201
	if _, err := h.users.InsertOne(context.Background(), bson.M{
		"phone": "+998901112244", "telegramId": tgID,
		"isBlocked": true, "isDeleted": false,
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}

	status, token, errCode := callWebApp(t, h, signInitData(t, testBotToken, tgID, time.Now()))
	if status != http.StatusForbidden || errCode != "account_blocked" {
		t.Fatalf("status = %d code = %q, kutilgan 403 account_blocked", status, errCode)
	}
	if token != "" {
		t.Fatal("bloklangan hisobga token berildi")
	}
}

func TestWebAppLoginIgnoresDeletedAccount(t *testing.T) {
	db := testDB(t)
	h := NewHandler(webAppTestConfig(), db)

	// O'chirilgan hisob o'z telegramId sini bo'shatadi, lekin hujjat arxiv
	// sifatida qoladi — u tirilib ketmasligi kerak.
	const tgID int64 = 700100202
	if _, err := h.users.InsertOne(context.Background(), bson.M{
		"phone": "", "telegramId": tgID, "isDeleted": true,
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}

	status, _, errCode := callWebApp(t, h, signInitData(t, testBotToken, tgID, time.Now()))
	if status != http.StatusConflict || errCode != "need_contact" {
		t.Fatalf("status = %d code = %q, kutilgan 409 need_contact", status, errCode)
	}
}

func TestWebAppLoginRejectsInvalidInitData(t *testing.T) {
	db := testDB(t)
	h := NewHandler(webAppTestConfig(), db)

	status, _, errCode := callWebApp(t, h, "auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef")
	if status != http.StatusUnauthorized || errCode != "invalid_init_data" {
		t.Fatalf("status = %d code = %q, kutilgan 401 invalid_init_data", status, errCode)
	}
}

func TestWebAppLoginIsDisabledWithoutBotToken(t *testing.T) {
	db := testDB(t)
	cfg := webAppTestConfig()
	cfg.TelegramMiniAppBotToken = ""
	cfg.TelegramBotToken = ""
	h := NewHandler(cfg, db)

	// Token yo'q => imzoni tekshirib bo'lmaydi => kirish yopiq (fail-closed).
	status, _, errCode := callWebApp(t, h, signInitData(t, testBotToken, 700100203, time.Now()))
	if status != http.StatusServiceUnavailable || errCode != "miniapp_disabled" {
		t.Fatalf("status = %d code = %q, kutilgan 503 miniapp_disabled", status, errCode)
	}
}
