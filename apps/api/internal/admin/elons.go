package admin

import (
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// elonsFilter is shared by ListElons and the elons CSV export.
// Params: q (title), status, region, categoryId.
func elonsFilter(q url.Values) bson.M {
	// O'chirilganlar ham ko'rinadi — `?deleted=` bilan ajratiladi.
	filter := bson.M{}
	applyDeletedFilter(filter, q.Get("deleted"))
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		filter["title"] = bson.M{"$regex": escRe(s), "$options": "i"}
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		filter["status"] = status
	}
	if region := strings.TrimSpace(q.Get("region")); region != "" {
		filter["region"] = region
	}
	if cat := strings.TrimSpace(q.Get("categoryId")); cat != "" {
		if oid, err := primitive.ObjectIDFromHex(cat); err == nil {
			filter["categoryId"] = oid
		}
	}
	// moderationPending=1 — AI kvotasi tugagan (yoki xizmat uzilgan) paytda
	// TEKSHIRILMASDAN chop etilgan e'lonlar. Ularni qo'lda ko'rib chiqish
	// uchun shu filtr kerak: aks holda ular oddiy e'lonlar orasida
	// yo'qolib ketardi.
	switch q.Get("moderationPending") {
	case "1", "true":
		filter["moderationPending"] = true
	case "0", "false":
		filter["moderationPending"] = bson.M{"$ne": true}
	}
	return filter
}

// ListElons: paginated + filterable. Query params:
//
//	page, limit, q (title), status, categoryId, region,
//	moderationPending=1|0 (AI tekshiruvidan o'tmagan e'lonlar)
func (h *Handler) ListElons(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	filter := elonsFilter(r.URL.Query())

	cur, err := h.Elons.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []models.Elon{}
	for cur.Next(ctx) {
		var e models.Elon
		if err := cur.Decode(&e); err == nil {
			out = append(out, e)
		}
	}
	total, _ := h.Elons.CountDocuments(ctx, filter)
	paged(w, out, page, limit, total)
}

// elonStatusKnown — bazada uchraydigan BARCHA e'lon holatlari
// (models.Elon.Status).
//
// `hiddenFromStatus` dan tiklashda oq ro'yxat sifatida ishlatiladi: bazadagi
// qiymat buzilgan yoki eskirgan bo'lsa, e'lon tushunarsiz holatga o'tib
// ketmasligi kerak.
var elonStatusKnown = map[string]bool{
	"draft": true, "recruiting": true, "filled": true, "in_progress": true,
	"completed": true, "cancelled": true, "hidden": true,
}

// Hidden has a separate confirmation. The other five statuses are deliberate,
// reasoned choices in the detail status sheet; draft remains unavailable.
var elonStatusSettable = map[string]bool{
	"hidden": true, "recruiting": true, "filled": true, "in_progress": true,
	"completed": true, "cancelled": true,
}

type elonStatusRequest struct {
	Status            string     `json:"status"`
	Reason            string     `json:"reason"`
	NotifyOwner       *bool      `json:"notifyOwner"`
	ExpectedStatus    string     `json:"expectedStatus"`
	ExpectedUpdatedAt *time.Time `json:"expectedUpdatedAt"`
}

func elonAdminAllowed(r *http.Request) bool {
	return httpx.AdminID(r) != "" && (httpx.AdminRole(r) == "superadmin" || httpx.AdminRole(r) == "moderator")
}

func elonChangedError() error {
	return httpx.NewError(http.StatusConflict, "state_changed", "E'lon holati o'zgargan — sahifani yangilang")
}

func (req *elonStatusRequest) validate(prev models.Elon) error {
	if !elonStatusSettable[req.Status] {
		return httpx.NewError(400, "bad_status", "unsupported status")
	}
	if (req.ExpectedStatus != "" && req.ExpectedStatus != prev.Status) ||
		(req.ExpectedUpdatedAt != nil && !req.ExpectedUpdatedAt.Equal(prev.UpdatedAt)) {
		return elonChangedError()
	}
	if prev.IsDeleted {
		return httpx.NewError(409, "elon_deleted", "o'chirilgan e'lon holatini o'zgartirib bo'lmaydi")
	}
	if prev.Status == "hidden" && req.Status != "hidden" && req.Status != "recruiting" {
		return httpx.NewError(409, "elon_hidden", "yashirilgan e'lonni avval tiklang")
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if utf8.RuneCountInString(req.Reason) > 500 {
		return httpx.NewError(400, "reason_too_long", "sabab 500 belgidan oshmasligi kerak")
	}
	if req.Status != "hidden" && prev.Status != "hidden" && req.Reason == "" {
		return httpx.NewError(400, "reason_required", "holatni o'zgartirish sababi majburiy")
	}
	return nil
}

// Fences slow owner edits across hide/restore, including an ABA status cycle.
func elonModerationFilter(e models.Elon) bson.M {
	return bson.M{
		"_id": e.ID, "status": e.Status, "isDeleted": bson.M{"$ne": true},
		"$expr": bson.M{"$eq": bson.A{bson.M{"$ifNull": bson.A{"$ownerRevision", 0}}, e.OwnerRevision}},
	}
}

func elonModerationTime(e models.Elon) time.Time {
	now := time.Now().UTC().Truncate(time.Millisecond)
	if !now.After(e.UpdatedAt) {
		return e.UpdatedAt.UTC().Truncate(time.Millisecond).Add(time.Millisecond)
	}
	return now
}

// elonStatusUpdate — so'ralgan holatdan HAQIQIY yangi holatni hisoblaydi va
// audit uchun izoh qaytaradi.
//
// # NEGA TIKLASH ALOHIDA HISOBLANADI
//
// Figma "3.5a · E'lonlar — holatlar, amallar va oynalar", 3-panel:
// «Yashirish ↔ Tiklash» — yagona QAYTARILADIGAN moderatsiya amali.
// Qaytariladigan bo'lishi uchun oldingi holat eslab qolinishi shart, chunki
// yashirish `status` ni "hidden" bilan almashtiradi.
//
// Ilgari «Tiklash» har doim "recruiting" qo'yardi. Bu ma'lumotni buzardi:
// boshlanib ketgan (in_progress) yoki yakunlangan (completed) ish qaytadan
// ommaviy feedga chiqib, yangi ariza qabul qila boshlardi — ya'ni amal
// "qaytarish" emas, "boshqa holatga o'tkazish" edi.
func elonStatusUpdate(prev models.Elon, want string) (status, detail string) {
	switch {
	case want == "hidden":
		if prev.Status == "hidden" {
			return "hidden", "hidden — allaqachon yashirilgan edi"
		}
		return "hidden", "hidden — foydalanuvchilardan yashirildi (oldingi holat: " + prev.Status + ")"

	case want == "recruiting" && prev.Status == "hidden":
		// Eslab qolingan qiymat yo'q bo'lishi mumkin: bu maydon paydo
		// bo'lishidan OLDIN yashirilgan e'lonlarda u umuman yozilmagan.
		// Bunda eski xulqqa qaytamiz — "recruiting".
		if s := prev.HiddenFromStatus; s != "hidden" && elonStatusKnown[s] {
			return s, "tiklandi — oldingi holatiga qaytarildi: " + s
		}
		return "recruiting", "tiklandi — oldingi holat eslab qolinmagan, recruiting"

	default:
		return want, want
	}
}
