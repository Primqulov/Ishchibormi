// Package errlog — DASTUR xatoliklarining jurnali (Figma "3.12 · Xatoliklar").
//
// # NIMA YOZILADI, NIMA YOZILMAYDI
//
// Bu jurnal faqat DASTUR aybi bilan yuzaga kelgan hodisalar uchun. Figma
// 3.12.2 · G ning birinchi qoidasi aynan shu haqda: foydalanuvchi noto'g'ri
// kiritgan ma'lumot (validatsiya), 401/403 va 404 kabi KUTILGAN javoblar bu
// yerga tushmaydi — ular foydalanuvchining o'z ekranida ko'rsatiladi.
//
// Amalda bu quyidagicha ta'minlanadi:
//
//   - HTTP middleware faqat 5xx ni oladi (middleware.go). 4xx — kutilgan
//     javob: uni yozish jurnalni "kimdir parolni xato terdi" bilan
//     to'ldirib, haqiqiy nosozlikni ko'rinmas qilardi.
//   - Qolgan hamma narsa ANIQ chaqiruv bilan yoziladi: kod o'zi biladiki bu
//     nosozlik dasturning aybi (Gemini limiti tugadi, FCM javob bermadi).
//   - Mijozdan (Flutter/veb) keladigan xabarlar faqat shu katalogdagi
//     kodlarni qabul qiladi va DARAJANI mijoz emas, server belgilaydi.
//     Aks holda har kim "Kritik" hodisa yasab, Telegram'ga ogohlantirish
//     yubortira olardi.
//
// Katalog Figma 3.12.2 · C dagi 56 ta turni to'liq qamraydi, ustiga shu
// kodlar bazasida haqiqiy va jimgina kechadigan yana 3 ta holat qo'shilgan
// (quyida "QO'SHIMCHA" deb belgilangan).
package errlog

// Manba modullari — Figma 3.12.2 · C1…C7. Ro'yxatdagi "Manba" FILTRI shu
// qiymatlar bo'yicha ishlaydi.
const (
	ModBackend   = "backend"    // C1 · so'rovlar va handlerlar
	ModDB        = "db"         // C2 · ma'lumotlar bazasi
	ModExternal  = "external"   // C3 · tashqi xizmatlar
	ModJobs      = "jobs"       // C4 · fon jarayonlari va navbatlar
	ModAdminApp  = "admin_app"  // C5 · admin ilovasi (Flutter)
	ModClientApp = "client_app" // C6 · foydalanuvchi ilovasi va veb mijoz
	ModSecurity  = "security"   // C7 · autentifikatsiya va xavfsizlik
)

// Muhimlik darajalari — Figma 3.12.2 · A. Daraja KODGA biriktirilgan, ya'ni
// uni na mijoz, na admin o'zgartira oladi: u nishon rangini ham,
// bildirishnoma qoidasini ham belgilaydi.
const (
	SevCritical = "critical" // Darhol · Telegram + push
	SevHigh     = "high"     // 1 soat ichida · Telegram
	SevMedium   = "medium"   // 1 ish kuni · faqat panelda
	SevLow      = "low"      // Navbat bo'yicha · faqat panelda
)

// Guruh holatlari — Figma 3.12.2 · B, 3.12.3 · J bilan kengaytirilgan.
//
// Oqim: Yangi → Kuzatilmoqda → Bartaraf etilmoqda → Bartaraf etildi.
// Yopilganidan keyin xatolik qaytsa, u "Qayta paydo bo'ldi" ga o'tadi
// (regressiya) — bu holatni FAQAT tizim qo'yadi, admin emas.
const (
	StatusNew      = "new"
	StatusWatching = "watching"
	// StatusFixing — mas'ul biriktirilgan va tuzatish boshlangan.
	StatusFixing = "fixing"
	// StatusResolved — tuzatilgan versiya chiqarilgan ("Bartaraf etildi").
	StatusResolved = "resolved"
	// StatusRegressed — yopilgandan keyin yana takrorlandi. Faqat
	// recorder qo'yadi: "regressiya" — bu kuzatuvning xulosasi, admin
	// qo'lda belgilaydigan holat emas.
	StatusRegressed = "regressed"
	StatusIgnored   = "ignored"
)

// ManualStatuses — adminning O'ZI qo'ya oladigan holatlar. `regressed` bu
// yerda ataylab yo'q: uni qo'lda qo'yish mumkin bo'lsa, "qayta paydo bo'ldi"
// nishoni haqiqiy takrorlanish belgisi bo'lishdan to'xtardi.
var ManualStatuses = map[string]bool{
	StatusNew: true, StatusWatching: true, StatusFixing: true,
	StatusResolved: true, StatusIgnored: true,
}

