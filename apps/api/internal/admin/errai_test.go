package admin

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
)

func asHTTPErr(t *testing.T, err error) *httpx.HTTPError {
	t.Helper()
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("err = %T (%v), want *httpx.HTTPError", err, err)
	}
	return he
}

// Har bir nosozlik admin UCHUN boshqacha ma'no anglatadi: kvota — "kutib
// tur", muddat — "qayta bos", kalit — "bu sizga bog'liq emas". Bitta
// umumiy "xatolik" xabari bularning uchalasini ham yashirardi.
func TestAIErrorMapping(t *testing.T) {
	cases := []struct {
		name   string
		in     error
		code   string
		status int
	}{
		{"muddat", context.DeadlineExceeded, "ai_timeout", http.StatusTooManyRequests},
		{"bo'sh javob", gemini.ErrEmptyAnalysis, "ai_empty", http.StatusTooManyRequests},
		{"sozlanmagan", gemini.ErrNotConfigured, "ai_not_configured", http.StatusServiceUnavailable},
		{"kvota", &gemini.APIError{Status: 429, RPCStatus: "RESOURCE_EXHAUSTED"}, "ai_quota", http.StatusTooManyRequests},
		{"kalit rad etildi", &gemini.APIError{Status: 401}, "ai_key_rejected", http.StatusServiceUnavailable},
		{"ruxsat yo'q", &gemini.APIError{Status: 403}, "ai_key_rejected", http.StatusServiceUnavailable},
		{"server nosozligi", &gemini.APIError{Status: 503}, "ai_failed", http.StatusTooManyRequests},
		{"noma'lum", errors.New("tarmoq uzildi"), "ai_failed", http.StatusTooManyRequests},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			he := asHTTPErr(t, aiError(tc.in))
			if he.Code != tc.code {
				t.Errorf("code = %q, want %q", he.Code, tc.code)
			}
			if he.Status != tc.status {
				t.Errorf("status = %d, want %d", he.Status, tc.status)
			}
			if strings.TrimSpace(he.Message) == "" {
				t.Error("xabar bo'sh — panelda ko'rsatadigan narsa qolmaydi")
			}
		})
	}
}

// Muddat o'ralgan holda ham (`%w`) tanilishi kerak: context.WithTimeout
// xatosi ko'pincha `url.Error` ichida keladi.
func TestAIErrorUnwrapsDeadline(t *testing.T) {
	wrapped := errors.New("gemini: request failed: " + context.DeadlineExceeded.Error())
	// Matn bo'yicha emas, zanjir bo'yicha tanilishi shart.
	if he := asHTTPErr(t, aiError(wrapped)); he.Code != "ai_failed" {
		t.Errorf("faqat matn mos kelgan xato %q ga aylandi", he.Code)
	}
	chained := &wrapErr{msg: "request failed", err: context.DeadlineExceeded}
	if he := asHTTPErr(t, aiError(chained)); he.Code != "ai_timeout" {
		t.Errorf("o'ralgan muddat tanilmadi: %q", he.Code)
	}
}

type wrapErr struct {
	msg string
	err error
}

func (e *wrapErr) Error() string { return e.msg + ": " + e.err.Error() }
func (e *wrapErr) Unwrap() error { return e.err }

// Kvota javobida `retryAfter` bo'lishi kerak — panel "qachon qayta
// urinish mumkin" degan yagona aniq ma'lumotni shu yerdan oladi.
func TestAIQuotaCarriesRetryAfter(t *testing.T) {
	he := asHTTPErr(t, aiError(&gemini.APIError{Status: 429, RPCStatus: "RESOURCE_EXHAUSTED"}))
	if he.Details == nil || he.Details["retryAfter"] == nil {
		t.Fatalf("details = %v, want retryAfter", he.Details)
	}
	if he.Details["daily"] != nil {
		t.Errorf("daily = %v — quotaId kelmagan, kunlik deb hisoblash mumkin emas", he.Details["daily"])
	}
}

// KUNLIK kvota — boshqa javob. Google bu holatda ham RetryInfo'da 20-60
// soniya qaytaradi, lekin o'sha muddat yolg'on: chegara ertaga tiklanadi.
// Panelga sanoq emas, `daily: true` yuboriladi.
func TestAIDailyQuotaHasNoCountdown(t *testing.T) {
	he := asHTTPErr(t, aiError(&gemini.APIError{
		Status:     429,
		RPCStatus:  "RESOURCE_EXHAUSTED",
		RetryAfter: 16,
		QuotaID:    "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
	}))
	if he.Code != "ai_quota" {
		t.Fatalf("code = %q, want ai_quota", he.Code)
	}
	if he.Details["daily"] != true {
		t.Errorf("details = %v, want daily:true", he.Details)
	}
	if he.Details["retryAfter"] != nil {
		t.Errorf("retryAfter = %v — kunlik chegarada sanoq ko'rsatilmasligi kerak", he.Details["retryAfter"])
	}
	if strings.Contains(he.Message, "soniya") {
		t.Errorf("message = %q — kunlik chegarada soniya va'da qilinmaydi", he.Message)
	}
}

