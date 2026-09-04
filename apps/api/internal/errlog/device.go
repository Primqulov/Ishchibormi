package errlog

import (
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/ishchibormi/backend/internal/models"
)

// Qurilma ma'lumotini o'qish (Figma 3.12.3 · H va M).
//
// # NEGA YANGI SARLAVHA
//
// Hozirgi kodda qurilma modeli YO'Q: `X-Client-Platform` faqat
// web / android / ios ni ajratadi, Dio'ning User-Agent'i esa
// "Dart/3.x (dart:io)" bo'lgani uchun brend va modelni ko'rsatmaydi.
// Shuning uchun mijoz `X-Client-Device` sarlavhasini yuboradi —
// device_info_plus va package_info_plus dan yig'ilgan qisqa ro'yxat.
//
// # NEGA BU SARLAVHA ISHONCHSIZ MA'LUMOT
//
// Sarlavhani istalgan kishi qo'lda yozishi mumkin. U bazaga tushadi,
// keyin admin ekraniga, Telegram xabariga va AI eksportiga chiqadi —
// ya'ni bu tashqi matnning panel ichiga kiradigan yo'li. Shuning uchun
// uchta chegara birdan qo'llanadi:
//
//  1. KALITLAR — yopiq ro'yxat. Notanish kalit jimgina tashlanadi, ya'ni
//     sarlavha orqali yangi maydon "o'ylab topib" bo'lmaydi.
//  2. BELGILAR — oq ro'yxat. `< > & " \ { } [ ] $ | *` va boshqaruv
//     belgilari olib tashlanadi: ular HTML, Markdown va JSON kontekstlarida
//     ma'noga ega bo'lgan yagona belgilar.
//  3. UZUNLIK — har bir qiymat 48 belgi, butun sarlavha 512 bayt, kalitlar
//     soni 24 ta. Kilobaytlik "model nomi" hujjatni ham, ekranni ham
//     shishirmasligi kerak.
const (
	maxDeviceHeader = 512
	maxDeviceValue  = 48
	maxDevicePairs  = 24
)

// devSafe — qiymatda qolishi mumkin bo'lgan belgilar. Harf va raqamdan
// tashqari faqat o'lchov/versiya yozuvida uchraydiganlari.
func devSafe(r rune) bool {
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return true
	}
	switch r {
	// `·` (U+00B7) — mijoz bir maydonga ikki qiymat qo'yganda ishlatadigan
	// ajratuvchi: "34% · quvvatlanmayapti", "uz_UZ · Asia/Tashkent",
	// "1080 × 2400 · 2.75x". U oq ro'yxatda bo'lmagani uchun ilgari
	// tushib qolar va ikkita qiymat bitta so'zga yopishib ketardi.
	case ' ', '.', ',', ':', '/', '_', '-', '(', ')', '+', '%', '@', '×', '°', '·', '\'':
		return true
	}
	return false
}

