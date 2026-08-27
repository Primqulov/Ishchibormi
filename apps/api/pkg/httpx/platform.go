package httpx

import (
	"net/http"
	"strings"
)

// Foydalanuvchi qaysi klientdan kelgani. Ro'yxat YOPIQ: klient yuborgan
// matn shu qiymatlarning biriga keltiriladi, aks holda [PlatformUnknown]
// bo'ladi.
//
// Nega yopiq: bu qiymat bazaga yoziladi va admin panelida guruhlanadi.
// Klient yuborgan xom satrni saqlasak, bitta noto'g'ri build ("Android",
// "android-14", "  web") hisobotda alohida ustun bo'lib chiqardi va sanoq
// jimgina buzilardi.
const (
	PlatformWeb     = "web"
	PlatformAndroid = "android"
	PlatformIOS     = "ios"
	// PlatformUnknown — klient o'zini tanitmagan. Saqlashda BO'SH satr
	// ishlatiladi (maydon umuman yozilmaydi), bu esa faqat ko'rsatish uchun.
	PlatformUnknown = "unknown"
)

// ClientPlatformHeader — klient o'zini tanitadigan sarlavha.
//
// User-Agent'dan alohida sarlavha, chunki UA ishonchsiz: Dio (Flutter)
// standart holatda "Dart/3.x (dart:io)" yuboradi — bu Android'ni iOS'dan
// ajratmaydi; brauzerda esa UA'ni har qanday kengaytma o'zgartirishi mumkin.
// Sarlavhani klientlarning o'zi qo'yadi va u ATAYLAB ixtiyoriy: eski
// versiyalar uni yubormaydi va ular oddiygina "unknown" bo'lib qoladi.
const ClientPlatformHeader = "X-Client-Platform"

// Platforms — hisobotlarda ko'rsatiladigan tartib.
var Platforms = []string{PlatformWeb, PlatformAndroid, PlatformIOS}

// ClientPlatform so'rov qaysi platformadan kelganini qaytaradi:
// "web" | "android" | "ios", yoki aniqlab bo'lmasa BO'SH satr.
//
// Bo'sh satr ataylab: chaqiruvchi uni bazaga yozmasligi kerak. "unknown"
// deb yozib qo'ysak, keyinchalik haqiqiy qiymat kelganda uni "eskirgan
// noma'lum" dan ajratib bo'lmasdi.
func ClientPlatform(r *http.Request) string {
	if p := normalizePlatform(r.Header.Get(ClientPlatformHeader)); p != "" {
		return p
	}
	// Zaxira: sarlavhani yubormaydigan eski klientlar. Faqat brauzerni
	// ishonchli tanib oladi — mobil ilova UA'si (Dart/dart:io) qaysi OS
	// ekanini aytmaydi, shuning uchun u yerda taxmin qilmaymiz.
	return platformFromUserAgent(r.UserAgent())
}

// normalizePlatform klient yuborgan qiymatni yopiq ro'yxatga keltiradi.
func normalizePlatform(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case PlatformWeb:
		return PlatformWeb
	case PlatformAndroid:
		return PlatformAndroid
	case PlatformIOS:
		return PlatformIOS
	default:
		return ""
	}
}

// platformFromUserAgent — sarlavhasiz so'rov uchun zaxira.
//
// Faqat "bu brauzermi" degan savolga javob beradi. Mo'ljal — Mozilla
// prefiksi: uni har bir brauzer yuboradi, `curl`, Dio va Go'ning
// http.Client esa yubormaydi.
func platformFromUserAgent(ua string) string {
	if strings.HasPrefix(ua, "Mozilla/") {
		return PlatformWeb
	}
	return ""
}

// PlatformOrUnknown — ko'rsatish uchun: bo'sh qiymatni [PlatformUnknown] ga
// aylantiradi. Saqlashda ISHLATILMAYDI.
func PlatformOrUnknown(p string) string {
	if p == "" {
		return PlatformUnknown
	}
	return p
}