// OpenStatuses — "Ochiq" filtri va ko'rsatkichlar uchun. Yopiq holatlar
// ikkitagina: bartaraf etildi va e'tiborsiz qoldirildi.
//
// bson.A emas, []string: Mongo driver `$in` uchun ikkalasini ham qabul
// qiladi, satrlar ro'yxati esa Go tomonida ham (masalan tekshiruvda)
// ishlatilishi mumkin.
var OpenStatuses = []string{StatusNew, StatusWatching, StatusFixing, StatusRegressed}

// MaxActivity — guruh ichidagi "Amallar tarixi" tasmasining uzunligi.
// To'liq tarix admin audit jurnalida qoladi; bu — faqat ekran uchun
// oxirgi yozuvlar.
const MaxActivity = 50

// statusLabels / severityLabels — audit jurnali va Telegram xabari uchun
// o'zbekcha yorliqlar. Panel o'z tarjimasini ishlatadi; bu yerda esa
// SERVER yozadigan matnlar (activity, audit detail) shakllanadi, ular
// keyin frontenddan mustaqil o'qiladi.
var statusLabels = map[string]string{
	StatusNew:       "Yangi",
	StatusWatching:  "Kuzatilmoqda",
	StatusFixing:    "Bartaraf etilmoqda",
	StatusResolved:  "Bartaraf etildi",
	StatusRegressed: "Qayta paydo bo'ldi",
	StatusIgnored:   "E'tiborsiz qoldirildi",
}

var severityLabels = map[string]string{
	SevCritical: "Kritik", SevHigh: "Yuqori", SevMedium: "O'rta", SevLow: "Past",
}

// moduleLabels — modulning odam o'qiydigan nomi (Figma 3.12.2 · C).
//
// Matnlar `apps/web/components/admin/xato.ts` dagi `MODUL` bilan AYNAN bir
// xil bo'lishi shart: AI eksporti serverda yig'iladi, uning demo nusxasi esa
// brauzerda, va ikkisi bitta ekranni chizadi — mos kelmasa backend ulanganda
// ekrandagi matn jimgina o'zgaradi. Xom kalit ("client_app") AI kontekstiga
// ham tushmasligi kerak: nom model uchun ham, odam uchun ham aniqroq.
var moduleLabels = map[string]string{
	ModBackend:   "Backend",
	ModDB:        "Ma'lumotlar bazasi",
	ModExternal:  "Tashqi xizmatlar",
	ModJobs:      "Fon jarayonlari",
	ModAdminApp:  "Admin ilovasi",
	ModClientApp: "Foydalanuvchi ilovasi",
	ModSecurity:  "Xavfsizlik",
}

// StatusLabel — noma'lum qiymat kelsa kodning o'zi qaytadi: yorliq
// yo'qligi yozuvni bo'sh qoldirmasligi kerak.
func StatusLabel(s string) string {
	if v, ok := statusLabels[s]; ok {
		return v
	}
	return s
}

func SeverityLabel(s string) string {
	if v, ok := severityLabels[s]; ok {
		return v
	}
	return s
}

func ModuleLabel(s string) string {
	if v, ok := moduleLabels[s]; ok {
		return v
	}
	return s
}

// BumpSeverity — regressiya darajani bir pog'ona ko'taradi (Figma 3.12.3 · J).
//
// Sabab: bir marta yopilgan, keyin qaytgan xatolik yangisidan xavfliroq —
// u tuzatilgan deb hisoblangan, ya'ni uni hech kim kuzatmayapti. Asl daraja
// guruhda `baseSeverity` bo'lib saqlanadi, shuning uchun ko'tarilish har
// takrorlanishda qayta-qayta bo'lmaydi.
func BumpSeverity(s string) string {
	switch s {
	case SevLow:
		return SevMedium
	case SevMedium:
		return SevHigh
	case SevHigh:
		return SevCritical
	}
	return s
}

// Ish muhiti yorlig'i — ro'yxatdagi "Manba" katagining YUQORI qatori.
// Moduldan farq qiladi: modul "qaysi kod bo'lagi" (filtr uchun), muhit esa
// "qaysi jarayonda yuz berdi" (Figma 3.12 jadvalida: Backend / Admin ilova /
// OTP bot).
const (
	RTBackend   = "Backend"
	RTAdminApp  = "Admin ilova"
	RTClientApp = "Foydalanuvchi ilova"
	RTOTPBot    = "OTP bot"
	RTWeb       = "Veb mijoz"
)

