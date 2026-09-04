package admin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

/*
Bitta e'lonning BATAFSIL ko'rinishi — Figma "3.5.1 · E'lon — batafsil
(1440 × 2313)" sahifasi uchun yagona o'qish so'rovi.

# NEGA RO'YXAT JAVOBI YETMAYDI

`GET /api/admin/elons` faqat `models.Elon` hujjatlarini beradi. Sahifada
esa e'lonning o'zidan tashqari to'rtta boshqa manba ko'rinadi: egasi
(users), arizalar (applications), admin amallari (admin_audit) va
shikoyatlar (reports). Ularni panelning o'zi to'rtta alohida so'rov bilan
yig'sa, har biri yangi OMMAVIY filtr talab qilardi (`?elonId=`,
`?target=`, `?targetId=`) — ya'ni to'rtta yangi tashqi yuza va to'rtta
yangi xato yo'li. Bitta o'qish endpointi bog'lashni server ichida
qiladi: tashqi yuza kichik qoladi.

# NEGA OMMAVIY `GET /api/elons/{id}` YARAMAYDI

U moderatsiya uchun mo'ljallanmagan: o'chirilgan, yashirilgan, draft,
cancelled, completed yoki egasi bloklangan e'lonni 404 qiladi. Moderator
esa AYNAN shu e'lonlarni ko'rishi kerak — sahifa shikoyat va yashirish
qarorlarini tekshirish uchun ochiladi.

# NIMA ATAYLAB YO'Q

1) `json:"-"` maydonlari (`hiddenFromStatus`, `moderationPending`,
   `ownerBlocked`, `isReviewData`) bu javobga ham CHIQMAYDI. Ular ichki
   moderatsiya mexanizmi va Figma dizaynida ularga blok yo'q — mavjud
   yashirinlik darajasi bu endpoint bilan pasaymaydi.
2) Ariza qatorlarida ishchining TELEFONI yo'q. `models.Application` da u
   bor, lekin sahifada ko'rsatilmaydi, shuning uchun bazadan ham
   so'ralmaydi — o'qilmagan maydon oqib ketolmaydi. Kerak bo'lsa
   «Arizalar» bo'limi ochiladi.
3) E'lon egasi to'liq `models.User` sifatida QAYTMAYDI, faqat kartada
   ko'rinadigan maydonlar. To'liq profil `GET /admin/users/{id}` da va
   sahifadagi «Profilni ko'rish» havolasi o'sha yerga olib boradi.
4) Audit yozuvi (`h.audit`) YOZILMAYDI: bu o'qish amali va `GetUser` ham
   yozmaydi. Yozsak, `statusFromAudit` kabi filtrlar sahifani OCHISHNING
   o'zini "amal" deb sanab qolardi.

# ROL

Yo'l `RequireRole("moderator")` guruhida (cmd/api/main.go) — ya'ni
superadmin + moderator, `support` ko'rmaydi. Bu `GET /admin/users/{id}`
va `GET /admin/elons` bilan AYNAN bir xil daraja: yangi endpoint
mavjud ruxsat chizig'ini kengaytirmaydi.
*/

// maxElonDetailRows — javobdagi har bir ro'yxatning chegarasi.
// `GetUser` dagi 100 bilan bir xil: bu karta, tarix sahifasi emas.
const maxElonDetailRows = 100

// elonAuditActions — e'longa tegishli audit amallari. Ro'yxat YOPIQ:
// `export_elons` bu yerda yo'q, chunki u bitta e'longa tegishli emas
// (uning `target` i bo'sh).
var elonAuditActions = bson.A{"elon_status", "elon_delete"}

// Admin amali turlari. Panel har birini o'z nishoniga aylantiradi
// (apps/web/app/admin/elons/[id]/page.tsx · AMAL_TUR).
const (
	elonActionHidden   = "hidden"   // yashirildi
	elonActionRestored = "restored" // tiklandi
	elonActionStatus   = "status"   // boshqa holatga o'tkazildi
	elonActionDeleted  = "deleted"  // o'chirildi (bazada qoldi)
	elonActionPurged   = "purged"   // bazadan butunlay o'chirildi
)

