package admin

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const exportMax = 50000

// csvCell prevents spreadsheet formula injection. Excel evaluates cells that
// begin (even after whitespace) with =, +, -, or @; user-controlled names,
// titles and phone fields must remain inert text when an admin opens an export.
func csvCell(s string) string {
	trimmed := strings.TrimLeft(s, " \t\r\n")
	if trimmed == "" {
		return s
	}
	switch trimmed[0] {
	case '=', '+', '-', '@':
		return "'" + s
	default:
		return s
	}
}

// csvDownload sets download headers and writes a UTF-8 BOM so Excel opens
// Cyrillic/Latin text correctly, then returns a writer for the rows.
//
// Uses ';' as the field delimiter because Excel in Uzbek/Russian locales
// expects the semicolon list separator — a comma-delimited file would open
// with every column crammed into one cell. Go's encoding/csv quotes any
// field that itself contains ';', so values stay intact.
func csvDownload(w http.ResponseWriter, filename string) *csv.Writer {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	return cw
}

// ExportUsers streams users (same filters as ListUsers) as CSV.
func (h *Handler) ExportUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Users.Find(ctx, usersFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "users.csv")
	_ = cw.Write([]string{"id", "ism", "familiya", "telefon", "viloyat", "tuman", "reyting", "sharhlar", "bajarilganIsh", "tasdiqlangan", "bloklangan", "yaratilgan", "royxatPlatformasi", "royxatQurilmasi", "oxirgiPlatforma", "oxirgiQurilma", "oxirgiFaollik"})
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) != nil {
			continue
		}
		_ = cw.Write([]string{
			u.ID.Hex(), csvCell(u.FirstName), csvCell(u.LastName), csvCell(u.Phone), csvCell(u.Region), csvCell(u.District),
			strconv.FormatFloat(u.Rating, 'f', 1, 64), strconv.Itoa(u.ReviewsCount),
			strconv.Itoa(u.CompletedJobsCount), strconv.FormatBool(u.IsPhoneVerified),
			strconv.FormatBool(u.IsBlocked), u.CreatedAt.Format(time.RFC3339),
			// Bo'sh emas, "unknown": eksportni jadval dasturida ochgan odam
			// bo'sh katakni "ma'lumot yo'qolgan" deb o'qiydi.
			httpx.PlatformOrUnknown(u.SignupPlatform),
			// Qurilma — ALOHIDA ustun, platformaga qo'shib yozilmaydi:
			// "web android" bitta katakda bo'lsa, jadval dasturida platforma
			// bo'yicha guruhlab bo'lmasdi.
			//
			// Bu yerda bo'sh katak to'g'ri va "unknown" ga aylantirilmaydi:
			// mobil ilova hisoblarida qurilma ustuni ATAYLAB bo'sh (u yerda
			// platformaning o'zi qurilma OS'i), ya'ni bo'shlik "ma'lumot
			// yo'qolgan" emas, "bu ustun bu qatorga tegishli emas" degani.
			u.SignupDevice,
			httpx.PlatformOrUnknown(u.LastPlatform),
			u.LastDevice,
			csvTime(u.LastSeenAt),
		})
	}
	cw.Flush()
	h.audit(r, "export_users", "", "")
}

// csvTime — ixtiyoriy vaqtni katakka aylantiradi; yo'q bo'lsa bo'sh katak.
func csvTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

// ExportElons streams elons (same filters as ListElons) as CSV.
func (h *Handler) ExportElons(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Elons.Find(ctx, elonsFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "elons.csv")
	_ = cw.Write([]string{"id", "sarlavha", "turkum", "holat", "viloyat", "ishchiKerak", "narx", "egasi", "ko'rishlar", "yaratilgan"})
	for cur.Next(ctx) {
		var e models.Elon
		if cur.Decode(&e) != nil {
			continue
		}
		_ = cw.Write([]string{
			// `csvCell` holat ustuniga ham qo'llanadi: hozir holat mashina
			// tomonidan qo'yiladi, lekin faylning o'z qoidasi "har bir matn
			// katak zararsizlantirilgan" — bitta istisno keyinchalik
			// e'tibordan chetda qolib ketardi.
			e.ID.Hex(), csvCell(e.Title), csvCell(e.CategoryName), csvCell(e.Status), csvCell(e.Region),
			strconv.Itoa(e.WorkersNeeded), strconv.FormatInt(e.PriceAmount, 10),
			csvCell(e.OwnerName), strconv.Itoa(e.ViewsCount), e.CreatedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_elons", "", "")
}

// ExportApplications streams applications (same filters as ListApplications) as CSV.
//
// Ustunlar Figma 3.6a · «CSV yuklab olish» jadvalidan olingan:
// id · elon · turkum · ishchi · telefon · summa · kelishuv · holat · yuborilgan.
// Filtr ekrandagi bilan BIR XIL (`appsFilter`) — "yuklab olish joriy
// filtrga bo'ysunadi" qoidasi shundan kelib chiqadi.
//
// Proyeksiya ro'yxat so'rovi bilan bir xil (`appRowProjection`): faylga
// faqat shu to'qqiz ustun kerak, qolgan maydonlar bazadan ham so'ralmaydi.
func (h *Handler) ExportApplications(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Apps.Find(ctx, appsFilter(r.URL.Query()),
		options.Find().
			SetProjection(appRowProjection).
			SetSort(bson.D{{Key: "appliedAt", Value: -1}}).
			SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "applications.csv")
	_ = cw.Write([]string{"id", "elon", "turkum", "ishchi", "telefon", "summa", "kelishuv", "holat", "yuborilgan"})
	qator := 0
	for cur.Next(ctx) {
		var a adminApplicationRow
		if cur.Decode(&a) != nil {
			continue
		}
		// Kelishiladigan arizada summa BO'SH qoladi (Figma 3.6a: "Raqam
		// yoki bo'sh"). Ilgari "0" yozilardi — jadval dasturida u "bepul
		// ish" bo'lib o'qilardi va yig'indini ham buzardi.
		summa := ""
		if !a.IsNegotiable {
			summa = strconv.FormatInt(a.Amount, 10)
		}
		_ = cw.Write([]string{
			a.ID.Hex(), csvCell(a.ElonTitle), csvCell(a.CategoryName),
			csvCell(a.WorkerName), csvCell(a.WorkerPhone),
			summa, strconv.FormatBool(a.IsNegotiable),
			csvCell(appStatusText(a.Status)), a.AppliedAt.Format(time.RFC3339),
		})
		qator++
	}
	cw.Flush()
	// Auditda ENDI ko'lam ham bor: qanday filtr bilan va necha qator
	// chiqib ketgani. Ilgari bo'sh satrlar yozilardi — "eksport bo'ldi"
	// degan yozuvdan "nima chiqib ketdi" degan savolga javob topilmasdi.
	h.audit(r, "export_applications", appsScope(r.URL.Query()), strconv.Itoa(qator)+" qator")
}
