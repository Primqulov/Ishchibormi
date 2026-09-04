package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/errlog"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/tgsend"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// "3.12.3 · L — AI uchun tayyor kontekst" va "Boshqa amallar".
//
// # NEGA MATN SERVERDA YIG'ILADI
//
// Frontendda yig'ish osonroq bo'lardi: ma'lumot allaqachon ekranda. Lekin
// u holda niqoblash BROUZERDA bajarilardi, ya'ni uni DevTools'da o'chirib
// qo'yish yoki API javobidan xom qiymatni ko'chirish mumkin bo'lardi.
// Bu yerda esa niqob matn tug'ilgan joyda qo'yiladi va o'chirib
// bo'lmaydi — `include` ro'yxatida "mask" degan kalit umuman yo'q.
//
// Ikkinchi sabab: eksport AUDIT qilinadi. Xatolik konteksti — diagnostika
// ma'lumotining eng zich to'plami, uni kim va qachon nusxalaganini bilish
// panelning boshqa har qanday o'qish amali kabi muhim.

// Include kalitlari (Figma L · "Nimalar qo'shilsin").
const (
	incStack   = "stack"
	incDevice  = "device"
	incRequest = "request"
	incSteps   = "steps"
	incCode    = "code"
	// incServerLog / incSimilar — dizaynda ham o'chirilgan holatda
	// ko'rsatilgan. Ular so'ralsa xato qaytmaydi: javobning
	// `unavailable` maydonida qaytadi va panel ularni kulrang qiladi.
	incServerLog = "serverlog"
	incSimilar   = "similar"
)

var incAvailable = map[string]bool{
	incStack: true, incDevice: true, incRequest: true, incSteps: true, incCode: true,
}

var incUnavailable = map[string]bool{
	incServerLog: true, incSimilar: true,
}

// incDefault — hech narsa so'ralmasa (Figma L da belgilangan beshtasi).
var incDefault = []string{incStack, incDevice, incRequest, incSteps, incCode}

// exportFormats — yopiq ro'yxat. `format` tashqi qiymat, u fayl nomiga va
// Content-Type ga ta'sir qiladi.
var exportFormats = map[string]bool{"md": true, "json": true, "txt": true}

// ── Niqoblash ───────────────────────────────────────────────────────────
//
// Bazada IP ham, to'liq telefon ham saqlanmaydi (errlog ataylab yig'maydi).
// Lekin `message` va `stack` TASHQI matn: ular ichida tasodifan telefon,
// token yoki OTP kodi bo'lib qolishi mumkin. Shuning uchun eksport matni
// yana bir marta filtrdan o'tadi. Filtr ehtiyotkor tomonga xato qiladi:
// shubhali narsani niqoblab, o'qilishini biroz yo'qotgani ma'qul.
var (
	// JWT — uchta base64url bo'lak. `eyJ` — `{"` ning kodlangan boshi.
	jwtRe    = regexp.MustCompile(`eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(\.[A-Za-z0-9_-]+)?`)
	bearerRe = regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}`)
	ipv4Re   = regexp.MustCompile(`\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b`)
	uzPhone  = regexp.MustCompile(`\+?998[\s\-]?\(?\d{2}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}`)
	longNum  = regexp.MustCompile(`\b\d{9,}\b`)
	// Kalit=qiymat juftlari. `code` ataylab yo'q: javob tanasidagi
	// {"code":"internal"} diagnostika uchun kerak va sir emas.
	secretKV = regexp.MustCompile(`(?i)\b(password|passwd|pwd|token|access_token|refresh|refresh_token|secret|apikey|api_key|authorization|otp|otp_code|totp)\b"?\s*[:=]\s*"?[^\s",;})\]]+`)
)

const maskMark = "‹niqoblangan›"

// maskSecrets — eksportga tushadigan HAR QANDAY matn shu yerdan o'tadi.
// Tartib muhim: avval eng aniq shakllar (JWT, bearer, kalit=qiymat),
// keyin umumiy raqamli shakllar. Aks holda umumiy qoida token ichidagi
// raqamlarni buzib, aniq qoidalar hech narsani topa olmasdi.
func maskSecrets(s string) string {
	if s == "" {
		return ""
	}
	s = jwtRe.ReplaceAllString(s, maskMark)
	s = bearerRe.ReplaceAllString(s, "Bearer "+maskMark)
	s = secretKV.ReplaceAllString(s, "${1}: "+maskMark)
	s = uzPhone.ReplaceAllString(s, "+998 •• ••• •• ••")
	s = ipv4Re.ReplaceAllString(s, "${1}.${2}.•••.•••")
	s = longNum.ReplaceAllString(s, "•••")
	return s
}

