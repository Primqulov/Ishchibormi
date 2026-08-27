package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
)

func testHandler(env string) *Handler {
	return &Handler{Cfg: config.Config{
		AppEnv:       env,
		JWTAdminTTL:  30 * time.Minute,
		AdminIdleTTL: 72 * time.Hour,
	}}
}

// Oyna aynan "foydalanilmagan muddat" bo'yicha yopiladi — sessiya necha kun
// oldin ochilgani muhim emas.
func TestIsIdleUsesLastActivity(t *testing.T) {
	h := testHandler("production")
	now := time.Now()

	cases := []struct {
		name string
		last time.Time
		want bool
	}{
		{"hozirgina ishlatilgan", now.Add(-time.Minute), false},
		{"oyna ichida (2 kun 23 soat)", now.Add(-71 * time.Hour), false},
		{"chegarada (roppa-rosa 72 soat)", now.Add(-72 * time.Hour), false},
		{"oyna yopilgan (73 soat)", now.Add(-73 * time.Hour), true},
		{"bir hafta tegilmagan", now.Add(-7 * 24 * time.Hour), true},
	}
	for _, c := range cases {
		if got := h.isIdle(c.last, now); got != c.want {
			t.Errorf("%s: isIdle = %v, kutilgan %v", c.name, got, c.want)
		}
	}
}

// Nol qiymat "cheksiz eski" DEB HISOBLANMAYDI. Bu maydon shu funksiya bilan
// birga qo'shilgani uchun undan oldingi har bir hisobda u bo'sh: bo'shni
// eskirgan deb bilish deploy bo'lishi bilan hamma adminni chiqarib yuborardi.
func TestIsIdleTreatsZeroAsFresh(t *testing.T) {
	h := testHandler("production")
	if h.isIdle(time.Time{}, time.Now()) {
		t.Error("yozilmagan lastActivityAt sessiyani yopmasligi kerak")
	}
}

// Token CSPRNG dan keladi va bazaga faqat xeshi tushadi.
func TestRefreshTokenIsRandomAndStoredHashed(t *testing.T) {
	a, err := newRefreshToken()
	if err != nil {
		t.Fatalf("newRefreshToken: %v", err)
	}
	b, err := newRefreshToken()
	if err != nil {
		t.Fatalf("newRefreshToken: %v", err)
	}
	if a == b {
		t.Fatal("ketma-ket ikkita token bir xil chiqdi")
	}
	// base64(32 bayt) — Refresh dagi uzunlik tekshiruvi shunga tayanadi.
	if len(a) < 40 {
		t.Errorf("token juda qisqa: %d belgi", len(a))
	}
	h := hashToken(a)
	if len(h) != 64 {
		t.Errorf("SHA-256 xeshi 64 hex belgi bo'lishi kerak, %d ta keldi", len(h))
	}
	if h == hashToken(b) {
		t.Error("turli tokenlar bir xil xesh berdi")
	}
	if hashToken(a) != h {
		t.Error("xesh deterministik emas")
	}
}

// Veb uchun refresh token JAVOB TANASIDA qaytmaydi — faqat HttpOnly cookie'da.
// Aynan shu XSS topilgan taqdirda uzoq muddatli admin sessiyasi o'g'irlanishini
// to'sib turadi, shuning uchun test bilan qotirilgan.
func TestRespondSessionWebKeepsRefreshOutOfBody(t *testing.T) {
	h := testHandler("production")
	r := httptest.NewRequest(http.MethodPost, "/api/admin/login", nil)
	r.Header.Set(httpx.ClientPlatformHeader, httpx.PlatformWeb)
	w := httptest.NewRecorder()

	h.respondSession(w, r, &models.Admin{Username: "root"}, "access-tok", "refresh-tok")

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("javobni o'qib bo'lmadi: %v", err)
	}
	if _, leaked := body["refreshToken"]; leaked {
		t.Error("veb javobida refreshToken bo'lmasligi kerak")
	}
	if body["accessToken"] != "access-tok" {
		t.Errorf("accessToken = %v", body["accessToken"])
	}

	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != refreshCookieName {
		t.Fatalf("refresh cookie o'rnatilmadi: %+v", cookies)
	}
	c := cookies[0]
	if c.Value != "refresh-tok" {
		t.Errorf("cookie qiymati = %q", c.Value)
	}
	if !c.HttpOnly {
		t.Error("cookie HttpOnly bo'lishi SHART — aks holda JavaScript uni o'qiydi")
	}
	if !c.Secure {
		t.Error("productionda cookie Secure bo'lishi kerak")
	}
	if c.SameSite != http.SameSiteStrictMode {
		t.Error("cookie SameSite=Strict bo'lishi kerak")
	}
	if c.Path != refreshCookiePath {
		t.Errorf("cookie Path = %q, kutilgan %q", c.Path, refreshCookiePath)
	}
}

