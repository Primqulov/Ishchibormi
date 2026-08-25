package moderation

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/gemini"
	"github.com/ishchibormi/backend/pkg/httpx"
)

// allowedImageMIME — moderatsiyaga yuboriladigan rasm turlari. Ro'yxat
// ataylab e'lon rasmlari uchun ruxsat etilganlar bilan bir xil
// (internal/upload dagi `elon` qoidasi): moderatsiyadan o'tgan tur keyin
// yuklashda rad etilib qolmasin.
var allowedImageMIME = []string{"image/jpeg", "image/png", "image/webp"}

// Handler — moderatsiya REST sirti.
type Handler struct {
	Svc *Service
	// MaxImageBytes — bitta rasm uchun yuqori chegara. Nol bo'lsa
	// defaultMaxImageBytes ishlatiladi.
	MaxImageBytes int64
}

// defaultMaxImageBytes — 8 MiB, e'lon rasmi chegarasi bilan bir xil.
// Gemini inline_data uchun so'rov hajmini cheklaydi (20 MB) va base64 o'rash
// hajmni ~33% oshiradi, shuning uchun undan ancha past turamiz.
const defaultMaxImageBytes = 8 << 20

// NewHandler handler quradi.
func NewHandler(svc *Service, maxImageBytes int64) *Handler {
	if maxImageBytes <= 0 {
		maxImageBytes = defaultMaxImageBytes
	}
	return &Handler{Svc: svc, MaxImageBytes: maxImageBytes}
}

// maxTextRunes — tekshiriladigan matn uzunligi chegarasi. E'lon sarlavhasi +
// tavsifi bundan ancha qisqa; chegara bitta so'rov bilan katta token sarfini
// oldini oladi.
const maxTextRunes = 8000

type textReq struct {
	Text string `json:"text"`
}

// Text — POST /api/moderation/text
//
// Kirish:  {"text": "tekshiriladigan matn"}
// Chiqish: {"allowed": bool, "flagged": bool, "categories": {...}, "scores": {...}, "model": "..."}
func (h *Handler) Text(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	var req textReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "text_required", "matn bo'sh"))
		return
	}
	if len([]rune(text)) > maxTextRunes {
		httpx.Err(w, httpx.NewError(http.StatusRequestEntityTooLarge, "text_too_long", "matn juda uzun"))
		return
	}
	res, err := h.Svc.CheckText(r.Context(), text)
	if err != nil {
		httpx.Err(w, upstreamError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, textResponse{Result: res, Model: h.Svc.Model()})
}

// textResponse — Result ustiga model nomini qo'shadi.
type textResponse struct {
	*Result
	Model string `json:"model"`
}