func maskAll(in []string) []string {
	if in == nil {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, v := range in {
		out = append(out, maskSecrets(v))
	}
	return out
}

// ── Kontekst tuzilishi ──────────────────────────────────────────────────

type ctxSection struct {
	Title string   `json:"title"`
	Lines []string `json:"lines"`
}

type aiContext struct {
	Head     string       `json:"head"`
	Subtitle []string     `json:"subtitle"`
	Sections []ctxSection `json:"sections"`
}

// GetErrorContext: GET /admin/errors/{id}/context?format=md&include=…
func (h *Handler) GetErrorContext(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	g, err := h.errGroup(ctx, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "" {
		format = "md"
	}
	if !exportFormats[format] {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_format", "invalid format"))
		return
	}
	inc, unavail, err := parseInclude(r.URL.Query().Get("include"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if !exportLimiter.allow(httpx.AdminID(r)) {
		httpx.Err(w, httpx.NewError(http.StatusTooManyRequests, "rate_limited",
			"juda tez-tez eksport qilinmoqda, bir daqiqadan keyin urinib ko'ring"))
		return
	}

	ac := h.buildContext(ctx, g, inc)
	text := renderContext(ac, format)

	// Audit: nimalar qo'shilgani ham yoziladi — keyinchalik "kim qanday
	// hajmdagi kontekstni olgan" savoliga javob bo'ladi.
	h.audit(r, "error_export", g.ID.Hex(), g.Ref+" · "+format+" · "+strings.Join(inc, ","))

	httpx.JSON(w, http.StatusOK, map[string]any{
		"format":      format,
		"text":        text,
		"chars":       len([]rune(text)),
		"tokens":      (len([]rune(text)) + 3) / 4,
		"masked":      true,
		"include":     inc,
		"unavailable": unavail,
		"filename":    g.Ref + "-" + g.Code + "." + format,
	})
}

// parseInclude — `include` ro'yxatini yopiq to'plamga solishtiradi.
// Noma'lum kalit 400 qaytaradi (jimgina tashlab yuborilmaydi): admin
// nimani so'raganini bilmasa, nima olganini ham bilmaydi.
func parseInclude(raw string) (inc, unavail []string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return append([]string{}, incDefault...), []string{}, nil
	}
	if len(raw) > 200 {
		return nil, nil, httpx.NewError(http.StatusBadRequest, "bad_include", "include too long")
	}
	seen := map[string]bool{}
	inc, unavail = []string{}, []string{}
	for _, p := range strings.Split(raw, ",") {
		k := strings.ToLower(strings.TrimSpace(p))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		switch {
		case incAvailable[k]:
			inc = append(inc, k)
		case incUnavailable[k]:
			unavail = append(unavail, k)
		default:
			return nil, nil, httpx.NewError(http.StatusBadRequest, "bad_include", "unknown include key: "+k)
		}
	}
	return inc, unavail, nil
}

// buildContext — guruh + eng boy namuna asosida kontekst.
func (h *Handler) buildContext(ctx context.Context, g *models.ErrorGroup, inc []string) aiContext {
	on := map[string]bool{}
	for _, k := range inc {
		on[k] = true
	}
	var s *models.ErrorSample
	if list := h.errSamples(ctx, g.Fingerprint, 1); len(list) > 0 {
		s = &list[0]
	}

	ac := aiContext{
		Head: "Xatolik: " + g.Code + " (" + g.Ref + ")",
	}
	sub := "Muhimlik: " + errlog.SeverityLabel(g.Severity) + " · Holat: " + errlog.StatusLabel(g.Status)
	if g.Assignee != "" {
		sub += " · Mas'ul: " + g.Assignee
	}
	ac.Subtitle = append(ac.Subtitle, sub)
	ac.Subtitle = append(ac.Subtitle, "Birinchi: "+fmtTime(g.FirstSeenAt)+" · Oxirgi: "+fmtTime(g.LastSeenAt)+
		" · "+strconv.FormatInt(g.Count, 10)+" hodisa / "+strconv.FormatInt(g.UsersCount, 10)+" foydalanuvchi")
	if g.Title != "" {
		ac.Subtitle = append(ac.Subtitle, "Sarlavha: "+maskSecrets(g.Title))
	}
	if g.Runtime != "" || g.Module != "" {
		ac.Subtitle = append(ac.Subtitle, "Manba: "+join(" · ", g.Runtime, errlog.ModuleLabel(g.Module)))
	}

	if on[incDevice] {
		ac.Sections = append(ac.Sections, ctxSection{Title: "Muhit", Lines: h.deviceLines(g, s)})
	}
	if on[incStack] {
		lines := []string{}
		msg := maskSecrets(firstText(g.Message, sampleMsg(s)))
		if msg != "" {
			lines = append(lines, msg)
		}
		if s != nil && len(s.Stack) > 0 {
			lines = append(lines, maskAll(s.Stack)...)
		}
		if len(lines) == 0 {
			lines = append(lines, unknownVal)
		}
		ac.Sections = append(ac.Sections, ctxSection{Title: "Xato matni va stack trace", Lines: lines})
	}
	if on[incCode] {
		ac.Sections = append(ac.Sections, ctxSection{Title: codeTitle(g, s), Lines: codeLines(g, s)})
	}
	if on[incRequest] {
		ac.Sections = append(ac.Sections, ctxSection{Title: "So'rov", Lines: requestLines(g, s)})
	}
	if on[incSteps] {
		lines := []string{}
		if s != nil {
			for _, st := range s.Steps {
				lines = append(lines, st.At.Local().Format("15:04:05")+" "+stepKindLabel(st.Kind)+" "+maskSecrets(st.Text))
			}
		}
		if len(lines) == 0 {
			lines = append(lines, "qadamlar yozib olinmagan (mijoz breadcrumb yubormagan)")
		}
		ac.Sections = append(ac.Sections, ctxSection{Title: "Xatolikdan oldingi qadamlar", Lines: lines})
	}

	// Oxirgi ikki bo'lim har doim bor: AI'ga nima so'ralayotganini aytmasak,
	// u kontekstni shunchaki qayta hikoya qilib berardi.
	ac.Sections = append(ac.Sections, ctxSection{Title: "Kutilgan xulq", Lines: []string{
		"So'rov muvaffaqiyatli bajarilishi yoki xato foydalanuvchiga tushunarli xabar bilan qaytishi kerak edi; ilova ishdan chiqmasligi kerak.",
	}})
	ac.Sections = append(ac.Sections, ctxSection{Title: "Savol", Lines: []string{
		"Shu xatolikning sababi nimada va uni qanday tuzatish kerak? Tuzatishni qaysi faylning qaysi qatorida qilish kerakligini ko'rsat.",
	}})
	return ac
}

const unknownVal = "aniqlanmagan"

// val — bo'sh maydon HECH QACHON bo'sh chiqmaydi (Figma 3.12.3 · izoh
// 432:269): "aniqlanmagan" — bu ma'lumot, bo'sh katak esa xato taassuroti.
func val(v string) string {
	if strings.TrimSpace(v) == "" {
		return unknownVal
	}
	return v
}

// join — bo'sh bo'laklarni TASHLAB qo'shadi.
//
// NEGA `strings.TrimSpace(a + sep + b)` yaramaydi: TrimSpace faqat probelni
// oladi, ajratgichning o'zi qolib ketadi. Natijada eksportda "Brauzer: Dart 3 ·"
// yoki bundan yomoni "Brauzer: ·" chiqadi — ikkinchisida `val()` ham aldanadi,
// chunki satr bo'sh emas va "aniqlanmagan" o'rniga yolg'iz ajratgich ko'rinadi.
// Frontenddagi demo nusxasi (`xatoDemo.ts` · `birik`) aynan shu mantiqni
// ishlatadi, shuning uchun ikki tomon bir xil matn beradi.
func join(sep string, parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}

func firstText(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func sampleMsg(s *models.ErrorSample) string {
	if s == nil {
		return ""
	}
	return s.Message
}

func (h *Handler) deviceLines(g *models.ErrorGroup, s *models.ErrorSample) []string {
	d := models.ErrorDevice{}
	if s != nil {
		d = s.Device
	}
	// Qurilma va OS BITTA qatorda (Figma L: "Qurilma: Xiaomi Redmi Note 12
	// (2201117TG) · Android 14 (API 34)").
	//
	// NEGA qo'shib yuboriladi: `deviceWithCode` errlog.DeviceLabel ustiga
	// quriladi, DeviceLabel esa yorliqning ichiga OS ni ALLAQACHON qo'shadi
	// ("nom · OS versiya"). Uning ortidan yana "OS: …" qatorini yozsak, AI ga
	// bir xil ma'lumot ikki marta boradi va eksport ostida ko'rsatiladigan
	// belgi/token sanog'i behuda oshadi.
	//
	// NEGA tekshiruv yorliqning MAZMUNIDA, DeviceLabel qaysi tarmoqni
	// tanlaganini taxmin qilishda emas: yorliq boshqa paketda yig'iladi va
	// uning ichki shartlari o'zgarishi mumkin. Takrorni matnning o'zidan
	// izlaganimizda qoida buzilmaydi — "OS:" qatori FAQAT rostdan ham takror
	// bo'lganda tushib qoladi, boshqa hech bir holatda yo'qolmaydi.
	//
	// DIQQAT: brauzer hodisasi ham takror hisoblanadi — DeviceLabel brauzer
	// nomini yorliq boshiga qo'yib ortiga OS ni qo'shadi ("Chrome 128 ·
	// Windows 11"), ya'ni o'sha yerda ham alohida "OS:" qatori chiqmaydi.
	// Qator faqat OS yorliqqa TUSHMAGAN holatlarda qoladi: OS bor-u qurilma
	// nomi yo'q, yoki OS umuman noma'lum.
	osText := strings.TrimSpace(d.OS + " " + d.OSVersion)
	api := bracket(apiLabel(d.APILevel))
	device := deviceWithCode(d)
	lines := []string{
		"Ilova: " + val(strings.TrimSpace(d.AppVersion+" "+bracket(d.Build))),
	}
	if osText != "" && strings.Contains(device, osText) {
		lines = append(lines, "Qurilma: "+strings.TrimSpace(device+" "+api))
	} else {
		lines = append(lines,
			"Qurilma: "+val(device),
			"OS: "+val(strings.TrimSpace(osText+" "+api)),
		)
	}
	if d.Browser != "" || d.Platform == "web" {
		lines = append(lines, "Brauzer: "+val(join(" · ", d.Browser, d.Engine)))
	}
	if d.Flutter != "" || d.Dart != "" {
		lines = append(lines, "Flutter/Dart: "+val(join(" / ", d.Flutter, d.Dart)))
	}
	// Ekran va RAM bitta qatorda (Figma L: "Ekran: 1080x2400 @2.75x ·
	// RAM 5.6/8.0 GB"): ikkisi ham "qurilma qanchalik kuchsiz" degan bitta
	// savolga javob beradi va OOM yoki rasm hajmi bilan bog'liq xatolikda
	// faqat yonma-yon turganda ma'no chiqaradi.
	ekran := "Ekran: " + val(d.Screen)
	if v := strings.TrimSpace(d.RAM); v != "" {
		ekran += " · RAM " + v
	}
	lines = append(lines, ekran)
	// Quyidagi maydonlar SHARTLI. Ular faqat mijoz X-Client-Device
	// sarlavhasida yuborganda ma'lum bo'ladi (errlog/device.go), ya'ni
	// hozircha ko'pincha bo'sh. Bo'sh qiymatni "aniqlanmagan" deb yozish
	// kontekstni uzaytirardi, AI'ga esa hech narsa bermasdi — shu sababli
	// bu yerda `val()` emas, qatorning O'ZI tashlab yuboriladi.
	if v := strings.TrimSpace(d.Storage); v != "" {
		lines = append(lines, "Xotira: "+v)
	}
	lines = append(lines,
		"Tarmoq: "+val(d.Network),
		"Til: "+val(d.Locale),
	)
	if v := strings.TrimSpace(d.Battery); v != "" {
		lines = append(lines, "Batareya: "+v)
	}
	if v := strings.TrimSpace(d.Emulator); v != "" {
		lines = append(lines, emulatorLabel(d.Platform)+": "+v)
	}
	if v := strings.TrimSpace(d.Orientation); v != "" {
		lines = append(lines, "Orientatsiya: "+v)
	}
	// Server qatori (Figma L): host · muhit · backend build. Host birinchi
	// turadi, chunki bir necha nusxa ishlaganda "xatolik hammasidami yoki
	// bittasidami" savoliga faqat mashina nomi javob beradi; APP_ENV va
	// build esa "qaysi kod ishlagan" savolini yopadi.
	lines = append(lines,
		"Server: "+val(serverHost())+" · APP_ENV="+val(h.Cfg.AppEnv)+" · backend build: "+val(buildVersion),
	)
	if g.PlannedVersion != "" {
		lines = append(lines, "Rejalashtirilgan tuzatish versiyasi: "+g.PlannedVersion)
	}
	if g.FixedVersion != "" {
		lines = append(lines, "Avval tuzatilgan versiya: "+g.FixedVersion)
	}
	return lines
}

func bracket(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	return "(" + v + ")"
}

func apiLabel(v string) string {
	if strings.TrimSpace(v) == "" {
		return ""
	}
	return "API " + v
}

// deviceWithCode — DeviceLabel yorlig'iga model KODINI qo'shadi
// (Figma L: "Qurilma: Xiaomi Redmi Note 12 (2201117TG) · Android 14").
//
// NEGA kod kerak: "Redmi Note 12" bir nechta apparat variantida (2201117TG,
// 22111317I …) chiqadi va xatolik ko'pincha aynan bittasida takrorlanadi —
// qidiruvda ham, do'kon statistikasida ham izlanadigan kalit shu kod.
//
// Kod nom bo'lagidan KEYIN, OS'dan oldin turishi kerak, shu sababli tayyor
// yorliqning oxiriga qo'shilmaydi: nom bo'lagi qayta yig'iladi va qavs
// aynan uning ortiga qo'yiladi. Nom umuman bo'lmasa (brauzer yoki faqat
// platforma ma'lum bo'lgan hodisa) kod oxirida qoladi — u holda uni
// bog'lash uchun boshqa joy yo'q.
func deviceWithCode(d models.ErrorDevice) string {
	label := errlog.DeviceLabel(d)
	code := bracket(strings.TrimSpace(d.ModelCode))
	if label == "" || code == "" {
		return label
	}
	name := strings.TrimSpace(d.Brand + " " + d.Model)
	if name != "" && strings.HasPrefix(label, name) {
		return name + " " + code + label[len(name):]
	}
	return label + " " + code
}

// emulatorLabel — bitta maydon, ikki xil sarlavha (Figma H): Android'da
// "Emulyator · Root", iOS'da "Simulyator · Jailbreak".
//
// Modelda ular birlashtirilgan, chunki mijoz tayyor satr yuboradi
// ("yo'q · yo'q") — lekin sarlavha platformaga mos bo'lmasa, iOS hodisasida
// "Root" so'zi kontekstni o'qiyotgan odamni ham, AI'ni ham chalg'itadi.
func emulatorLabel(platform string) string {
	if strings.ToLower(strings.TrimSpace(platform)) == "ios" {
		return "Simulyator · Jailbreak"
	}
	return "Emulyator · Root"
}

// codeLines — kod FRAGMENTI emas, MANZILI.
//
// Serverda ilova manba kodi yo'q (binar `-ldflags` bilan yig'iladi), shu
// sababli haqiqiy qatorlarni o'qib bo'lmaydi — o'qish mumkin bo'lganda
// ham bu xavfli bo'lardi: HTTP endpoint orqali fayl mazmunini berish
// yo'lni almashtirish hujumiga eshik ochardi. Shuning uchun bu bo'lim
// stekdan olingan fayl:qator manzillarini beradi; ularni AI'ga topshirgan
// odam kerakli fragmentni o'zi qo'shadi.
func codeLines(g *models.ErrorGroup, s *models.ErrorSample) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		out = append(out, v)
	}
	add(g.Where)
	if s != nil {
		for _, ln := range s.Stack {
			if len(out) >= 4 {
				break
			}
			add(codeRefOf(ln))
		}
	}
	if len(out) == 0 {
		return []string{unknownVal}
	}
	out = append(out, "(fayl mazmuni serverda saqlanmaydi — yuqoridagi manzillarni repozitoriydan oching)")
	return out
}

// codeRef — "#0 ApiClient.get · lib/core/api_client.dart:292:24" dan
// "lib/core/api_client.dart:292" ni ajratadi.
var codeRef = regexp.MustCompile(`[\w./\\-]+\.(dart|go|ts|tsx|js|jsx|kt|swift):\d+`)

func codeRefOf(line string) string {
	return codeRef.FindString(line)
}

// codeCtxLines — sarlavhadagi diapazonning yarim kengligi. Figma L
// namunasidagi oyna yetti qator ("api_client.dart:288-294", xato qatori
// 292), lekin u qo'lda tanlangani uchun nosimmetrik. Biz uni xato
// qatoridan ±3 qilib yig'amiz: kengligi bir xil, o'rni esa taxminga
// bog'liq emas.
const codeCtxLines = 3

// codeTitle — "Tegishli kod (api_client.dart:288-294)" (Figma L).
//
// NEGA sarlavhada diapazon: AI'ga bitta qator emas, uning ATROFI kerak —
// o'zgaruvchi yuqorida e'lon qilinadi, tekshiruv esa pastda bo'ladi. Aniq
// diapazon so'rov o'rnini bosadi: kontekstni tashlagan odam "qaysi joyni
// ko'chirsam bo'ladi" degan savolga javob izlamaydi.
//
// Fayl nomi qisqartiriladi (faqat oxirgi bo'lak): to'liq yo'l sarlavhani
// ikki qatorga bo'lib tashlaydi, qatorlar esa bo'limning O'ZIDA to'liq
// yo'l bilan turadi (codeLines).
//
// Manzil topilmasa sarlavha o'zgarishsiz qoladi: taxminiy diapazon
// yozgandan ko'ra hech narsa yozmaslik to'g'ri.
func codeTitle(g *models.ErrorGroup, s *models.ErrorSample) string {
	const base = "Tegishli kod"
	ref := codeRefOf(g.Where)
	if ref == "" && s != nil {
		// Stekning BIRINCHI kadri — xato tug'ilgan joy; keyingilari
		// chaqiruvchilar, ular uchun diapazon ko'rsatish chalg'itardi.
		for _, ln := range s.Stack {
			if ref = codeRefOf(ln); ref != "" {
				break
			}
		}
	}
	i := strings.LastIndex(ref, ":")
	if i < 0 {
		return base
	}
	n, err := strconv.Atoi(ref[i+1:])
	if err != nil || n <= 0 {
		return base
	}
	from := n - codeCtxLines
	if from < 1 {
		from = 1
	}
	file := ref[:i]
	if j := strings.LastIndexAny(file, `/\`); j >= 0 {
		file = file[j+1:]
	}
	if file == "" {
		return base
	}
	return base + " (" + file + ":" + strconv.Itoa(from) + "-" + strconv.Itoa(n+codeCtxLines) + ")"
}

func requestLines(g *models.ErrorGroup, s *models.ErrorSample) []string {
	method, path, status, dur, rid := "", val(g.Path), "", "", ""
	if s != nil {
		method = s.Method
		if s.Path != "" {
			path = s.Path
		}
		if s.Status > 0 {
			status = strconv.Itoa(s.Status)
		}
		if s.DurationMs > 0 {
			dur = strconv.Itoa(s.DurationMs) + " ms"
		}
		rid = s.RequestID
	}
	head := strings.TrimSpace(method + " " + path)
	if status != "" {
		head += " → " + status
	}
	if dur != "" {
		head += " · " + dur
	}
	return []string{
		val(head),
		"request_id: " + val(rid),
		"guruh ID: " + g.Ref + " · fingerprint: " + shortFp(g.Fingerprint),
		"IP va to'liq telefon yig'ilmaydi (jurnalda ham yo'q)",
	}
}

func shortFp(fp string) string {
	if len(fp) > 12 {
		return fp[:12]
	}
	return fp
}

func stepKindLabel(k string) string {
	switch k {
	case "nav":
		return "navigatsiya"
	case "screen":
		return "ekran"
	case "action":
		return "amal"
	case "request":
		return "so'rov"
	case "response":
		return "javob"
	case "crash":
		return "CRASH"
	}
	return k
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return unknownVal
	}
	return t.Local().Format("02.01.2006 15:04")
}

// renderContext — bir xil ma'lumot, uch xil qobiq.
func renderContext(ac aiContext, format string) string {
	if format == "json" {
		b, err := json.MarshalIndent(ac, "", "  ")
		if err != nil {
			return "{}"
		}
		return string(b)
	}
	md := format == "md"
	var b strings.Builder
	if md {
		b.WriteString("# " + ac.Head + "\n")
	} else {
		b.WriteString(strings.ToUpper(ac.Head) + "\n")
	}
	for _, l := range ac.Subtitle {
		b.WriteString(l + "\n")
	}
	for _, s := range ac.Sections {
		b.WriteString("\n")
		if md {
			b.WriteString("## " + s.Title + "\n")
		} else {
			b.WriteString(strings.ToUpper(s.Title) + "\n")
		}
		for _, l := range s.Lines {
			b.WriteString(l + "\n")
		}
	}
	return b.String()
}

// ── Eksport chastotasi ──────────────────────────────────────────────────

// exportLimiter — admin boshiga eksport chastotasi. Kontekst har chaqiruvda
// bazadan namuna o'qiydi va matn yig'adi; bundan tashqari u eng zich
// diagnostika ma'lumoti — uni skript bilan ketma-ket so'rab, butun
// jurnalni tashqariga ko'chirib olish yo'li bo'lmasligi kerak.
var exportLimiter = &rateBucket{limit: 20, window: 5 * time.Minute, hits: map[string][]time.Time{}}

type rateBucket struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func (b *rateBucket) allow(key string) bool {
	if key == "" {
		return true
	}
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	// Xotira o'smasligi uchun: kalitlar juda ko'payib ketsa, eskirganlarini
	// butunlay tashlaymiz. Adminlar soni cheklangan, shu sababli bu
	// chegaraga faqat nosozlikda yetiladi.
	if len(b.hits) > 5000 {
		for k, v := range b.hits {
			if len(v) == 0 || now.Sub(v[len(v)-1]) > b.window {
				delete(b.hits, k)
			}
		}
	}
	keep := b.hits[key][:0]
	for _, t := range b.hits[key] {
		if now.Sub(t) < b.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= b.limit {
		b.hits[key] = keep
		return false
	}
	b.hits[key] = append(keep, now)
	return true
}

// ── Telegram ────────────────────────────────────────────────────────────

type errTgReq struct {
	// Context — true bo'lsa AI konteksti yuboriladi, aks holda qisqa
	// ogohlantirish (sarlavha tugmasi).
	Context bool     `json:"context"`
	Include []string `json:"include"`
}

// tgCooldown — qo'lda yuborishlar orasidagi eng kichik oraliq. Avtomatik
// ogohlantirishning o'z throttle'i bor (errlog/recorder.go); bu — tugmani
// ketma-ket bosishdan himoya, ya'ni kanal spamga aylanmasligi uchun.
const tgCooldown = 60 * time.Second

// PostErrorTelegram: POST /admin/errors/{id}/telegram.
func (h *Handler) PostErrorTelegram(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	g, err := h.errGroup(ctx, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if !h.TG.Configured() || h.AlertChatID == 0 {
		httpx.Err(w, httpx.NewError(http.StatusServiceUnavailable, "tg_not_configured",
			"Telegram ogohlantirishlari sozlanmagan (TELEGRAM_BOT_TOKEN / ERROR_ALERT_CHAT_ID)"))
		return
	}
	now := time.Now()
	if g.TgSentAt != nil && now.Sub(*g.TgSentAt) < tgCooldown {
		left := int(tgCooldown.Seconds() - now.Sub(*g.TgSentAt).Seconds())
		if left < 1 {
			left = 1
		}
		httpx.Err(w, httpx.NewErrorWithDetails(http.StatusTooManyRequests, "cooldown",
			"bu xatolik hozir yuborilgan, "+strconv.Itoa(left)+" soniyadan keyin urinib ko'ring",
			map[string]any{"retryAfter": left}))
		return
	}
	var in errTgReq
	if r.ContentLength > 0 {
		if err := httpx.Decode(r, &in); err != nil {
			httpx.Err(w, err)
			return
		}
	}

	actor := h.adminLabel(ctx, httpx.AdminID(r))
	html := tgMessage(g, actor)
	if in.Context {
		inc, _, perr := parseInclude(strings.Join(in.Include, ","))
		if perr != nil {
			httpx.Err(w, perr)
			return
		}
		if !exportLimiter.allow(httpx.AdminID(r)) {
			httpx.Err(w, httpx.NewError(http.StatusTooManyRequests, "rate_limited",
				"juda tez-tez eksport qilinmoqda"))
			return
		}
		text := renderContext(h.buildContext(ctx, g, inc), "txt")
		// Telegram xabari 4096 belgidan uzun bo'lolmaydi; qisqartirish
		// jimgina emas, ko'rinadigan qilib bajariladi.
		const tgCap = 3400
		if len([]rune(text)) > tgCap {
			text = string([]rune(text)[:tgCap]) + "\n… (qisqartirildi — to'lig'i panelda)"
		}
		html += "\n<pre>" + tgsend.EscapeHTML(text) + "</pre>"
		h.audit(r, "error_export", g.ID.Hex(), g.Ref+" · telegram · "+strings.Join(inc, ","))
	}

	if err := h.TG.SendHTML(ctx, h.AlertChatID, html); err != nil {
		httpx.Err(w, httpx.NewError(http.StatusBadGateway, "tg_failed", "Telegram'ga yuborilmadi"))
		return
	}

	line := "Telegram'ga yuborildi"
	if in.Context {
		line += " — AI konteksti bilan"
	}
	var out models.ErrorGroup
	uerr := h.ErrGroups.FindOneAndUpdate(ctx, bson.M{"_id": g.ID},
		bson.M{
			"$set": bson.M{"tgSentAt": now},
			"$push": bson.M{"activity": bson.M{
				"$each":  bson.A{models.ErrorActivity{Kind: "telegram", Text: line, Actor: actor, At: now}},
				"$slice": -errlog.MaxActivity,
			}},
		},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&out)
	if uerr != nil && uerr != mongo.ErrNoDocuments {
		httpx.Err(w, uerr)
		return
	}
	h.audit(r, "error_telegram", g.ID.Hex(), g.Ref+" · "+g.Code)
	httpx.JSON(w, http.StatusOK, out)
}

// tgMessage — qisqa ogohlantirish. Format avtomatik xabarga yaqin
// (errlog/recorder.go · maybeAlert), lekin "kim yubordi" qatori bilan:
// kanalda qo'lda yuborilgan xabar avtomatikdan ajralib turishi kerak.
func tgMessage(g *models.ErrorGroup, actor string) string {
	e := tgsend.EscapeHTML
	var b strings.Builder
	b.WriteString("<b>🔔 " + e(errlog.SeverityLabel(g.Severity)) + " · " + e(g.Ref) + "</b>\n")
	b.WriteString("<b>" + e(g.Title) + "</b>\n")
	b.WriteString("<code>" + e(g.Code) + "</code>\n")
	if g.Where != "" {
		b.WriteString("Joy: " + e(g.Where) + "\n")
	}
	b.WriteString("Holat: " + e(errlog.StatusLabel(g.Status)) + "\n")
	b.WriteString("Hodisa: " + strconv.FormatInt(g.Count, 10) +
		" · foydalanuvchi: " + strconv.FormatInt(g.UsersCount, 10) + "\n")
	b.WriteString("Oxirgi: " + e(fmtTime(g.LastSeenAt)) + "\n")
	if g.Assignee != "" {
		b.WriteString("Mas'ul: " + e(g.Assignee) + "\n")
	}
	if msg := maskSecrets(g.Message); msg != "" {
		b.WriteString("\n<i>" + e(errlog.Clip(msg, 300)) + "</i>\n")
	}
	if actor != "" {
		b.WriteString("\nYubordi: " + e(actor))
	}
	return b.String()
}