// elonOwnerBrief — e'lonni joylashtirgan odam haqida SAHIFADA
// ko'rinadigan maydonlar, ortiqchasi emas (yuqoridagi 3-band).
type elonOwnerBrief struct {
	ID              primitive.ObjectID `json:"id"`
	FirstName       string             `json:"firstName"`
	LastName        string             `json:"lastName"`
	Phone           string             `json:"phone"`
	AvatarURL       string             `json:"avatarUrl,omitempty"`
	Region          string             `json:"region,omitempty"`
	District        string             `json:"district,omitempty"`
	IsPhoneVerified bool               `json:"isPhoneVerified"`
	IsBlocked       bool               `json:"isBlocked"`
	IsDeleted       bool               `json:"isDeleted"`
	CreatedAt       time.Time          `json:"createdAt"`
	// ElonsTotal / ElonsActive — «Jami e'lonlari» qatori.
	ElonsTotal  int64 `json:"elonsTotal"`
	ElonsActive int64 `json:"elonsActive"`
}

// elonApplicationRow — «Arizalar» bloki uchun bitta qator.
type elonApplicationRow struct {
	ID          primitive.ObjectID `bson:"_id" json:"id"`
	WorkerID    primitive.ObjectID `bson:"workerId" json:"workerId"`
	WorkerName  string             `bson:"workerName" json:"workerName,omitempty"`
	PeopleCount int                `bson:"peopleCount" json:"peopleCount"`
	Status      string             `bson:"status" json:"status"`
	AppliedAt   time.Time          `bson:"appliedAt" json:"appliedAt"`
	DecidedAt   *time.Time         `bson:"decidedAt" json:"decidedAt,omitempty"`
}