// devValue — bitta qiymatni tozalaydi. Qaytarilgan satr yuqoridagi oq
// ro'yxatdan tashqari hech narsa saqlamaydi.
func devValue(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if !devSafe(r) {
			continue
		}
		if r == ' ' {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return Clip(strings.TrimSpace(b.String()), maxDeviceValue)
}

// ParseDevice — so'rovdan qurilma ma'lumotini yig'adi.
//
// Ustuvorlik: `X-Client-Device` (mijoz aniq yuborgan) → `X-Client-Platform`
// (allaqachon bor) → `User-Agent` va `Sec-CH-UA-*` (faqat veb uchun, brauzer
// o'zi qo'yadi). Hech biri bo'lmasa bo'sh struktura qaytadi — panel uni
// "aniqlanmagan" deb ko'rsatadi, hech qachon bo'sh katak emas
// (Figma 3.12.3 · M dagi izoh).
func ParseDevice(r *http.Request) models.ErrorDevice {
	var d models.ErrorDevice
	if r == nil {
		return d
	}
	d.Platform = devValue(strings.ToLower(r.Header.Get("X-Client-Platform")))
	switch d.Platform {
	case "android", "ios", "web", "":
	default:
		// Kutilmagan qiymat — uni ko'rsatishdan ko'ra tashlagan yaxshi:
		// "Platforma" katagi filtrga ham, statistikaga ham kiradi.
		d.Platform = ""
	}

	raw := r.Header.Get("X-Client-Device")
	if len(raw) > maxDeviceHeader {
		raw = raw[:maxDeviceHeader]
	}
	if raw != "" {
		n := 0
		for _, part := range strings.Split(raw, ";") {
			if n >= maxDevicePairs {
				break
			}
			k, v, ok := strings.Cut(part, "=")
			if !ok {
				continue
			}
			n++
			assignDevice(&d, strings.ToLower(strings.TrimSpace(k)), devValue(v))
		}
	}

	// Veb: brauzer o'zi yuboradigan sarlavhalar. Ular ham ishonchsiz, lekin
	// shu yo'l bilan hech bo'lmasa "Chrome 127 · Windows" ma'lum bo'ladi.
	if d.Platform == "web" || (d.Platform == "" && d.Brand == "" && d.Model == "") {
		fillFromUA(&d, r)
	}
	return d
}

func assignDevice(d *models.ErrorDevice, k, v string) {
	if v == "" {
		return
	}
	switch k {
	case "brand":
		d.Brand = v
	case "model":
		d.Model = v
	case "modelcode":
		d.ModelCode = v
	case "os":
		d.OS = v
	case "osv":
		d.OSVersion = v
	case "api":
		d.APILevel = v
	case "app":
		d.AppVersion = v
	case "build":
		d.Build = v
	case "flutter":
		d.Flutter = v
	case "dart":
		d.Dart = v
	case "screen":
		d.Screen = v
	case "ram":
		d.RAM = v
	case "storage":
		d.Storage = v
	case "locale":
		d.Locale = v
	case "net":
		d.Network = v
	case "battery":
		d.Battery = v
	case "emu":
		d.Emulator = v
	case "orient":
		d.Orientation = v
	case "browser":
		d.Browser = v
	case "engine":
		d.Engine = v
	}
	// Notanish kalit — jimgina tashlanadi (yopiq ro'yxat).
}

// fillFromUA — veb mijoz uchun brauzer va OS. Ataylab qo'pol: bizga
// "Chrome 127 · Windows 11" darajasidagi aniqlik yetarli, to'liq UA satri
// esa barmoq izi (fingerprint) sifatida saqlanmaydi.
func fillFromUA(d *models.ErrorDevice, r *http.Request) {
	ua := r.Header.Get("User-Agent")
	if len(ua) > 400 {
		ua = ua[:400]
	}
	// Client Hints — brauzer to'g'ridan-to'g'ri beradi, UA'ni tahlil
	// qilishdan aniqroq.
	if d.OS == "" {
		if v := devValue(strings.Trim(r.Header.Get("Sec-CH-UA-Platform"), `"`)); v != "" {
			d.OS = v
		}
	}
	if d.OSVersion == "" {
		if v := devValue(strings.Trim(r.Header.Get("Sec-CH-UA-Platform-Version"), `"`)); v != "" {
			d.OSVersion = v
		}
	}
	if ua == "" {
		return
	}
	if d.Browser == "" {
		d.Browser = uaBrowser(ua)
	}
	if d.Engine == "" {
		d.Engine = uaEngine(ua)
	}
	if d.OS == "" {
		d.OS = uaOS(ua)
	}
}

// uaProducts — tartib muhim: Edge ham, Opera ham o'zini "Chrome" deb
// tanishtiradi, shuning uchun ular birinchi tekshiriladi.
var uaProducts = []struct{ token, name string }{
	{"Edg/", "Edge"}, {"OPR/", "Opera"}, {"SamsungBrowser/", "Samsung Internet"},
	{"YaBrowser/", "Yandex"}, {"Firefox/", "Firefox"}, {"Chrome/", "Chrome"},
	{"Version/", "Safari"}, {"Dart/", "Dart"},
}

func uaBrowser(ua string) string {
	for _, p := range uaProducts {
		i := strings.Index(ua, p.token)
		if i < 0 {
			continue
		}
		if p.name == "Safari" && !strings.Contains(ua, "Safari/") {
			continue
		}
		rest := ua[i+len(p.token):]
		ver := rest
		if j := strings.IndexAny(rest, " ;)"); j >= 0 {
			ver = rest[:j]
		}
		// Faqat asosiy versiya: "127.0.6533.100" → "127".
		if j := strings.Index(ver, "."); j > 0 {
			ver = ver[:j]
		}
		if _, err := strconv.Atoi(ver); err != nil {
			return devValue(p.name)
		}
		return devValue(p.name + " " + ver)
	}
	return ""
}

func uaEngine(ua string) string {
	switch {
	case strings.Contains(ua, "Gecko/"):
		return "Gecko"
	case strings.Contains(ua, "AppleWebKit/") && strings.Contains(ua, "Chrome/"):
		return "Blink"
	case strings.Contains(ua, "AppleWebKit/"):
		return "WebKit"
	}
	return ""
}

func uaOS(ua string) string {
	switch {
	case strings.Contains(ua, "Windows NT 10.0"):
		return "Windows 10/11"
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		return "iOS"
	case strings.Contains(ua, "Mac OS X"):
		return "macOS"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	}
	return ""
}

// DeviceLabel — ro'yxatdagi "Qurilma" ustuni uchun bir qatorlik yorliq
// (Figma 3.12.3 · N): "Xiaomi Redmi Note 12 · Android 14".
func DeviceLabel(d models.ErrorDevice) string {
	name := strings.TrimSpace(strings.TrimPrefix(d.Brand+" "+d.Model, " "))
	if name == "" {
		name = d.Browser
	}
	os := strings.TrimSpace(d.OS + " " + d.OSVersion)
	switch {
	case name != "" && os != "":
		return name + " · " + os
	case name != "":
		return name
	case os != "":
		return os
	case d.Platform != "":
		return d.Platform
	}
	return ""
}

// AppVersionLabel — ro'yxatdagi "Ilova versiyasi" ustuni uchun
// (Figma 3.12.3 · N): "1.4.2 (118)".
//
// Build raqami versiyadan ajralmasligi kerak: do'kondagi bitta 1.4.2
// bir necha marta qayta yig'iladi va "qaysi build'da qaytdi" degan
// savolga faqat shu raqam javob beradi. Batafsil ekran ham aynan shu
// formatni chizadi (`MuhitKarta`), ya'ni ro'yxat va batafsil ko'rinish
// bir xil satrni ko'rsatadi.
//
// `fb` — zaxira qiymat (hodisadagi versiya): qurilma sarlavhasi umuman
// kelmagan, lekin mijoz hisobotida versiya bo'lgan holat uchun.
func AppVersionLabel(d models.ErrorDevice, fb string) string {
	v := strings.TrimSpace(d.AppVersion)
	if v == "" {
		v = strings.TrimSpace(fb)
	}
	if v == "" {
		return ""
	}
	// Build allaqachon versiyaning ichida bo'lsa ("1.4.2+118" yoki
	// "1.4.2 (118)") ikkinchi marta qo'shmaymiz.
	if b := strings.TrimSpace(d.Build); b != "" && !strings.Contains(v, b) {
		return v + " (" + b + ")"
	}
	return v
}
