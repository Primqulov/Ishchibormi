package errlog

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Maxsimal uzunliklar. Xatolik matni tashqi xizmatdan (Gemini, FCM, Mongo)
// yoki mijozdan kelishi mumkin — ya'ni uzunligi biz nazorat qilmaydigan
// qiymat. Cheklamasak, bitta buzuq javob megabaytlik hujjatni bazaga va
// keyin admin ekraniga olib kirardi.
const (
	MaxMessage = 500
	MaxWhere   = 200
	MaxPath    = 200
	MaxNote    = 500
)

var (
	// Bearer token / Authorization sarlavhasi qoldiqlari.
	reBearer = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[A-Za-z0-9\-._~+/=]+`)
	// URL yoki matn ichidagi `token=…`, `code=…`, `secret=…`, `password=…`.
	reKeyed = regexp.MustCompile(`(?i)\b(token|access_token|refresh_token|code|otp|secret|password|passwd|pwd|apikey|api_key|key|sig|signature)\s*[=:]\s*("?)[^\s"&,;)]{4,}`)
	// JWT — uch bo'lakli base64url.
	reJWT = regexp.MustCompile(`\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*`)
	// Uzun hex/base64 bo'laklar (kalitlar, hash'lar, imzolar).
	reBlob = regexp.MustCompile(`\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/]{40,}={0,2}\b`)
	// Elektron pochta.
	reEmail = regexp.MustCompile(`\b([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b`)
	// Telefon: ixtiyoriy `+`, keyin 7…15 raqam (orasida bo'shliq/chiziqcha).
	rePhone = regexp.MustCompile(`\+?\d[\d\s\-()]{6,18}\d`)
	// IPv4.
	reIPv4 = regexp.MustCompile(`\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b`)
	// IPv6 (soddalashtirilgan).
	reIPv6 = regexp.MustCompile(`\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b`)
	// Yo'l BO'LAGI to'liq ObjectID, UUID yoki uzun raqam — fingerprint uchun
	// `:id`. Bir butun yo'lga emas, har bir bo'lakka alohida qo'llanadi:
	// Go'ning regexp'ida lookahead yo'q, ketma-ket kelgan ikki id'ni
	// (`/…/652f…/652f…/`) bitta shablon bilan almashtirib bo'lmaydi.
	reIDSeg = regexp.MustCompile(`^(?:[A-Fa-f0-9]{24}|[A-Fa-f0-9]{8}-[A-Fa-f0-9\-]{27}|\d{4,})$`)
	// Boshqaruv belgilari: jurnal qatorini buzadi, terminalda esa ANSI
	// ketma-ketligi bo'lib "chiziladi".
	reCtl = regexp.MustCompile(`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`)
)

// Text — bazaga yozilishi mumkin bo'lgan HAR QANDAY erkin matn shu yerdan
// o'tadi (xabar, `where`, izoh).
//
// # NEGA
//
// Figma 3.12.2 · G · "Maxfiylik" bandi: so'rov satri saqlanmaydi, telefon va
// IP niqoblanadi. Sabab oddiy — xatolik matni ko'pincha aynan o'sha
// so'rovning bir bo'lagi bo'ladi. `otp_send_failed` xabari ichida
// foydalanuvchining telefon raqami, `bad_token` ichida esa tokenning o'zi
// turishi mumkin. Ular bazaga tushsa, "Xatoliklar" sahifasi jimgina
// shaxsiy ma'lumot omboriga aylanadi: 180 kun saqlanadigan, moderatorga
// ochiq, eksport qilinadigan ombor.
//
// Niqoblash BIR TOMONLAMA va ataylab qo'pol: shubhali ko'ringan hamma narsa
// yo'qoladi. Diagnostika uchun kod + fayl + qator yetarli; haqiqiy qiymat
// kerak bo'lsa, u serverning o'z logida (qisqa muddatli) qoladi.
func Text(s string) string {
	s = reCtl.ReplaceAllString(s, " ")
	// Tartib muhim: avval eng aniq shakllar (token, JWT), keyin umumiylari.
	// Aks holda `reBlob` JWT'ning bir bo'lagini yeb, qolgani ochiq qolardi.
	s = reBearer.ReplaceAllString(s, "$1 ***")
	s = reJWT.ReplaceAllString(s, "***")
	s = reKeyed.ReplaceAllString(s, "$1=***")
	s = reBlob.ReplaceAllString(s, "***")
	s = reEmail.ReplaceAllString(s, "$1***@$2")
	s = rePhone.ReplaceAllStringFunc(s, maskPhone)
	s = reIPv4.ReplaceAllString(s, "$1.$2.*.*")
	s = reIPv6.ReplaceAllString(s, "***")
	return Clip(strings.TrimSpace(collapseSpace(s)), MaxMessage)
}

// maskPhone: +998901234567 → +9989*****67. Boshi (operator kodigacha) va
// oxirgi ikki raqam qoladi — bu "bitta odam" emas, "shu operator" darajasida
// diagnostika uchun yetarli.
func maskPhone(s string) string {
	digits := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	// 7 tadan kam raqam — bu telefon emas (sana, o'lcham, kod).
	if len(digits) < 7 {
		return s
	}
	head := 4
	if len(digits) < 9 {
		head = 2
	}
	var b strings.Builder
	if strings.HasPrefix(strings.TrimSpace(s), "+") {
		b.WriteByte('+')
	}
	b.WriteString(string(digits[:head]))
	b.WriteString(strings.Repeat("*", len(digits)-head-2))
	b.WriteString(string(digits[len(digits)-2:]))
	return b.String()
}

func collapseSpace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

// Path — so'rov yo'lini fingerprint uchun normallashtiradi.
//
// So'rov SATRI (`?…`) hech qachon kirmaydi: aynan u yerda OTP peek tokeni,
// qidiruv matni va telefon raqami bo'ladi (shu sababli httpx.AccessLog ham
// `RequestURI` emas, `URL.Path` yozadi). Yo'l ichidagi id'lar `:id` ga
// almashadi — aks holda `/api/elons/<24 hex>` har bir e'lon uchun alohida
// guruh yasab, bitta nosozlikni yuzta qatorga sochib yuborardi.
func Path(p string) string {
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	p = reCtl.ReplaceAllString(p, "")
	seg := strings.Split(p, "/")
	for i, s := range seg {
		if reIDSeg.MatchString(s) {
			seg[i] = ":id"
		}
	}
	return Clip(strings.Join(seg, "/"), MaxPath)
}

// Clip — matnni n bayt bilan cheklaydi, UTF-8 ni buzmasdan.
func Clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return strings.TrimSpace(cut) + "…"
}