// Mobil ilova cookie yuritmaydi — unga token javob tanasida kerak, cookie esa
// ortiqcha.
func TestRespondSessionMobileUsesBody(t *testing.T) {
	h := testHandler("production")
	r := httptest.NewRequest(http.MethodPost, "/api/admin/login", nil)
	r.Header.Set(httpx.ClientPlatformHeader, httpx.PlatformAndroid)
	w := httptest.NewRecorder()

	h.respondSession(w, r, &models.Admin{Username: "root"}, "access-tok", "refresh-tok")

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("javobni o'qib bo'lmadi: %v", err)
	}
	if body["refreshToken"] != "refresh-tok" {
		t.Errorf("mobil javobida refreshToken = %v", body["refreshToken"])
	}
	if got := w.Result().Cookies(); len(got) != 0 {
		t.Errorf("mobil klientga cookie o'rnatilmasligi kerak: %+v", got)
	}
	// Klient tokenni muddati tugashidan oldin yangilashi uchun.
	if body["expiresIn"] != float64(30*60) {
		t.Errorf("expiresIn = %v, kutilgan 1800", body["expiresIn"])
	}
	if body["idleTimeoutSec"] != float64(72*3600) {
		t.Errorf("idleTimeoutSec = %v, kutilgan 259200", body["idleTimeoutSec"])
	}
}

// Lokal backend HTTP orqali ishlaydi: Secure cookie u yerda umuman
// o'rnatilmasdi va dev'da admin paneli kira olmay qolardi.
func TestRefreshCookieNotSecureOutsideProduction(t *testing.T) {
	h := testHandler("dev")
	w := httptest.NewRecorder()
	h.setRefreshCookie(w, "tok")

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("bitta cookie kutilgandi, %d keldi", len(cookies))
	}
	if cookies[0].Secure {
		t.Error("dev'da Secure bayrog'i qo'yilmasligi kerak")
	}
	if !cookies[0].HttpOnly {
		t.Error("HttpOnly dev'da ham saqlanishi kerak")
	}
}

// Chiqish cookie'ni o'chirishi kerak: MaxAge<0 va bo'sh qiymat.
func TestClearRefreshCookieExpiresIt(t *testing.T) {
	h := testHandler("production")
	w := httptest.NewRecorder()
	h.clearRefreshCookie(w)

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("bitta cookie kutilgandi, %d keldi", len(cookies))
	}
	if cookies[0].Value != "" || cookies[0].MaxAge >= 0 {
		t.Errorf("cookie o'chirilmadi: value=%q maxAge=%d", cookies[0].Value, cookies[0].MaxAge)
	}
	// Path mos kelmasa brauzer BOSHQA cookie yaratadi va eskisi qolib ketadi.
	if cookies[0].Path != refreshCookiePath {
		t.Errorf("Path o'rnatilgandagi bilan bir xil bo'lishi shart: %q", cookies[0].Path)
	}
}

// Cookie'siz va tanasiz so'rov bazaga bormasligi kerak.
func TestRefreshTokenFromRequestEmptyWhenAbsent(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/admin/refresh", nil)
	if got := refreshTokenFromRequest(r); got != "" {
		t.Errorf("bo'sh so'rovdan token chiqdi: %q", got)
	}
}

// Cookie tanadan ustun: veb mijoz ikkalasini ham yuborsa ham HttpOnly
// cookie'dagi qiymat ishlatiladi.
func TestRefreshTokenFromRequestPrefersCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/admin/refresh", nil)
	r.AddCookie(&http.Cookie{Name: refreshCookieName, Value: "from-cookie"})
	if got := refreshTokenFromRequest(r); got != "from-cookie" {
		t.Errorf("refreshTokenFromRequest = %q", got)
	}
}
