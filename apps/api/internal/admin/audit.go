package admin

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// actionCodeRe — jurnalga yoziladigan amal kodlarining butun alifbosi
// (`h.audit` chaqiruvlariga qarang: login_success, category_create, ...).
//
// Filtr qiymati tashqaridan keladi va to'g'ridan-to'g'ri Mongo filtriga
// tushadi. Bu yerda inyeksiya yo'q — qiymat satr sifatida taqqoslanadi, hech
// qachon operator bo'lib talqin qilinmaydi — lekin cheklovsiz maydon baribir
// keraksiz: kilobaytlik "amal kodi" faqat indeksni behuda tekshirtiradi.
// Shakli noto'g'ri bo'lsa 400 qaytaramiz, e'tiborsiz qoldirmaymiz: aks holda
// buzilgan chaqiruvchi filtrsiz — ya'ni BUTUN jurnalni — olib ketardi.
var actionCodeRe = regexp.MustCompile(`^[a-z0-9_][a-z0-9_.]{0,63}$`)

// targetNames jurnal qatorlaridagi `target` id'larini o'qiladigan yorliqqa
// aylantiradi: admin → `@username`, turkum → nomi. Qolganlari (foydalanuvchi,
// e'lon, ariza) ataylab id bo'lib qoladi — frontend ularni `…a1b2c3` ko'rinishida
// qisqartiradi.
//
// # NEGA SERVERDA
//
// Ilgari buni brauzer qilardi: sahifa ochilganda BUTUN admin ro'yxatini
// (`/admin/admins`) va turkumlarni tortib olib, o'zi moslashtirardi. Ikki
// kamchilik bor edi. Birinchisi — `/admin/admins` faqat superadmin uchun, ya'ni
// moderatorda bu qidiruv har doim bo'sh qaytardi va admin nishonlari abadiy
// `…a1b2c3` bo'lib qolardi. Ikkinchisi va muhimi — kosmetik yorliq uchun
// brauzerga butun xodimlar ro'yxati (login, rol, 2FA holati) yuborilardi.
// Bu yerda esa jurnalda ALLAQACHON turgan id'largina nomga aylanadi: yangi
// ma'lumot oshkor bo'lmaydi, so'rov esa sahifadagi ≤100 ta id bilan chegaralangan.
func (h *Handler) targetNames(ctx context.Context, targets map[string]struct{}) map[string]string {
	out := map[string]string{}
	ids := make([]primitive.ObjectID, 0, len(targets))
	for t := range targets {
		if oid, err := primitive.ObjectIDFromHex(t); err == nil {
			ids = append(ids, oid)
		}
	}
	if len(ids) == 0 {
		return out
	}
	in := bson.M{"_id": bson.M{"$in": ids}}

	if cur, err := h.Admins.Find(ctx, in, options.Find().SetProjection(bson.M{"username": 1})); err == nil {
		var list []models.Admin
		if cur.All(ctx, &list) == nil {
			for _, a := range list {
				if a.Username != "" {
					out[a.ID.Hex()] = "@" + a.Username
				}
			}
		}
	}
	if cur, err := h.Cats.Find(ctx, in, options.Find().SetProjection(bson.M{"name": 1})); err == nil {
		var list []models.Category
		if cur.All(ctx, &list) == nil {
			for _, c := range list {
				if c.Name != "" {
					out[c.ID.Hex()] = c.Name
				}
			}
		}
	}
	// Xatolik guruhi → `ERR-2F91C4`. Ref — aynan panelda ko'rinadigan yorliq,
	// ya'ni auditdagi yozuvni "Xatoliklar" ekranidagi qator bilan ko'z bilan
	// solishtirish mumkin bo'ladi. Yangi ma'lumot oshkor bo'lmaydi: xabar,
	// yo'l va daraja bu yerda so'ralmaydi.
	if cur, err := h.ErrGroups.Find(ctx, in, options.Find().SetProjection(bson.M{"ref": 1})); err == nil {
		var list []models.ErrorGroup
		if cur.All(ctx, &list) == nil {
			for _, g := range list {
				if g.Ref != "" {
					out[g.ID.Hex()] = g.Ref
				}
			}
		}
	}
	return out
}

// Audit: paginated admin action log. Query params:
//
//	page, limit, adminId, action, from (RFC3339), to (RFC3339)
//
// Faqat o'qish uchun: jurnalda yozuvni o'zgartiradigan yoki o'chiradigan yo'l
// yo'q, va marshrut `RequireRole("moderator")` ichida turadi (support ko'rmaydi).
func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	q := r.URL.Query()

	filter := bson.M{}
	if raw := strings.TrimSpace(q.Get("target")); raw != "" {
		id, err := primitive.ObjectIDFromHex(raw)
		if err != nil {
			httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_target", "invalid audit target"))
			return
		}
		filter["target"] = id.Hex()
	}
	if v := strings.TrimSpace(q.Get("adminId")); v != "" {
		if oid, err := primitive.ObjectIDFromHex(v); err == nil {
			filter["adminId"] = oid
		}
	}
	if v := strings.TrimSpace(q.Get("action")); v != "" {
		if !actionCodeRe.MatchString(v) {
			httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_action", "invalid action filter"))
			return
		}
		filter["action"] = v
	}
	rng := bson.M{}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$gte"] = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			rng["$lte"] = t
		}
	}
	if len(rng) > 0 {
		filter["createdAt"] = rng
	}

	cur, err := h.AuditCol.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	type auditRow struct {
		models.AdminAudit
		AdminName string `json:"adminName"`
		// TargetName — nishonning o'qiladigan nomi (@login yoki turkum nomi).
		// Topilmasa bo'sh: frontend o'shanda id'ni qisqartirib ko'rsatadi.
		TargetName string `json:"targetName,omitempty"`
	}
	rows := []auditRow{}
	idSet := map[primitive.ObjectID]struct{}{}
	targetSet := map[string]struct{}{}
	for cur.Next(ctx) {
		var a models.AdminAudit
		if err := cur.Decode(&a); err == nil {
			rows = append(rows, auditRow{AdminAudit: a})
			if !a.AdminID.IsZero() {
				idSet[a.AdminID] = struct{}{}
			}
			if a.Target != "" {
				targetSet[a.Target] = struct{}{}
			}
		}
	}
	// Resolve admin ids -> display name (name yoki username) in one query.
	names := map[primitive.ObjectID]string{}
	if len(idSet) > 0 {
		ids := make([]primitive.ObjectID, 0, len(idSet))
		for id := range idSet {
			ids = append(ids, id)
		}
		ac, err := h.Admins.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
		if err == nil {
			defer ac.Close(ctx)
			for ac.Next(ctx) {
				var a models.Admin
				if ac.Decode(&a) == nil {
					disp := a.Name
					if disp == "" {
						disp = a.Username
					}
					names[a.ID] = disp
				}
			}
		}
	}
	labels := h.targetNames(ctx, targetSet)
	for i := range rows {
		rows[i].AdminName = names[rows[i].AdminID]
		rows[i].TargetName = labels[rows[i].Target]
	}
	total, _ := h.AuditCol.CountDocuments(ctx, filter)
	paged(w, rows, page, limit, total)
}
