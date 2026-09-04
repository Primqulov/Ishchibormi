package admin

// "3.12.1 · Xatolik — batafsil" ekranidagi "Sababini aniqla" tugmasi:
// xatolik konteksti Gemini'ga yuboriladi va ildiz-sabab xulosasi qaytadi.
//
// # NEGA SERVERDA, KLIENTDA EMAS
//
// Uchta sabab, muhimlik tartibida:
//
//  1. NIQOB. Kontekst matni errexport.go da yig'iladi va o'sha yerda
//     niqoblanadi. Agar brauzer o'zi Gemini'ga borsa, matnni DevTools'da
//     o'zgartirib, niqobsiz variantini yuborish mumkin bo'lardi.
//  2. KALIT. AI kaliti serverda qoladi. Klient chaqirsa, kalit
//     brauzerga tushardi — ya'ni har bir admin uni ko'chirib olardi.
//  3. XOTIRA. Javob guruhga yoziladi: keyingi admin xuddi shu xulosani
//     qayta so'ramasdan ko'radi (kvota bepul tarifda daqiqasiga 20 ta).
//
// # NEGA AVTOMATIK EMAS
//
// Har yangi xatolikni o'z-o'zidan tahlil qilish vasvasali, lekin: har
// chaqiruv pul va kvota; xatoliklarning katta qismi bir marta chiqib
// yo'qoladi; va eng muhimi — tashqi xizmatga ma'lumot yuborish ODAM
// qarori bo'lib qolishi kerak. Shu sababli tugma bor, cron yo'q.

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/errlog"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// aiLimiter — tahlil chastotasi, admin boshiga.
//
// Eksport limiteridan (20 / 5 daqiqa) qattiqroq: eksport bazadan matn
// o'qiydi, tahlil esa PULLIK tashqi chaqiruv qiladi va bepul tarifda
// butun server uchun daqiqasiga 20 ta so'rov bor. Beshta — tugmani
// asabiy bosishdan himoya qiladi, lekin haqiqiy ishga xalaqit bermaydi.
var aiLimiter = &rateBucket{limit: 5, window: 5 * time.Minute, hits: map[string][]time.Time{}}

// aiSingle — bitta guruh bo'yicha bir vaqtda bitta chaqiruv. Ikki admin
// bir vaqtda bosса, ikkinchisi kutmaydi — "hozir tahlil qilinmoqda"
// javobini oladi. Aks holda ikkita kvota sarflanib, natijadan bittasi
// baribir ustiga yozilardi.
var aiSingle = struct {
	mu sync.Mutex
	m  map[string]bool
}{m: map[string]bool{}}

func aiLock(id string) bool {
	aiSingle.mu.Lock()
	defer aiSingle.mu.Unlock()
	if aiSingle.m[id] {
		return false
	}
	aiSingle.m[id] = true
	return true
}

func aiUnlock(id string) {
	aiSingle.mu.Lock()
	delete(aiSingle.m, id)
	aiSingle.mu.Unlock()
}

type errAIReq struct {
	// Include — kontekstga qo'shiladigan bo'limlar (errexport.go dagi
	// bir xil kalitlar). Bo'sh bo'lsa standart beshtasi.
	Include []string `json:"include"`
	// Force — saqlangan xulosa bo'lsa ham qaytadan so'rash.
	Force bool `json:"force"`
}