// Image — POST /api/moderation/image  (multipart/form-data, maydon: "image")
//
// Rasm diskka SAQLANMAYDI: baytlar xotirada o'qilib, `data:` URL sifatida
// Gemini'ga ketadi. Go katta multipart qismlarni vaqtinchalik faylga tushirib
// qo'yishi mumkin — shu sabab quyida RemoveAll ataylab defer bilan
// chaqiriladi, xato yo'lida ham tozalansin.
func (h *Handler) Image(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	data, mime, err := h.readImage(w, r)
	if err != nil {
		// Bu endpointda rasm majburiy — yo'qligi 400 (Check'da esa u xato
		// emas, shu sabab errNoImage bu yerda tarjima qilinadi).
		if errors.Is(err, errNoImage) {
			err = httpx.NewError(http.StatusBadRequest, "no_file", "rasm topilmadi (maydon nomi: image)")
		}
		httpx.Err(w, err)
		return
	}
	res, err := h.Svc.CheckImage(r.Context(), mime, data)
	if err != nil {
		httpx.Err(w, upstreamError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, imageResponse{Result: res, Model: h.Svc.Model(), MIME: mime})
}

type imageResponse struct {
	*Result
	Model string `json:"model"`
	MIME  string `json:"mime"`
}

// Check — POST /api/moderation/check  (multipart/form-data)
//
// Bitta e'lonni tekshiradi:
//   - "text"  — matn maydoni (majburiy emas, lekin rasm bilan birga bo'lmasa
//     so'rov ma'nosiz);
//   - "image" — ixtiyoriy rasm fayli.
//
// Chiqish:
//
//	{"allowed": false, "model": "...",
//	 "text":  {"allowed": true,  "categories": {}, "scores": {}},
//	 "image": {"allowed": false, "categories": {"sexual": true}, "scores": {...}}}
func (h *Handler) Check(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	// Multipart bo'lmagan (oddiy JSON) so'rovni ham qabul qilamiz — faqat
	// matnni tekshirmoqchi bo'lgan klient uchun qulay.
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "multipart/form-data") {
		var req textReq
		if err := httpx.Decode(r, &req); err != nil {
			httpx.Err(w, err)
			return
		}
		h.respondCheck(w, r, req.Text, "", nil)
		return
	}

	data, mime, err := h.readImage(w, r)
	// Rasm bo'lmasligi mumkin — bu xato emas, matn bo'yicha davom etamiz.
	if err != nil && !errors.Is(err, errNoImage) {
		httpx.Err(w, err)
		return
	}
	text := r.FormValue("text")
	if strings.TrimSpace(text) == "" && len(data) == 0 {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "empty_request", "matn ham, rasm ham berilmadi"))
		return
	}
	if len([]rune(text)) > maxTextRunes {
		httpx.Err(w, httpx.NewError(http.StatusRequestEntityTooLarge, "text_too_long", "matn juda uzun"))
		return
	}
	h.respondCheck(w, r, text, mime, data)
}