// Origin — hodisani KIM yozdi. Ishonch darajasini belgilaydi: Telegram'ga
// ogohlantirish faqat serverning o'zi yoki admin ilovasi yozgan hodisalar
// uchun ketadi. Oddiy foydalanuvchi yuborgan hodisa panelda ko'rinadi,
// lekin hech qachon tunda kimningdir telefonini jiringlatmaydi.
type Origin uint8

const (
	// OriginServer — shu jarayonning o'zi (middleware, boot tekshiruvlari,
	// xizmat chaqiruvlari).
	OriginServer Origin = iota
	// OriginAdminApp — autentifikatsiyalangan admin ilovasi.
	OriginAdminApp
	// OriginClient — autentifikatsiyalangan oddiy foydalanuvchi (mobil
	// ilova yoki veb). ISHONCHSIZ manba: ogohlantirish yubormaydi.
	OriginClient
)

// Type — katalogdagi bitta xatolik turi.
type Type struct {
	// Module — C1…C7 dan biri (filtr).
	Module string
	// Severity — A bo'limidagi daraja. Faqat shu yerda belgilanadi.
	Severity string
	// Title — ro'yxatda ko'rinadigan o'zbekcha sarlavha.
	Title string
	// Runtime — "Manba" katagining yuqori qatori.
	Runtime string
	// ClientReportable — mijoz (ilova) shu kodni yubora oladimi. Server
	// tomonidagi kodlar uchun false: aks holda tashqaridan "MongoDB
	// o'chdi" degan yolg'on hodisa yasab bo'lardi.
	ClientReportable bool
}

