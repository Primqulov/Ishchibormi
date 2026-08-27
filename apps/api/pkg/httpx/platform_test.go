package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func req(header, ua string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	if header != "" {
		r.Header.Set(ClientPlatformHeader, header)
	}
	if ua != "" {
		r.Header.Set("User-Agent", ua)
	}
	return r
}

func TestClientPlatformFromHeader(t *testing.T) {
	cases := []struct {
		name, header, want string
	}{
		{"web", "web", PlatformWeb},
		{"android", "android", PlatformAndroid},
		{"ios", "ios", PlatformIOS},
		// Klient noto'g'ri registr yoki ortiqcha bo'shliq yuborsa ham bitta
		// guruhga tushishi kerak — aks holda hisobotda takroriy ustun paydo
		// bo'lardi.
		{"katta harf", "Android", PlatformAndroid},
		{"bo'shliq bilan", "  web  ", PlatformWeb},
		// Ro'yxatdan tashqari qiymat — jimgina saqlanib qolmasin.
		{"notanish", "windows-phone", ""},
		{"bo'sh", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ClientPlatform(req(c.header, "")); got != c.want {
				t.Fatalf("ClientPlatform(%q) = %q, kutilgan %q", c.header, got, c.want)
			}
		})
	}
}

func TestClientPlatformUserAgentFallback(t *testing.T) {
	// Sarlavhani yubormaydigan ESKI veb-klient hali ham brauzer sifatida
	// tanilishi kerak: aks holda mavjud foydalanuvchilarning hammasi
	// "noma'lum" bo'lib qolardi.
	browser := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
	if got := ClientPlatform(req("", browser)); got != PlatformWeb {
		t.Fatalf("brauzer UA = %q, kutilgan %q", got, PlatformWeb)
	}

	// Mobil ilova UA'si qaysi OS ekanini AYTMAYDI — bu yerda taxmin
	// qilmaslik kerak, aks holda iOS foydalanuvchilari Android bo'lib
	// sanalardi.
	if got := ClientPlatform(req("", "Dart/3.11 (dart:io)")); got != "" {
		t.Fatalf("Dart UA = %q, kutilgan bo'sh satr", got)
	}
	if got := ClientPlatform(req("", "curl/8.4.0")); got != "" {
		t.Fatalf("curl UA = %q, kutilgan bo'sh satr", got)
	}
}

func TestHeaderBeatsUserAgent(t *testing.T) {
	// Sarlavha aniq aytilgan joyda UA taxminiga o'tilmasligi kerak.
	// Amaliy holat: mobil ilovadagi WebView brauzer UA'sini yuboradi.
	got := ClientPlatform(req("android", "Mozilla/5.0 (Linux; Android 14)"))
	if got != PlatformAndroid {
		t.Fatalf("got %q, kutilgan %q", got, PlatformAndroid)
	}
}

func TestPlatformOrUnknown(t *testing.T) {
	if got := PlatformOrUnknown(""); got != PlatformUnknown {
		t.Fatalf("bo'sh -> %q, kutilgan %q", got, PlatformUnknown)
	}
	if got := PlatformOrUnknown(PlatformWeb); got != PlatformWeb {
		t.Fatalf("web -> %q, o'zgarmasligi kerak", got)
	}
}
