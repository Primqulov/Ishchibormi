// Package moderation — e'lon matni va rasmini chop etishdan oldin Google
// Gemini orqali tekshiradi.
//
// Qatlamlar ajratilgan (loyihadagi boshqa domenlar kabi):
//   - pkg/gemini — transport (HTTP so'rov/javob), biznes qarori yo'q;
//   - bu fayl   — siyosat: qaysi kategoriya va qaysi darajadan e'lon rad
//     etiladi;
//   - handler.go — REST sirt.
//
// Xizmat "sozlanmagan" holatda ham to'liq ishlaydi: GEMINI_API_KEY bo'sh
// bo'lsa Enabled() false qaytaradi va backend hech qanday tashqi chaqiruv
// qilmaydi. Bu loyihadagi S3/FCM bilan bir xil naqsh — ixtiyoriy tashqi
// xizmat yo'qligi API'ni ishdan chiqarmaydi.
package moderation

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/ishchibormi/backend/pkg/gemini"
)

// Classifier — kontentni xavf kategoriyalari bo'yicha baholaydigan tashqi
// xizmat. pkg/gemini.Client shu interfeysni qanoatlantiradi.
//
// Interfeys ataylab shu yerda (iste'molchi tomonida) e'lon qilingan:
// testlar tarmoqqa umuman chiqmasdan o'z mock'ini bera oladi.
type Classifier interface {
	Configured() bool
	Model() string
	Classify(ctx context.Context, in gemini.Input) (*gemini.Verdict, error)
}

// BlockThreshold — shu darajadan boshlab kontent rad etiladi.
//
// MEDIUM tanlandi — bu Google'ning o'z standarti (BLOCK_MEDIUM_AND_ABOVE).
// LOW da bloklash ish e'lonlarida noto'g'ri ishlagan bo'lardi: "massaj
// ustasi kerak" yoki "qo'riqchi kerak" kabi mutlaqo normal e'lonlar LOW
// baho olishi mumkin.
const BlockThreshold = gemini.ProbMedium

// BlockingCategories — e'lonni rad etadigan kategoriyalar.
//
// Bular Gemini API'ning RASMIY HarmCategory enum nomlari (pkg/gemini.
// Categories) — o'ylab topilgan nom yo'q. Ish e'lonlari taxtasida
// to'rttasining ham o'rni yo'q, shuning uchun hammasi bloklaydi.
var BlockingCategories = gemini.Categories

var blocking = func() map[string]bool {
	m := make(map[string]bool, len(BlockingCategories))
	for _, c := range BlockingCategories {
		m[c] = true
	}
	return m
}()

// Result — bitta kirish (matn yoki rasm) uchun xulosa. JSON javobda ham shu
// struktura ishlatiladi.
type Result struct {
	// Allowed — bizning qarorimiz: bloklovchi kategoriyalardan birortasi
	// BlockThreshold dan past emas bo'lsa false.
	Allowed bool `json:"allowed"`
	// Flagged — kontent umuman belgilanganmi (Allowed'ning teskarisi emas:
	// Gemini kirishni o'zi bloklagan holatda ham true bo'ladi).
	Flagged bool `json:"flagged"`
	// Categories — chegaradan oshgan kategoriyalar: nom -> true. Faqat
	// oshganlari qaytariladi.
	Categories map[string]bool `json:"categories"`
	// Levels — HAR BIR kategoriyaning bahosi (NEGLIGIBLE|LOW|MEDIUM|HIGH).
	// Chegarani sozlash va nima uchun o'tgan/o'tmaganini ko'rish uchun.
	Levels map[string]string `json:"levels"`
	// BlockReason — Gemini kirishning o'zini bloklagan bo'lsa uning sababi
	// (IMAGE_SAFETY, PROHIBITED_CONTENT, SAFETY, ...). Odatda bo'sh.
	BlockReason string `json:"blockReason,omitempty"`
	// Reason — foydalanuvchiga ko'rsatish uchun qisqa sabab (o'zbekcha).
	// Ruxsat berilganda bo'sh.
	Reason string `json:"reason,omitempty"`
}

// CheckResult — bitta e'lon (matn + ixtiyoriy rasm) uchun umumiy xulosa.
type CheckResult struct {
	// Allowed — matn ham, rasm ham ruxsat etilgan bo'lsa true.
	Allowed bool    `json:"allowed"`
	Model   string  `json:"model"`
	Text    *Result `json:"text,omitempty"`
	Image   *Result `json:"image,omitempty"`
}

// Service — moderatsiya siyosati.
type Service struct {
	client Classifier
}

// New xizmat quradi. client nil yoki kalitsiz bo'lsa xizmat o'chiq qoladi.
func New(client Classifier) *Service { return &Service{client: client} }

// ErrDisabled — moderatsiya sozlanmagan (GEMINI_API_KEY yo'q).
var ErrDisabled = errors.New("moderation: disabled (GEMINI_API_KEY not set)")

// Enabled — moderatsiya ishlayaptimi.
func (s *Service) Enabled() bool {
	return s != nil && s.client != nil && s.client.Configured()
}

// Model — ishlatilayotgan model nomi (javoblarda ko'rsatiladi).
func (s *Service) Model() string {
	if s == nil || s.client == nil {
		return ""
	}
	return s.client.Model()
}