// Catalog — yopiq ro'yxat. Bu yerda yo'q kod HECH QAYERDAN yozilmaydi:
// Record() uni jimgina tashlab yuboradi, ingest endpointi esa 400 qaytaradi.
// Yopiqligi ataylab — ochiq ro'yxat begona matnni to'g'ridan-to'g'ri admin
// ekraniga va Telegram xabariga olib chiqadigan yo'l bo'lardi.
var Catalog = map[string]Type{
	// ── C1 · Backend — so'rovlar va handlerlar (9) ───────────────────────
	"panic":            {ModBackend, SevCritical, "HTTP handler ichida panic", RTBackend, false},
	"internal":         {ModBackend, SevHigh, "Aniqlanmagan server xatosi (500)", RTBackend, false},
	"config_invalid":   {ModBackend, SevCritical, "Ishga tushirish konfiguratsiyasi noto'g'ri", RTBackend, false},
	"invalid_json":     {ModBackend, SevMedium, "So'rov JSON'i o'qib bo'lmadi", RTBackend, false},
	"rate_limited":     {ModBackend, SevMedium, "So'rov limiti oshdi", RTBackend, false},
	"server_timeout":   {ModBackend, SevHigh, "Server javob berish vaqti tugadi", RTBackend, false},
	"encode_failed":    {ModBackend, SevMedium, "Javob yozishda xato (status yuborilgan)", RTBackend, false},
	"export_truncated": {ModBackend, SevHigh, "CSV eksport yarim uzildi, ammo 200 qaytdi", RTBackend, false},
	"bad_id":           {ModBackend, SevLow, "Noto'g'ri ID formati", RTBackend, false},

	// ── C2 · Ma'lumotlar bazasi (6) ──────────────────────────────────────
	"db_unavailable":      {ModDB, SevCritical, "MongoDB javob bermayapti", RTBackend, false},
	"db_connect_failed":   {ModDB, SevCritical, "Ishga tushishda ulanib bo'lmadi", RTBackend, false},
	"index_create_failed": {ModDB, SevHigh, "Indeks yaratilmadi", RTBackend, false},
	"migration_failed":    {ModDB, SevHigh, "Migratsiya bajarilmadi", RTBackend, false},
	"silent_empty_result": {ModDB, SevHigh, "DB xatosi bo'sh ro'yxat sifatida ko'rsatildi", RTBackend, false},
	"write_conflict":      {ModDB, SevMedium, "Yozuvda konflikt / dublikat kalit", RTBackend, false},

	// ── C3 · Tashqi xizmatlar (12) ───────────────────────────────────────
	"moderation_skipped":      {ModExternal, SevCritical, "Gemini limiti tugadi — e'lon tekshirilmay chop etildi", RTBackend, false},
	"fcm_init_failed":         {ModExternal, SevCritical, "Push xizmati ishga tushmadi — butunlay o'chdi", RTBackend, false},
	"telegram_unreachable":    {ModExternal, SevHigh, "Telegram bot javob bermadi", RTBackend, false},
	"moderation_unavailable":  {ModExternal, SevHigh, "Gemini xizmati ishlamayapti", RTBackend, false},
	"moderation_parse_failed": {ModExternal, SevHigh, "Gemini javobini o'qib bo'lmadi", RTBackend, false},
	"fcm_auth_failed":         {ModExternal, SevHigh, "FCM OAuth tokeni olinmadi", RTBackend, false},
	"upload_failed":           {ModExternal, SevHigh, "Fayl saqlashga yuklanmadi", RTBackend, false},
	"fcm_send_failed":         {ModExternal, SevMedium, "Push bildirishnoma yuborilmadi", RTBackend, false},
	"image_fetch_failed":      {ModExternal, SevMedium, "Rasm yuklab olinmadi (moderatsiya uchun)", RTBackend, false},
	"fcm_token_unregistered":  {ModExternal, SevLow, "Qurilma tokeni yaroqsiz", RTBackend, false},
	"geocode_failed":          {ModExternal, SevLow, "Manzilni aniqlab bo'lmadi", RTBackend, false},
	"orphaned_object":         {ModExternal, SevLow, "Egasiz fayllar qoldi", RTBackend, false},

	// ── C4 · Fon jarayonlari va navbatlar (7) ────────────────────────────
	"background_panic":           {ModJobs, SevCritical, "Fon goroutine'da panic — server qulaydi", RTBackend, false},
	"broadcast_dispatch_failed":  {ModJobs, SevHigh, "Tarqatma jo'natish sikli uzildi", RTBackend, false},
	"broadcast_stuck":            {ModJobs, SevHigh, "Tarqatma «yuborilmoqda» holatida qotdi", RTBackend, false},
	"retention_purge_failed":     {ModJobs, SevHigh, "Akkaunt tozalash (retention) bajarilmadi", RTBackend, false},
	"autocomplete_failed":        {ModJobs, SevMedium, "Ariza avtomatik yakunlanmadi", RTBackend, false},
	"notification_insert_failed": {ModJobs, SevMedium, "Bildirishnoma bazaga yozilmadi", RTBackend, false},
	"viewbump_overflow":          {ModJobs, SevLow, "Ko'rishlar navbati to'lib ketdi", RTBackend, false},

	// ── C5 · Admin ilovasi (Flutter) (9) ─────────────────────────────────
	// Hammasi mijozdan keladi — lekin FAQAT admin tokeni bilan
	// (ingest.go: AdminReport). Oddiy foydalanuvchi bu kodlarni yubora olmaydi.
	"flutter.uncaught_exception": {ModAdminApp, SevCritical, "Ushlanmagan xato — ilova yopilib qoldi", RTAdminApp, true},
	"response_cast_failed":       {ModAdminApp, SevCritical, "Javob formati kutilganidan farq qildi", RTAdminApp, true},
	"secure_storage_failed":      {ModAdminApp, SevCritical, "Xavfsiz xotira ochilmadi (Keystore)", RTAdminApp, true},
	"dio.connection_timeout":     {ModAdminApp, SevHigh, "Tarmoq uzildi yoki vaqt tugadi", RTAdminApp, true},
	"token_refresh_failed":       {ModAdminApp, SevHigh, "Sessiya tugadi, token yangilanmadi", RTAdminApp, true},
	"pagination_silent_fail":     {ModAdminApp, SevHigh, "Sahifalash jimgina to'xtadi", RTAdminApp, true},
	"record_dropped":             {ModAdminApp, SevMedium, "Yozuv o'qilmay tashlab ketildi", RTAdminApp, true},
	"route_not_found":            {ModAdminApp, SevMedium, "Marshrut topilmadi — oq ekran", RTAdminApp, true},
	"setstate_after_dispose":     {ModAdminApp, SevMedium, "Ekran yopilgach setState chaqirildi", RTAdminApp, true},

	// ── C6 · Foydalanuvchi ilovasi va veb mijoz (7) ──────────────────────
	// otp_send_failed / slot_race / post_accept_cascade_failed — SERVER
	// tomonida aniqlanadi, shuning uchun mijozdan qabul qilinmaydi: aks
	// holda har kim "OTP yetib bormadi" degan Kritik hodisa yasay olardi.
	"otp_send_failed":            {ModClientApp, SevCritical, "OTP kodi foydalanuvchiga yetib bormadi", RTOTPBot, false},
	"auth_bounce_loop":           {ModClientApp, SevCritical, "Kirish → bosh sahifa → kirish aylanishi", RTClientApp, true},
	"schema_drift":               {ModClientApp, SevHigh, "Eski ilova versiyasi bilan mos kelmadi", RTClientApp, true},
	"slot_race":                  {ModClientApp, SevHigh, "Ish o'rni band bo'lib qoldi (poyga holati)", RTBackend, false},
	"post_accept_cascade_failed": {ModClientApp, SevMedium, "Qabuldan keyingi amallar bajarilmadi", RTBackend, false},
	"web_client_error":           {ModClientApp, SevMedium, "Veb sahifa yuklanmadi (mijoz xatosi)", RTWeb, true},
	"image_load_failed":          {ModClientApp, SevLow, "Rasm ko'rsatilmadi", RTClientApp, true},

	// ── C7 · Autentifikatsiya va xavfsizlik (6) ──────────────────────────
	"jwt_sign_failed":      {ModSecurity, SevCritical, "JWT imzolanmadi (kirish paytida)", RTBackend, false},
	"review_login_enabled": {ModSecurity, SevCritical, "Play tekshiruv kirishi productionda yoqilgan", RTBackend, false},
	"rbac_mismatch":        {ModSecurity, SevMedium, "Rol ruxsati mos kelmadi (403)", RTBackend, false},
	"strike_not_recorded":  {ModSecurity, SevMedium, "Ogohlantirish (strike) yozilmadi", RTBackend, false},
	"bad_token":            {ModSecurity, SevLow, "Token yaroqsiz yoki muddati tugagan", RTBackend, false},
	"biometric_failed":     {ModSecurity, SevLow, "Biometrik qulf ishlamadi", RTAdminApp, true},

	// ── QO'SHIMCHA · shu kodlar bazasidagi jim nosozliklar ───────────────
	//
	// Figma katalogida yo'q, lekin uchtasi ham AYNAN shu loyihada bor va
	// hech qanday ekranda ko'rinmaydi — faqat boot logida bir qator
	// bo'lib o'tadi. "Xatoliklar" sahifasining butun ma'nosi shunday
	// holatlarni ko'rinadigan qilish.
	//
	// insecure_default_secret — production'da seed paroli yoki dev siri
	// o'zgartirilmagan. Bu nosozlik emas, ochiq eshik: hech narsa
	// buzilmaydi, hech kim sezmaydi, panelga esa standart parol bilan
	// kirib bo'ladi.
	"insecure_default_secret": {ModSecurity, SevCritical, "Standart (dev) parol yoki sir production'da qolgan", RTBackend, false},
	// moderation_fail_open — moderatsiya production'da fail-open rejimida.
	// moderation_skipped bitta e'lon haqida; bu esa TURG'UN holat: tashqi
	// xizmat uzilgan har qanday paytda hamma e'lon tekshirilmay o'tadi.
	"moderation_fail_open": {ModSecurity, SevHigh, "Moderatsiya production'da fail-open rejimida", RTBackend, false},
	// storage_unavailable — fayl saqlash umuman sozlanmagan yoki ishga
	// tushmagan. upload_failed bitta fayl haqida; bu — butun kanal yopiq.
	"storage_unavailable": {ModExternal, SevHigh, "Fayl saqlash xizmati sozlanmagan yoki ishga tushmadi", RTBackend, false},
}

// Known — kod katalogda bormi.
func Known(code string) (Type, bool) {
	t, ok := Catalog[code]
	return t, ok
}

// Modules / Severities / Statuses — filtrlarni tekshirish uchun yopiq
// to'plamlar. Tashqaridan kelgan qiymat shu yerda bo'lmasa 400 qaytadi.
var (
	Modules = map[string]bool{
		ModBackend: true, ModDB: true, ModExternal: true, ModJobs: true,
		ModAdminApp: true, ModClientApp: true, ModSecurity: true,
	}
	Severities = map[string]bool{
		SevCritical: true, SevHigh: true, SevMedium: true, SevLow: true,
	}
	Statuses = map[string]bool{
		StatusNew: true, StatusWatching: true, StatusFixing: true,
		StatusResolved: true, StatusRegressed: true, StatusIgnored: true,
	}
)

// SeverityRank — saralash uchun (Kritik eng yuqori). Mongo satrni alifbo
// bo'yicha saralaydi, u esa "critical < high < low < medium" berardi.
var SeverityRank = map[string]int{
	SevCritical: 4, SevHigh: 3, SevMedium: 2, SevLow: 1,
}
