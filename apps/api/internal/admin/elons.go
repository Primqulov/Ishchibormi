package admin

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
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

// elonStatusSettable — admin PANELIDAN qo'yilishi mumkin bo'lgan holatlar.
// Qolganlari (draft, in_progress, completed) e'lonning o'z hayotiy davri
// natijasi — ularni qo'lda qo'yish ishning haqiqiy borishini buzardi.
var elonStatusSettable = map[string]bool{
	"hidden": true, "recruiting": true, "filled": true, "cancelled": true,
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

// SetElonStatus hides (status=hidden) or restores (status=recruiting) an elon —
// lightweight moderation without deleting. isDeleted is left untouched.
//
// "recruiting" so'ralganda va e'lon YASHIRILGAN bo'lsa bu «Tiklash» amali:
// e'lon yashirishdan oldingi holatiga qaytadi (elonStatusUpdate ga qarang).
func (h *Handler) SetElonStatus(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if !elonStatusSettable[req.Status] {
		httpx.Err(w, httpx.NewError(400, "bad_status", "unsupported status"))
		return
	}

	var prev models.Elon
	if err := h.Elons.FindOne(r.Context(), bson.M{"_id": id}).Decode(&prev); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}
	// O'CHIRILGAN e'lon holati o'zgartirilmaydi.
	//
	// O'chirish qaytarilmaydigan amal, «Yashirish/Tiklash» esa qaytariladigan
	// — ikkisi aralashmasligi kerak. Aks holda «Tiklash» bosgan admin e'lonni
	// qaytardim deb o'ylardi, holbuki u `isDeleted` sababli foydalanuvchilarga
	// baribir ko'rinmaydi. Panel bu tugmalarni o'chirilgan qatorda umuman
	// chizmaydi (Figma 3.5a · 2); bu — server tomonidagi ikkinchi qulf.
	if prev.IsDeleted {
		httpx.Err(w, httpx.NewError(409, "elon_deleted",
			"o'chirilgan e'lon holatini o'zgartirib bo'lmaydi"))
		return
	}

	yangi, izoh := elonStatusUpdate(prev, req.Status)
	set := bson.M{"status": yangi, "updatedAt": time.Now()}
	upd := bson.M{"$set": set}
	if yangi == "hidden" {
		// Takroriy yashirishda eslatma YANGILANMAYDI: aks holda ikkinchi
		// bosishda u "hidden" ga aylanib, tiklash mumkin bo'lmasdi.
		if prev.Status != "hidden" {
			set["hiddenFromStatus"] = prev.Status
		}
	} else if prev.HiddenFromStatus != "" {
		// E'lon endi yashirilgan emas — eslatma keraksiz. Uni qoldirsak,
		// keyingi tiklash allaqachon eskirgan holatga qaytarardi.
		upd["$unset"] = bson.M{"hiddenFromStatus": ""}
	}
	if _, err := h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, upd); err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "elon_status", id.Hex(), izoh)
	httpx.JSON(w, 200, map[string]any{"ok": true, "status": yangi})
}

func (h *Handler) DeleteElon(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	mode, err := deleteMode(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if mode == deleteModePurge {
		if h.Purger == nil {
			httpx.Err(w, httpx.NewError(503, "purge_unavailable",
				"permanent deletion is not configured on this server"))
			return
		}
		// Audit AVVAL: o'chirilgandan keyin e'lon haqida hech narsa qolmaydi.
		h.audit(r, "elon_delete", id.Hex(), "purge — bazadan butunlay o'chirildi (qaytarib bo'lmaydi)")
		if err := h.Purger.PurgeElonNow(r.Context(), id); err != nil {
			httpx.Err(w, err)
			return
		}
		httpx.JSON(w, 200, map[string]any{"ok": true, "mode": deleteModePurge})
		return
	}

	var prev models.Elon
	_ = h.Elons.FindOne(r.Context(), bson.M{"_id": id}).Decode(&prev)
	_, err = h.Elons.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": bson.M{
		"isDeleted": true, "status": "cancelled", "deletedAt": time.Now(),
	}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	// Rasmlar yashirishda ham O'CHIRILADI, yozuvning o'zi qolsa ham.
	//
	// Sabab: rasm fayli ommaviy manzilda yotadi (/uploads/...). Uni qoldirish
	// "foydalanuvchilarga umuman ko'rinmasin" degan talabni buzardi — havolani
	// bir marta ko'rgan odam uni keyin ham ocha olaverardi. Ya'ni yozuv
	// yashirilgan bo'lsa-yu rasmi ochiq qolsa, yashirish yarim bo'lardi.
	//
	// Narxi bor: admin panelida yozuv rasmsiz ko'rinadi. Rasmni ham saqlab
	// qolish uchun uni ommaviy papkadan chiqarib, admin tokeni bilan
	// beriladigan alohida yo'l kerak bo'lardi — hozircha maxfiylik ustun
	// qo'yildi.
	for _, u := range prev.Images {
		go upload.DeleteByURL(h.Storage, u)
	}
	h.audit(r, "elon_delete", id.Hex(), "hidden — foydalanuvchilardan yashirildi, bazada qoldi")
	httpx.JSON(w, 200, map[string]any{"ok": true, "mode": deleteModeHidden})
}