func (h *Handler) respondCheck(w http.ResponseWriter, r *http.Request, text, mime string, image []byte) {
	if strings.TrimSpace(text) == "" && len(image) == 0 {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "empty_request", "matn ham, rasm ham berilmadi"))
		return
	}
	res, err := h.Svc.Check(r.Context(), text, mime, image)
	if err != nil {
		httpx.Err(w, upstreamError(err))
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

// enabled — xizmat sozlanmagan bo'lsa 503 qaytaradi (upload'dagi
// "storage_disabled" bilan bir xil naqsh) va false qaytaradi.
func (h *Handler) enabled(w http.ResponseWriter) bool {
	if h.Svc.Enabled() {
		return true
	}
	httpx.Err(w, httpx.NewError(http.StatusServiceUnavailable, "moderation_disabled",
		"moderatsiya sozlanmagan"))
	return false
}

// errNoImage — multipart so'rovda "image" maydoni yo'q (Check uchun bu xato
// emas).
var errNoImage = errors.New("no image field")

// readImage multipart so'rovdan rasmni o'qiydi, turini BAYTLARDAN aniqlaydi
// va buzilgan/bomba rasmni rad etadi.
//
// Client yuborgan Content-Type'ga ishonilmaydi: uni soxtalashtirib HTML/SVG
// yuborish mumkin. Aynan shu yondashuv internal/upload da ham qo'llanilgan.
func (h *Handler) readImage(w http.ResponseWriter, r *http.Request) ([]byte, string, error) {
	// Multipart qismlari diskka tushgan bo'lsa, so'rov tugashi bilan
	// o'chiriladi — xato yo'lida ham.
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	r.Body = http.MaxBytesReader(w, r.Body, h.MaxImageBytes+(1<<20))
	if err := r.ParseMultipartForm(h.MaxImageBytes); err != nil {
		return nil, "", httpx.NewError(http.StatusRequestEntityTooLarge, "too_large", "fayl hajmi katta")
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		return nil, "", errNoImage
	}
	defer file.Close()

	if header.Size > h.MaxImageBytes {
		return nil, "", httpx.NewError(http.StatusRequestEntityTooLarge, "too_large", "fayl hajmi katta")
	}
	raw, err := io.ReadAll(io.LimitReader(file, h.MaxImageBytes+1))
	if err != nil {
		return nil, "", httpx.NewError(http.StatusBadRequest, "no_file", "fayl o'qib bo'lmadi")
	}
	if int64(len(raw)) > h.MaxImageBytes {
		return nil, "", httpx.NewError(http.StatusRequestEntityTooLarge, "too_large", "fayl hajmi katta")
	}
	mime := sniffMIME(raw)
	if !mimeAllowed(mime) {
		return nil, "", httpx.NewError(http.StatusUnsupportedMediaType, "bad_type",
			"faqat JPEG, PNG yoki WEBP qabul qilinadi")
	}
	// Buzilgan fayl va "dekompressiya bombasi" ni rad etadi — internal/upload
	// dagi tekshiruv qayta yozilmasdan qayta ishlatiladi.
	if !upload.ValidateImage(raw, mime) {
		return nil, "", httpx.NewError(http.StatusUnprocessableEntity, "invalid_image",
			"rasm buzilgan yoki o'lchami juda katta")
	}
	return raw, mime, nil
}

func sniffMIME(raw []byte) string {
	n := len(raw)
	if n > 512 {
		n = 512
	}
	ct := http.DetectContentType(raw[:n])
	return strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
}

func mimeAllowed(mime string) bool {
	for _, m := range allowedImageMIME {
		if m == mime {
			return true
		}
	}
	return false
}

// upstreamError — Gemini xatosini mijozga tushunarli HTTP xatosiga
// aylantiradi.
//
// Tafsilot mijozga uzatilmaydi (httpx.Err naqshi): Gemini matni ichki
// ma'lumot. Server tomonida log qilinadi — kalit esa pkg/gemini da
// redactString bilan allaqachon olib tashlangan.
func upstreamError(err error) error {
	switch {
	// Kalit umuman berilmagan.
	case errors.Is(err, ErrDisabled), errors.Is(err, gemini.ErrNotConfigured):
		return httpx.NewError(http.StatusServiceUnavailable, "moderation_disabled",
			"moderatsiya sozlanmagan")
	// Timeout — klient muddati yoki kontekst bekor qilinishi.
	case errors.Is(err, context.DeadlineExceeded):
		log.Printf("moderation: upstream timeout: %v", err)
		return httpx.NewError(http.StatusGatewayTimeout, "moderation_timeout",
			"moderatsiya xizmati javob bermadi, keyinroq urinib ko'ring")
	}
	var apiErr *gemini.APIError
	if errors.As(err, &apiErr) {
		// Kalit va so'rov tanasi bu yerga tushmaydi — faqat status.
		log.Printf("moderation: gemini status=%d rpc=%s", apiErr.Status, apiErr.RPCStatus)
		switch {
		case apiErr.Unauthorized():
			// 401/403 — kalit noto'g'ri yoki API yoqilmagan. Server
			// sozlamasi muammosi, foydalanuvchi tuzata olmaydi.
			return httpx.NewError(http.StatusBadGateway, "moderation_failed",
				"moderatsiyani bajarib bo'lmadi")
		case apiErr.Retryable():
			// 429 (RESOURCE_EXHAUSTED — kvota/limit) va 5xx.
			return httpx.NewError(http.StatusServiceUnavailable, "moderation_unavailable",
				"moderatsiya xizmati vaqtincha ishlamayapti, keyinroq urinib ko'ring")
		default:
			// 400 INVALID_ARGUMENT (masalan qo'llab-quvvatlanmaydigan rasm
			// formati), 404 NOT_FOUND (model yopilgan) va boshqalar.
			return httpx.NewError(http.StatusBadGateway, "moderation_failed",
				"moderatsiyani bajarib bo'lmadi")
		}
	}
	log.Printf("moderation: upstream error: %v", err)
	return httpx.NewError(http.StatusBadGateway, "moderation_failed",
		"moderatsiyani bajarib bo'lmadi")
}
