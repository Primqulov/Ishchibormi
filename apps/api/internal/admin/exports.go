package admin

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const exportMax = 50000

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
	_ = cw.Write([]string{"id", "ism", "familiya", "telefon", "viloyat", "tuman", "reyting", "sharhlar", "bajarilganIsh", "tasdiqlangan", "bloklangan", "yaratilgan"})
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) != nil {
			continue
		}
		_ = cw.Write([]string{
			u.ID.Hex(), u.FirstName, u.LastName, u.Phone, u.Region, u.District,
			strconv.FormatFloat(u.Rating, 'f', 1, 64), strconv.Itoa(u.ReviewsCount),
			strconv.Itoa(u.CompletedJobsCount), strconv.FormatBool(u.IsPhoneVerified),
			strconv.FormatBool(u.IsBlocked), u.CreatedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_users", "", "")
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
			e.ID.Hex(), e.Title, e.CategoryName, e.Status, e.Region,
			strconv.Itoa(e.WorkersNeeded), strconv.FormatInt(e.PriceAmount, 10),
			e.OwnerName, strconv.Itoa(e.ViewsCount), e.CreatedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_elons", "", "")
}

// ExportApplications streams applications (same filters as ListApplications) as CSV.
func (h *Handler) ExportApplications(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Apps.Find(ctx, appsFilter(r.URL.Query()),
		options.Find().SetSort(bson.D{{Key: "appliedAt", Value: -1}}).SetLimit(exportMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	cw := csvDownload(w, "applications.csv")
	_ = cw.Write([]string{"id", "elon", "ishchi", "telefon", "summa", "kelishuv", "holat", "yuborilgan"})
	for cur.Next(ctx) {
		var a models.Application
		if cur.Decode(&a) != nil {
			continue
		}
		_ = cw.Write([]string{
			a.ID.Hex(), a.ElonTitle, a.WorkerName, a.WorkerPhone,
			strconv.FormatInt(a.Amount, 10), strconv.FormatBool(a.IsNegotiable),
			a.Status, a.AppliedAt.Format(time.RFC3339),
		})
	}
	cw.Flush()
	h.audit(r, "export_applications", "", "")
}