// elonReportRow — «Shikoyatlar» bloki uchun bitta qator.
type elonReportRow struct {
	ID          primitive.ObjectID `json:"id"`
	Reason      string             `json:"reason"`
	Description string             `json:"description,omitempty"`
	Status      string             `json:"status"`
	// ReporterName — shikoyat yozgan odamning ismi. Hisob o'chirilgan
	// bo'lsa bo'sh qoladi: yozuv qoladi, muallifi esa noma'lum.
	ReporterName string    `json:"reporterName,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// elonAdminAction — e'lon ustida bajarilgan bitta admin amali.
type elonAdminAction struct {
	// Kind — elonAction* dan biri. Nishon rangi va matni shundan.
	Kind string `json:"kind"`
	// Status — amaldan KEYINGI e'lon holati, aniqlansa. Panel shu orqali
	// «hozirgi holat» nishonini qo'yadi. Aniqlanmasa bo'sh — nishon
	// chizilmaydi, yozuv esa yo'qolmaydi.
	Status string    `json:"status,omitempty"`
	At     time.Time `json:"at"`
	// Detail — audit jurnalidagi izoh. U allaqachon o'zbekcha va inson
	// o'qiy oladigan matn (elonStatusUpdate, DeleteElon), shuning uchun
	// bu yerda qayta yozilmaydi.
	Detail string `json:"detail,omitempty"`
	// Actor — amalni bajargan adminning username'i (superadmin ko'rsa
	// roli ham, adminBrief.label). Bo'sh bo'lsa admin o'chirilgan.
	Actor string `json:"actor,omitempty"`
}

// elonActionFrom — audit yozuvini sahifadagi nishonga aylantiradi.
//
// Manba matnlari `elonStatusUpdate` va `DeleteElon` ichida yoziladi
// (elons.go) — ikkovi ham shu paketda, ya'ni matn o'zgarsa bu funksiya
// bilan birga o'zgaradi. Tanimagan shakl uchun holat BO'SH qoladi:
// yozuv baribir ko'rinadi, faqat «hozirgi holat» nishonisiz.
func elonActionFrom(action, detail string) (kind, status string) {
	switch action {
	case "elon_delete":
		if strings.HasPrefix(detail, "purge") {
			return elonActionPurged, ""
		}
		// «Yashirish» rejimidagi o'chirish holatni "cancelled" qiladi
		// (DeleteElon) — bu yozuvda ko'rsatilmagan, shuning uchun
		// shu yerda aytiladi.
		return elonActionDeleted, "cancelled"

	case "elon_status":
		switch {
		case strings.HasPrefix(detail, "hidden"):
			return elonActionHidden, "hidden"
		case strings.HasPrefix(detail, "tiklandi"):
			return elonActionRestored, elonRestoredStatus(detail)
		case elonStatusKnown[detail]:
			// `elonStatusUpdate` ning default tarmog'i: izoh = holat nomi.
			return elonActionStatus, detail
		}
		return elonActionStatus, ""
	}
	return "", ""
}

// elonRestoredStatus — «tiklandi — …» izohidan tiklangan holatni ajratadi.
// Ikki shakl bor: "… qaytarildi: filled" va "… eslab qolinmagan, recruiting".
func elonRestoredStatus(detail string) string {
	for _, sep := range []string{": ", ", "} {
		if i := strings.LastIndex(detail, sep); i >= 0 {
			if s := strings.TrimSpace(detail[i+len(sep):]); elonStatusKnown[s] {
				return s
			}
		}
	}
	return ""
}

// GetElon returns a single elon plus everything the moderation detail page
// shows: its owner (narrow projection), applications, admin actions taken on
// it and reports filed against it — in one round-trip.
func (h *Handler) GetElon(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var e models.Elon
	if err := h.Elons.FindOne(ctx, bson.M{"_id": id}).Decode(&e); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}

	// `any` ataylab: egasi topilmasa javobda `null` turishi kerak, bo'sh
	// obyekt emas. Bu bo'lishi mumkin — hisob butunlay o'chirilgan
	// bo'lsa e'londa faqat nusxa `ownerName` qoladi va panel shu holatni
	// aynan `null` orqali biladi.
	var owner any
	if b := h.elonOwner(ctx, e.OwnerID); b != nil {
		owner = b
	}

	httpx.JSON(w, 200, map[string]any{
		"elon":  e,
		"owner": owner,
		// Arizalar: qatorlar chegaralangan, sanoq esa TO'LIQ — kartadagi
		// «3 ta · 1 qabul qilingan» soni 100 tadan keyin ham to'g'ri
		// qolishi kerak.
		"applications":      h.elonApplications(ctx, id),
		"applicationCounts": h.elonAppCounts(ctx, id),
		"reports":           h.elonReports(ctx, id),
		// Rol faqat superadminga ko'rsatiladi (adminBrief.label izohi).
		"adminActions": h.elonAdminActions(ctx, id, httpx.AdminRole(r) == "superadmin"),
	})
}

// elonOwner — e'lon egasi haqidagi qisqa ma'lumot + uning e'lonlari soni.
//
// Proyeksiya ataylab qisqa: parol yo'q hisobda ham telegram id, bloklash
// tafsilotlari, qurilma tarixi va boshqalar bor — ular bu sahifada
// ko'rsatilmaydi, ya'ni bazadan ham so'ralmaydi.
func (h *Handler) elonOwner(ctx context.Context, ownerID primitive.ObjectID) *elonOwnerBrief {
	if ownerID.IsZero() || h.Users == nil {
		return nil
	}
	var u models.User
	err := h.Users.FindOne(ctx, bson.M{"_id": ownerID},
		options.FindOne().SetProjection(bson.M{
			"firstName": 1, "lastName": 1, "phone": 1, "avatarUrl": 1,
			"region": 1, "district": 1, "isPhoneVerified": 1,
			"isBlocked": 1, "isDeleted": 1, "createdAt": 1,
		})).Decode(&u)
	if err != nil {
		return nil
	}
	b := &elonOwnerBrief{
		ID: u.ID, FirstName: u.FirstName, LastName: u.LastName,
		Phone: u.Phone, AvatarURL: u.AvatarURL,
		Region: u.Region, District: u.District,
		IsPhoneVerified: u.IsPhoneVerified, IsBlocked: u.IsBlocked,
		IsDeleted: u.IsDeleted, CreatedAt: u.CreatedAt,
	}
	if h.Elons == nil {
		return b
	}
	// «Jami» — o'chirilmagan e'lonlar.
	//
	// «Faol» ta'rifi: o'chirilmagan VA holati recruiting/filled/in_progress,
	// ya'ni ish hali yakunlanmagan. Ta'rif sahifadagi izohda ham aytiladi,
	// chunki "faol" so'zi o'zicha noaniq va admin uni holat filtri bilan
	// solishtirishi kerak bo'ladi. `{ownerId:1, status:1}` indeksi bor.
	if total, err := h.Elons.CountDocuments(ctx, bson.M{
		"ownerId": ownerID, "isDeleted": bson.M{"$ne": true},
	}); err == nil {
		b.ElonsTotal = total
	}
	if active, err := h.Elons.CountDocuments(ctx, bson.M{
		"ownerId": ownerID, "isDeleted": bson.M{"$ne": true},
		"status": bson.M{"$in": bson.A{"recruiting", "filled", "in_progress"}},
	}); err == nil {
		b.ElonsActive = active
	}
	return b
}

// elonApplications — shu e'longa tushgan arizalar, yangisidan boshlab.
func (h *Handler) elonApplications(ctx context.Context, elonID primitive.ObjectID) []elonApplicationRow {
	out := []elonApplicationRow{}
	if h.Apps == nil {
		return out
	}
	cur, err := h.Apps.Find(ctx, bson.M{"elonId": elonID},
		options.Find().
			SetSort(bson.D{{Key: "appliedAt", Value: -1}}).
			SetLimit(maxElonDetailRows).
			SetProjection(bson.M{
				"workerId": 1, "workerName": 1, "peopleCount": 1,
				"status": 1, "appliedAt": 1, "decidedAt": 1,
			}))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a elonApplicationRow
		if cur.Decode(&a) == nil {
			out = append(out, a)
		}
	}
	h.fillWorkerNames(ctx, out)
	return out
}

// fillWorkerNames — arizada saqlanmagan ismlarni users dan to'ldiradi.
//
// # NEGA KERAK
//
// `workerName` ariza YOZILGAN paytda nusxalanadi
// (internal/application/handler.go). Ya'ni u maydon eski arizalarda,
// migratsiyadan oldin tushgan arizalarda va urug'lantirilgan (seed)
// ma'lumotlarda bo'sh bo'ladi. Bo'sh qoldirilsa, panelda ism o'rnida
// «Ismsiz ishchi» turadi va moderator arizani ishchi bilan bog'lay
// olmaydi — ya'ni blok o'z vazifasini bajarmaydi.
//
// # NIMA ATAYLAB YO'Q
//
// Telefon SO'RALMAYDI. Bu blok «kim ariza berdi» degan savolga javob
// beradi, aloqa ma'lumoti esa «Arizalar» bo'limining ishi — bir joyda
// kerak bo'lmagan PII ni ko'rsatmaslik uchun proyeksiya ataylab tor.
//
// So'rov BITTA: hamma yetishmayotgan id `$in` bilan bir marta olinadi,
// aks holda 100 qatorli e'lon 100 ta so'rovga aylanardi.
func (h *Handler) fillWorkerNames(ctx context.Context, rows []elonApplicationRow) {
	if h.Users == nil {
		return
	}
	kerak := make([]primitive.ObjectID, 0, len(rows))
	korilgan := map[primitive.ObjectID]bool{}
	for _, r := range rows {
		if strings.TrimSpace(r.WorkerName) != "" || r.WorkerID.IsZero() {
			continue
		}
		if korilgan[r.WorkerID] {
			continue
		}
		korilgan[r.WorkerID] = true
		kerak = append(kerak, r.WorkerID)
	}
	if len(kerak) == 0 {
		return
	}
	cur, err := h.Users.Find(ctx, bson.M{"_id": bson.M{"$in": kerak}},
		options.Find().SetProjection(bson.M{"firstName": 1, "lastName": 1}))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	ismlar := map[primitive.ObjectID]string{}
	for cur.Next(ctx) {
		var u struct {
			ID        primitive.ObjectID `bson:"_id"`
			FirstName string             `bson:"firstName"`
			LastName  string             `bson:"lastName"`
		}
		if cur.Decode(&u) == nil {
			if ism := strings.TrimSpace(u.FirstName + " " + u.LastName); ism != "" {
				ismlar[u.ID] = ism
			}
		}
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].WorkerName) == "" {
			// Hisob o'chirilgan bo'lsa xaritada yo'q — ism bo'sh qoladi va
			// panel «Ismsiz ishchi» deb ko'rsatadi. Bu halol javob.
			rows[i].WorkerName = ismlar[rows[i].WorkerID]
		}
	}
}

// elonAppCounts — arizalarning holat bo'yicha TO'LIQ sanog'i.
//
// Nega qatorlardan sanalmaydi: qatorlar 100 ta bilan chegaralangan, sanoq
// esa kartaning sarlavhasida turadi va u yerda yarim haqiqat yolg'ondan
// yomonroq. `{elonId:1, status:1}` indeksi bor (pkg/db/indexes.go:37),
// ya'ni guruhlash indeks bo'yicha ketadi.
func (h *Handler) elonAppCounts(ctx context.Context, elonID primitive.ObjectID) map[string]int {
	out := map[string]int{}
	if h.Apps == nil {
		return out
	}
	cur, err := h.Apps.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"elonId": elonID}}},
		{{Key: "$group", Value: bson.M{"_id": "$status", "count": bson.M{"$sum": 1}}}},
	})
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var row struct {
			ID    string `bson:"_id"`
			Count int    `bson:"count"`
		}
		if cur.Decode(&row) == nil && row.ID != "" {
			out[row.ID] = row.Count
		}
	}
	return out
}

// elonReports — shu e'lon ustidan tushgan shikoyatlar, yangisidan boshlab.
func (h *Handler) elonReports(ctx context.Context, elonID primitive.ObjectID) []elonReportRow {
	out := []elonReportRow{}
	if h.Reports == nil {
		return out
	}
	rows := decodeReports(ctx, h.Reports,
		bson.M{"targetType": "elon", "targetId": elonID}, maxElonDetailRows)
	ids := map[primitive.ObjectID]bool{}
	for _, rep := range rows {
		if !rep.ReporterID.IsZero() {
			ids[rep.ReporterID] = true
		}
	}
	// Bitta so'rov: bir e'lon ustidan bir necha odam yozgan bo'lishi
	// odatiy hol, har biriga alohida so'rov behuda.
	users := loadUserMap(ctx, h.Users, ids)
	for _, rep := range rows {
		nom := ""
		if u, ok := users[rep.ReporterID]; ok {
			nom = strings.TrimSpace(u.FirstName + " " + u.LastName)
		}
		out = append(out, elonReportRow{
			ID: rep.ID, Reason: rep.Reason, Description: rep.Description,
			Status: rep.Status, ReporterName: nom, CreatedAt: rep.CreatedAt,
		})
	}
	return out
}

// elonAdminActions — audit jurnalidagi shu e'longa tegishli amallar.
//
// `showRoles` — natijada admin roli ko'rsatilsinmi (faqat superadmin
// uchun; sababi adminBrief.label izohida).
func (h *Handler) elonAdminActions(
	ctx context.Context,
	elonID primitive.ObjectID,
	showRoles bool,
) []elonAdminAction {
	out := []elonAdminAction{}
	if h.AuditCol == nil {
		return out
	}
	// `target` audit yozuvida HEX satr sifatida saqlanadi (Handler.audit),
	// shuning uchun solishtirish ham satr bo'yicha.
	cur, err := h.AuditCol.Find(ctx,
		bson.M{"target": elonID.Hex(), "action": bson.M{"$in": elonAuditActions}},
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}}).
			SetLimit(maxElonDetailRows))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)

	rows := []models.AdminAudit{}
	adminIDs := map[primitive.ObjectID]bool{}
	for cur.Next(ctx) {
		var a models.AdminAudit
		if cur.Decode(&a) != nil {
			continue
		}
		rows = append(rows, a)
		if !a.AdminID.IsZero() {
			adminIDs[a.AdminID] = true
		}
	}

	briefs := h.adminBriefs(ctx, adminIDs)
	for _, a := range rows {
		kind, status := elonActionFrom(a.Action, a.Detail)
		if kind == "" {
			continue
		}
		out = append(out, elonAdminAction{
			Kind:   kind,
			Status: status,
			At:     a.CreatedAt,
			Detail: a.Detail,
			Actor:  briefs[a.AdminID].label(showRoles),
		})
	}
	return out
}