// CheckText matnni tekshiradi. Bo'sh matn tashqi chaqiruvsiz ruxsat etiladi.
func (s *Service) CheckText(ctx context.Context, text string) (*Result, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	if strings.TrimSpace(text) == "" {
		return allowedResult(), nil
	}
	v, err := s.client.Classify(ctx, gemini.Input{Text: text})
	if err != nil {
		return nil, err
	}
	return decide(v), nil
}

// CheckImage rasm baytlarini tekshiradi. Baytlar so'rov ichida inline
// yuboriladi — rasm hech qayerga saqlanmaydi va ommaga ochilmaydi.
func (s *Service) CheckImage(ctx context.Context, mime string, data []byte) (*Result, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	if len(data) == 0 {
		return nil, errors.New("moderation: empty image")
	}
	v, err := s.client.Classify(ctx, gemini.Input{ImageMIME: mime, Image: data})
	if err != nil {
		return nil, err
	}
	return decide(v), nil
}

// Check — e'lonning matni va (ixtiyoriy) rasmini tekshiradi.
//
// Matn va rasm ATAYLAB alohida so'rovlarda ketadi: birga yuborilganda model
// bitta umumiy baho qaytaradi va "matn tozami yoki rasmmi" degan savolga
// javob bo'lmaydi. Foydalanuvchiga aynan nima rad etilganini aytish uchun
// ikki chaqiruv kerak.
func (s *Service) Check(ctx context.Context, text, imageMIME string, image []byte) (*CheckResult, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	out := &CheckResult{Allowed: true, Model: s.Model()}

	if strings.TrimSpace(text) != "" {
		tr, err := s.CheckText(ctx, text)
		if err != nil {
			return nil, err
		}
		out.Text = tr
		out.Allowed = out.Allowed && tr.Allowed
	}
	if len(image) > 0 {
		ir, err := s.CheckImage(ctx, imageMIME, image)
		if err != nil {
			return nil, err
		}
		out.Image = ir
		out.Allowed = out.Allowed && ir.Allowed
	}
	return out, nil
}

// decide — Gemini xulosasini bizning qarorimizga aylantiradi.
func decide(v *gemini.Verdict) *Result {
	out := &Result{
		Allowed:     true,
		Categories:  map[string]bool{},
		Levels:      map[string]string{},
		BlockReason: v.BlockReason,
	}
	for name, level := range v.Ratings {
		out.Levels[name] = level
		if blocking[name] && gemini.ProbAtLeast(level, BlockThreshold) {
			out.Categories[name] = true
			out.Allowed = false
		}
	}
	// Gemini kirishning o'zini bloklagan bo'lsa (masalan IMAGE_SAFETY) —
	// bu eng qat'iy signal, baholardan qat'i nazar rad etamiz.
	if v.BlockReason != "" {
		out.Allowed = false
	}
	out.Flagged = !out.Allowed
	if !out.Allowed {
		out.Reason = out.ReasonWithPrefix(defaultReasonPrefix)
	}
	return out
}

// defaultReasonPrefix — Result.Reason maydonidagi standart boshlanish.
// Moderatsiya endpointlari birinchi navbatda e'lonlar uchun ishlatiladi;
// boshqa domenlar ReasonWithPrefix bilan o'z matnini quradi.
const defaultReasonPrefix = "E'lon qabul qilinmadi"

// genericReason — foydalanuvchiga ko'rsatiladigan sabab ATAYLAB umumiy.
//
// Qaysi kategoriya ishlaganini aytish ikki tomondan zarar: niyati buzuq
// foydalanuvchiga matnini qaysi tomonga "tuzatish" kerakligini o'rgatadi,
// halol foydalanuvchi esa noto'g'ri ishlagan tasnif ("seksual mazmun")
// tufayli haqorat qilingandek his qiladi. Tafsilot faqat server logida
// qoladi — Result.Detail() ga qarang.
const genericReason = "nomaqbul kontent"

// ReasonWithPrefix — berilgan boshlanish bilan sabab jumlasini quradi,
// masalan "E'lon qabul qilinmadi: nomaqbul kontent.". Ruxsat berilgan
// natija uchun bo'sh qaytaradi.
func (r *Result) ReasonWithPrefix(prefix string) string {
	if r == nil || r.Allowed {
		return ""
	}
	return prefix + ": " + genericReason + "."
}

// Detail — SERVER LOGI uchun tafsilot: qaysi kategoriyalar chegaradan
// oshgani va darajalari. Foydalanuvchiga HECH QACHON ko'rsatilmaydi.
//
// Sabab umumiy bo'lgani uchun, bunisiz "nega rad etildi" degan savolga
// javob topib bo'lmasdi — chegarani sozlash ham imkonsiz bo'lardi.
func (r *Result) Detail() string {
	if r == nil {
		return ""
	}
	names := make([]string, 0, len(r.Categories))
	for name := range r.Categories {
		names = append(names, name)
	}
	sort.Strings(names)

	parts := make([]string, 0, len(names)+1)
	for _, n := range names {
		parts = append(parts, n+"="+r.Levels[n])
	}
	if r.BlockReason != "" {
		parts = append(parts, "blockReason="+r.BlockReason)
	}
	if len(parts) == 0 {
		return "no categories"
	}
	return strings.Join(parts, " ")
}

func allowedResult() *Result {
	return &Result{Allowed: true, Categories: map[string]bool{}, Levels: map[string]string{}}
}
