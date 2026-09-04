package errlog

import (
	"net/http"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
)

// reportReq — mijoz (Flutter ilova yoki veb) yuboradigan xabar.
//
// Bu yerda ATAYLAB kam maydon bor. Daraja, modul, sarlavha va ish muhiti
// mijozdan SO'RALMAYDI — ular katalogdan, kod bo'yicha olinadi. Aks holda
// har qanday mijoz o'zi yuborgan hodisani "Kritik" deb belgilab, jamoani
// Telegram orqali istagan vaqtda uyg'ota olardi.
type reportReq struct {
	// Code — katalogdagi kod. Boshqasi qabul qilinmaydi.
	Code string `json:"code"`
	// Where — ekran/fayl nomi ("ElonListPage.build"). Guruhlash uchun.
	Where string `json:"where"`
	// Message — qisqa tavsif. Niqoblanadi va qisqartiriladi.
	Message string `json:"message"`
	// Path — mijoz murojaat qilgan yo'l. So'rov satri tashlanadi.
	Path       string `json:"path"`
	AppVersion string `json:"appVersion"`
	Platform   string `json:"platform"`
	// Stack — stek izi qatorlari (Flutter: `StackTrace.toString()` ni
	// qatorlarga bo'lib). Har biri niqoblanadi va qisqartiriladi.
	Stack []string `json:"stack"`
	// Steps — xatolikdan oldingi qadamlar (Figma 3.12.3 · I). Mijoz ularni
	// halqali buferda yuritadi va faqat shu yerda yuboradi.
	Steps []stepReq `json:"steps"`
	// RequestID — mijoz javobda ko'rgan so'rov identifikatori. Server
	// logidagi qator bilan bog'lash uchun.
	RequestID  string `json:"requestId"`
	DurationMs int    `json:"durationMs"`
}

type stepReq struct {
	At   string `json:"at"` // RFC3339
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// maxIngestList — mijoz yuborgan ro'yxatlarning YUQORI chegarasi. Recorder
// keyin ularni yana qisqartiradi (maxStackLines / maxStepCount); bu esa
// undan oldingi to'siq: minglab elementli massivni umuman aylanib
// chiqmaslik uchun.
const maxIngestList = 100

// ClientReport — POST /api/client-errors (foydalanuvchi tokeni bilan).
//
// # NEGA AUTENTIFIKATSIYA MAJBURIY
//
// Ochiq endpoint bo'lsa, uni istalgan kishi tashqaridan to'ldirib,
// "Xatoliklar" sahifasini yolg'on hodisalar bilan ko'mib tashlar edi —
// haqiqiy nosozlik esa shovqin ichida yo'qolardi. Token talab qilinishi
// hujumni hech bo'lmasa akkauntga bog'laydi, tezlik chegarasi esa uni
// foydasiz qiladi.
func (r *Recorder) ClientReport(w http.ResponseWriter, req *http.Request) {
	r.report(w, req, OriginClient, httpx.UserID(req), map[string]bool{ModClientApp: true})
}

// AdminReport — POST /api/admin/client-errors (admin tokeni bilan).
// Admin ilovasining o'z xatoliklari (C5) va biometrik qulf (C7) shu
// yerdan keladi.
func (r *Recorder) AdminReport(w http.ResponseWriter, req *http.Request) {
	r.report(w, req, OriginAdminApp, httpx.AdminID(req), map[string]bool{ModAdminApp: true, ModSecurity: true})
}

func (r *Recorder) report(w http.ResponseWriter, req *http.Request, origin Origin, actor string, allow map[string]bool) {
	var in reportReq
	if err := httpx.Decode(req, &in); err != nil {
		httpx.Err(w, err)
		return
	}
	t, ok := Catalog[in.Code]
	// Uch shart ham bajarilishi shart: kod katalogda bo'lsin, mijozdan
	// yuborilishi mumkin bo'lsin va shu endpointning moduliga tegishli
	// bo'lsin. Oxirgisi eng muhimi: usiz oddiy foydalanuvchi admin
	// ilovasining Kritik kodlarini yuborib, ogohlantirish chiqara olardi.
	if !ok || !t.ClientReportable || !allow[t.Module] {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_code", "unknown or not reportable error code"))
		return
	}
	now := time.Now()
	stack := in.Stack
	if len(stack) > maxIngestList {
		stack = stack[:maxIngestList]
	}
	steps := make([]models.ErrorStep, 0, len(in.Steps))
	for i, s := range in.Steps {
		if i >= maxIngestList {
			break
		}
		at, err := time.Parse(time.RFC3339, s.At)
		if err != nil {
			// Vaqti o'qilmasa hodisa vaqti qo'yiladi: qadamlar tartibi
			// baribir massivning o'zida saqlanadi.
			at = now
		}
		steps = append(steps, models.ErrorStep{At: at, Kind: s.Kind, Text: s.Text})
	}

	// Qurilma SARLAVHADAN olinadi, tanadan emas. Sababi bir xil: ikkalasi
	// ham ishonchsiz, lekin sarlavha butun tizimda bitta joyda tozalanadi
	// (device.go) va u serverning o'z 5xx yozuvlariga ham tushadi.
	dev := ParseDevice(req)
	if dev.AppVersion == "" {
		dev.AppVersion = Clip(Text(in.AppVersion), 32)
	}
	r.Record(Event{
		Code:       in.Code,
		Where:      in.Where,
		Message:    in.Message,
		Path:       in.Path,
		UserID:     actor,
		IsAdmin:    origin == OriginAdminApp,
		Platform:   firstNonEmpty(in.Platform, req.Header.Get("X-Client-Platform")),
		AppVersion: in.AppVersion,
		Origin:     origin,
		Device:     dev,
		Stack:      stack,
		Steps:      steps,
		RequestID:  in.RequestID,
		DurationMs: in.DurationMs,
		At:         now,
	})
	// 202: qabul qilindi. Mijoz natijani kutmaydi va bilishi ham shart
	// emas — yozuv asinxron va "best-effort".
	w.WriteHeader(http.StatusAccepted)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