// Frontend `responseError` 5xx javob TANASINI tashlab yuboradi — ya'ni
// 5xx bilan qaytgan har qanday `ai_*` kodi panelga yetib bormaydi va
// admin "nimadir xato" dan boshqa hech narsa ko'rmaydi. Faqat sozlama
// nosozligi (503) bundan mustasno: u kod emas, muhit muammosi va matni
// baribir umumiy.
func TestAIErrorsAvoidOpaqueStatuses(t *testing.T) {
	for _, err := range []error{
		context.DeadlineExceeded,
		gemini.ErrEmptyAnalysis,
		&gemini.APIError{Status: 429, RPCStatus: "RESOURCE_EXHAUSTED"},
		&gemini.APIError{Status: 500},
		errors.New("x"),
	} {
		if he := asHTTPErr(t, aiError(err)); he.Status >= 500 {
			t.Errorf("aiError(%v) = %d %s — panel bu tanani o'qimaydi", err, he.Status, he.Code)
		}
	}
}

// Ikki admin bir vaqtda "Sababini aniqla" bosса, ikkita PULLIK chaqiruv
// ketardi va natijadan bittasi baribir ustiga yozilardi.
func TestAILockIsPerGroup(t *testing.T) {
	if !aiLock("A") {
		t.Fatal("birinchi qulf olinmadi")
	}
	if aiLock("A") {
		t.Error("bir guruh ikki marta qulflandi")
	}
	if !aiLock("B") {
		t.Error("boshqa guruh bloklanib qoldi — qulf global bo'lib qolgan")
	}
	aiUnlock("A")
	aiUnlock("B")
	if !aiLock("A") {
		t.Error("qulf bo'shatilmadi")
	}
	aiUnlock("A")

	// Poyga: faqat bittasi o'tishi kerak.
	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if aiLock("C") {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if won != 1 {
		t.Errorf("qulfni %d ta gorutina oldi, want 1", won)
	}
	aiUnlock("C")
}

// Eksport limiteri bo'sh kalitni O'TKAZADI (`allow("")` → true), chunki u
// faqat o'qish amali. AI chaqiruvi esa pul turadi: kim so'raganini
// bilmasak, uni cheklab ham bo'lmaydi. Shu sababli handlerda bo'sh
// adminID alohida rad etiladi — bu shart o'chib qolmasligi kerak.
func TestAIHandlerRejectsAnonymous(t *testing.T) {
	if !aiLimiter.allow("") {
		t.Fatal("rateBucket xulqi o'zgargan: endi bo'sh kalitni o'zi rad etadi — handlerdagi qo'shimcha shartni qayta ko'rib chiqing")
	}
	src, err := os.ReadFile("errai.go")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`adminID == ""\s*\|\|\s*!aiLimiter\.allow\(adminID\)`).Match(src) {
		t.Error("handlerda `adminID == \"\" || !aiLimiter.allow(adminID)` sharti yo'q — anonim chaqiruv cheklovsiz o'tardi")
	}
}

// AI chaqiruvi tashqi xizmatga ma'lumot chiqaradi — u ham eksport kabi
// auditda ko'rinishi kerak, aks holda "kim yubordi" savoliga javob yo'q.
func TestAIWritesAudit(t *testing.T) {
	src, err := os.ReadFile("errai.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(src), `h.audit(r, "error_ai"`) {
		t.Error("errai.go auditga yozmaydi")
	}
	page := filepath.Join("..", "..", "..", "web", "app", "admin", "audit", "page.tsx")
	if b, err := os.ReadFile(page); err == nil && !strings.Contains(string(b), "error_ai:") {
		t.Error("audit sahifasi katalogida error_ai yo'q")
	}
}

// Kirish matni AYNAN eksport quvuridan olinishi kerak. Ikkinchi shakl
// yozilsa, panelda ko'ringan niqoblangan matn bilan AI ko'rgan matn
// vaqt o'tib bir-biridan uzoqlashardi — va niqob ham ikki joyda
// ta'minlanishi kerak bo'lardi.
func TestAIUsesExportPipeline(t *testing.T) {
	src, err := os.ReadFile("errai.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(src), "renderContext(h.buildContext(") {
		t.Error("errai.go kontekstni renderContext/buildContext orqali yig'maydi — niqob chetlab o'tilishi mumkin")
	}
}