// PostErrorAI: POST /admin/errors/{id}/ai
//
// Javob — YANGILANGAN guruh (models.ErrorGroup), boshqa hayot-sikli
// endpointlari kabi: panel bitta joydan yangilanadi va `ai` maydoni
// batafsil javobning ichida keladi.
func (h *Handler) PostErrorAI(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	g, err := h.errGroup(ctx, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if h.AI == nil || !h.AI.Configured() {
		httpx.Err(w, httpx.NewError(http.StatusServiceUnavailable, "ai_not_configured",
			"AI tahlili sozlanmagan (ERROR_AI_API_KEY yoki GEMINI_API_KEY)"))
		return
	}

	var in errAIReq
	if r.ContentLength > 0 {
		if err := httpx.Decode(r, &in); err != nil {
			httpx.Err(w, err)
			return
		}
	}
	inc, _, perr := parseInclude(strings.Join(in.Include, ","))
	if perr != nil {
		httpx.Err(w, perr)
		return
	}

	// Saqlangan xulosa — hodisalar soni o'zgarmagan bo'lsa, aynan shu
	// hisobot bo'yicha yana so'rash ma'nosiz.
	if !in.Force && g.AI != nil && g.AI.CountAt == g.Count {
		httpx.JSON(w, http.StatusOK, g)
		return
	}

	adminID := httpx.AdminID(r)
	// Eksport limiteridan farqli: bo'sh kalit O'TKAZILMAYDI. Bu chaqiruv
	// pul turadi, ya'ni "kim so'radi" noma'lum bo'lsa — rad etiladi.
	if adminID == "" || !aiLimiter.allow(adminID) {
		httpx.Err(w, httpx.NewError(http.StatusTooManyRequests, "rate_limited",
			"AI tahlili juda tez-tez so'ralmoqda — bir necha daqiqadan keyin urinib ko'ring"))
		return
	}

	gid := g.ID.Hex()
	if !aiLock(gid) {
		httpx.Err(w, httpx.NewError(http.StatusConflict, "ai_busy",
			"bu xatolik hozir tahlil qilinmoqda — bir necha soniyadan keyin sahifani yangilang"))
		return
	}
	defer aiUnlock(gid)

	// Kirish matni — eksport bilan AYNAN bir xil quvur (niqob, bo'limlar,
	// "Savol" qatori). Ikkinchi shakl yozilsa, panelda ko'ringan matn
	// bilan AI ko'rgan matn bir-biridan sekin-asta uzoqlashardi.
	text := renderContext(h.buildContext(ctx, g, inc), "txt")

	// Chaqiruv uchun ALOHIDA muddat: mijoz ulanishni uzsa ham (r.Context
	// bekor bo'ladi) natijani saqlab ulgurish uchun emas — aksincha,
	// serverning 60 s WriteTimeout'iga urilmaslik uchun.
	timeout := h.Cfg.ErrorAITimeout
	if timeout <= 0 || timeout > 50*time.Second {
		timeout = 40 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	res, aerr := h.AI.Analyze(cctx, gemini.AnalyzeInput{Context: text, Code: g.Code, Ref: g.Ref})
	if aerr != nil {
		httpx.Err(w, aiError(aerr))
		return
	}

	actor := h.adminLabel(ctx, adminID)
	now := time.Now()
	ai := models.ErrorAI{
		Sarlavha:   res.Sarlavha,
		Sabab:      res.Sabab,
		Qayerda:    res.Qayerda,
		Tuzatish:   res.Tuzatish,
		Tekshirish: res.Tekshirish,
		Ishonch:    res.Ishonch,
		Model:      res.Model,
		Tokens:     res.Tokens,
		Include:    inc,
		CountAt:    g.Count,
		At:         now,
		By:         actor,
	}

	line := "AI tahlili: " + errlog.Clip(res.Sarlavha, 120) + " (ishonch: " + val(res.Ishonch) + ")"
	var out models.ErrorGroup
	uerr := h.ErrGroups.FindOneAndUpdate(ctx, bson.M{"_id": g.ID},
		bson.M{
			"$set": bson.M{"ai": ai},
			"$push": bson.M{"activity": bson.M{
				"$each":  bson.A{models.ErrorActivity{Kind: "ai", Text: line, Actor: actor, At: now}},
				"$slice": -errlog.MaxActivity,
			}},
		},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&out)
	if uerr != nil {
		if uerr == mongo.ErrNoDocuments {
			httpx.Err(w, httpx.NewError(http.StatusNotFound, "not_found", "xatolik topilmadi"))
			return
		}
		httpx.Err(w, uerr)
		return
	}

	// Audit: kontekst eksporti kabi, bu ham "diagnostika ma'lumoti
	// tashqariga chiqdi" degani — kim, qaysi model va nechta token.
	h.audit(r, "error_ai", gid, g.Ref+" · "+res.Model+" · "+strconv.Itoa(res.Tokens)+" token")
	httpx.JSON(w, http.StatusOK, out)
}

// aiError — Gemini xatosini panel tushunadigan javobga aylantiradi.
//
// Kodlar ATAYLAB 5xx emas (imkon qadar): frontend `responseError` 5xx
// javob tanasini tashlab yuboradi, ya'ni admin "nimadir xato" dan boshqa
// hech narsa ko'rmasdi. Kvota va muddat — kutilgan, tushuntiriladigan
// holatlar, shuning uchun ular 429 bilan qaytadi.
func aiError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return httpx.NewError(http.StatusTooManyRequests, "ai_timeout",
			"AI belgilangan vaqtda javob bermadi — qayta urinib ko'ring")
	}
	if errors.Is(err, gemini.ErrEmptyAnalysis) {
		return httpx.NewError(http.StatusTooManyRequests, "ai_empty",
			"AI javob qaytarmadi — qayta urinib ko'ring")
	}
	if errors.Is(err, gemini.ErrNotConfigured) {
		return httpx.NewError(http.StatusServiceUnavailable, "ai_not_configured",
			"AI tahlili sozlanmagan")
	}
	var ae *gemini.APIError
	if errors.As(err, &ae) {
		switch {
		case ae.DailyQuota():
			// KUNLIK chegara. Google bu holatda ham RetryInfo'da 20-60
			// soniya qaytaradi, lekin o'sha muddatdan keyin urinish yana
			// 429 beradi — kvota faqat ertasi kuni tiklanadi. Shuning
			// uchun sanoq ko'rsatilmaydi: panel adminni kutib o'tirishga
			// majburlamasin.
			return httpx.NewErrorWithDetails(http.StatusTooManyRequests, "ai_quota",
				"Bugungi AI kvotasi tugadi — chegara ertaga yangilanadi",
				map[string]any{"daily": true})
		case ae.QuotaExceeded():
			// Daqiqalik (yoki noma'lum) chegara: kutish muddatini Google
			// o'zi aytadi (RetryInfo), taxmin qilinmaydi.
			wait := ae.RetryAfter
			if wait <= 0 {
				wait = 60
			}
			return httpx.NewErrorWithDetails(http.StatusTooManyRequests, "ai_quota",
				"AI kvotasi tugadi — "+humanWait(wait)+" keyin qayta urinib ko'ring",
				map[string]any{"retryAfter": wait})
		case ae.Unauthorized():
			// Sozlama muammosi: kalit noto'g'ri yoki loyihada API yoqilmagan.
			// Admin buni tuzata olmaydi, lekin sababni bilishi kerak.
			return httpx.NewError(http.StatusServiceUnavailable, "ai_key_rejected",
				"AI kaliti rad etildi — server sozlamasini tekshirish kerak")
		}
	}
	return httpx.NewError(http.StatusTooManyRequests, "ai_failed",
		"AI tahlili bajarilmadi — qayta urinib ko'ring")
}

// humanWait — soniyani o'zbekcha muddatga aylantiradi. "3600 soniyadan
// keyin" texnik jihatdan to'g'ri, lekin admin uni o'qib vaqtni o'zi
// hisoblab chiqarishi kerak bo'lardi.
func humanWait(sec int) string {
	switch {
	case sec < 90:
		return strconv.Itoa(sec) + " soniyadan"
	case sec < 3600:
		return strconv.Itoa((sec+59)/60) + " daqiqadan"
	default:
		return strconv.Itoa((sec+3599)/3600) + " soatdan"
	}
}
