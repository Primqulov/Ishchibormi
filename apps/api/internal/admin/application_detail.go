package admin

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

/*
Bitta arizaning BATAFSIL ko'rinishi — Figma "3.6.1 · Ariza — batafsil
(1440 × 2847)" sahifasi uchun yagona o'qish so'rovi.

# NEGA RO'YXAT JAVOBI YETMAYDI

`GET /api/admin/applications` faqat jadvalda chizilgan to'qqiz maydonni
qaytaradi (`appRowProjection`). Batafsil sahifada esa arizadan tashqari
uchta boshqa manba ko'rinadi: ishchi (users), e'lon va uning egasi
(elons + users) hamda shu ishchining boshqa arizalari (applications).
Panel ularni to'rtta alohida so'rov bilan yig'sa, har biri yangi OMMAVIY
filtr talab qilardi (`?workerId=`, `?elonId=`) — ya'ni to'rtta yangi
tashqi yuza. Bitta o'qish endpointi bog'lashni server ichida qiladi.

# BU YO'L FAQAT `GET`

Figma 3.6.1a · 7-panel: «bu sahifa arizani KO'RSATADI, unga TA'SIR
QILMAYDI». Arizani tasdiqlash, rad etish, izoh yozish yoki o'chirish
admin ishi emas — holatni ishchi va ish beruvchi o'zgartiradi. Shuning
uchun bu faylda birorta yozuv amali yo'q va router'da ham faqat `GET`
qayd etilgan (cmd/api/main.go).

# NIMA ATAYLAB YO'Q

 1. Ishchi va e'lon egasi TO'LIQ `models.User` sifatida qaytmaydi, faqat
    kartada ko'rinadigan maydonlar (`GetElon` bilan bir xil qoida).
    To'liq profil `GET /admin/users/{id}` da va sahifadagi «Ishchi
    profili» havolasi o'sha yerga olib boradi.
 2. Audit yozuvi (`h.audit`) YOZILMAYDI: bu o'qish amali, `GetElon` va
    `GetUser` ham yozmaydi. Figma 3.6.1 · 8-bo'lim izohi ham shuni
    aytadi: «Admin arizani ochib ko'rgani jurnalga yozilmaydi».
 3. Namoyish (`isReviewData`) arizasi TOPILMAYDI — ro'yxatdagi
    `appsBase()` bilan bir xil. Ro'yxatda ko'rinmagan yozuv manzil
    orqali ochilib qolsa, sanoqlar bilan sahifa bir-biriga zid
    bo'lardi.

# ROL

Yo'l `RequireRole("moderator")` guruhida — superadmin + moderator,
`support` ko'rmaydi (Figma 3.6.1a · 6 · rol matritsasi). `journal`
esa faqat superadminga to'ldiriladi: o'sha matritsada «8 · Jurnal
kartochkasi» qatori moderator uchun «Yo'q».
*/

// maxWorkerApplicationRows — «Shu ishchining boshqa arizalari» jadvalidagi
// BOSHQA arizalar soni. Joriy ariza ustiga qo'shiladi, ya'ni jadvalda
// ko'pi bilan olti qator bo'ladi. Bu karta, tarix sahifasi emas: to'liq
// ro'yxat «Barchasini ko'rish» havolasida.
const maxWorkerApplicationRows = 5

// appJournalKind* — jurnal yozuvining turi. Panel har birini o'z nishoniga
// aylantiradi (apps/web/app/admin/applications/[id]/page.tsx · JURNAL_TUR).
const (
	appJournalCreated   = "created"   // ishchi ariza yubordi
	appJournalAccepted  = "accepted"  // ish beruvchi qabul qildi
	appJournalRejected  = "rejected"  // ish beruvchi rad etdi
	appJournalCancelled = "cancelled" // ariza bekor qilindi
	appJournalCompleted = "completed" // ish yakunlandi
	appJournalAdmin     = "admin"     // admin amali (audit jurnalidan)
)

// appJournalSource* — yozuv QAYERDAN kelgani (Figma 3.6.1 · 8 · «Manba»).
const (
	appSourceApp    = "app"    // ishchi/ish beruvchining o'z amali
	appSourceAdmin  = "admin"  // admin panelidagi amal
	appSourceSystem = "system" // tizim o'zi qilgan (avto-yakunlash)
)

// appJournalAuditActions — jurnalga TUSHADIGAN audit amallari.
//
// Ro'yxat YOPIQ va ataylab tor: bu yerga faqat arizaning taqdiriga
// ta'sir qila oladigan amallar kiradi. E'lon yashirilgani «kutilmoqda»
// bo'lib qotib qolgan arizani tushuntiradi, ishchining bloklangani ham
// shunday.
//
// `export_applications` ATAYLAB YO'Q: uning `target` i bitta ariza emas,
// filtr satri (`appsScope`). Uni shu arizaning jurnaliga qo'shsak,
// aslida bu qatorni o'z ichiga olmagan eksport ham "shu ariza eksport
// qilindi" bo'lib ko'rinardi — ya'ni jurnal yolg'on gapirardi.
var appJournalAuditActions = map[string]string{
	"elon_status":  "E'lon holati o'zgartirildi",
	"elon_delete":  "E'lon o'chirildi",
	"user_block":   "Ishchi bloklandi",
	"user_unblock": "Ishchi blokdan chiqarildi",
	"user_delete":  "Ishchi hisobi o'chirildi",
}

// appWorkerBrief — arizani yuborgan ishchi haqida SAHIFADA ko'rinadigan
// maydonlar (Figma 3.6.1 · 2-bo'lim), ortiqchasi emas.
type appWorkerBrief struct {
	ID              primitive.ObjectID `json:"id"`
	FirstName       string             `json:"firstName"`
	LastName        string             `json:"lastName"`
	Phone           string             `json:"phone"`
	Region          string             `json:"region,omitempty"`
	District        string             `json:"district,omitempty"`
	IsPhoneVerified bool               `json:"isPhoneVerified"`
	IsBlocked       bool               `json:"isBlocked"`
	IsDeleted       bool               `json:"isDeleted"`
	CreatedAt       time.Time          `json:"createdAt"`
	// CompletedJobsCount — «Bajargan ishlari» qatori.
	CompletedJobsCount int `json:"completedJobsCount"`
	// ApplicationsTotal — «Jami arizalari». Jadvaldagi qatorlardan
	// hisoblab bo'lmaydi: u yerda ko'pi bilan oltitasi bor.
	ApplicationsTotal int64 `json:"applicationsTotal"`
}

// appElonBrief — ariza yuborilgan e'lon (Figma 3.6.1 · 4-bo'lim).
//
// Arizada e'lonning nusxasi bor (`elonTitle`, `elonCategoryName`,
// `elonRegion`), lekin u ariza TUSHGAN paytdagi holat. Sahifadagi izoh
// aynan buni va'da qiladi: «E'lon o'zgarsa, bu blok ham yangilanadi —
// nusxa saqlanmaydi». Shuning uchun blok e'lonning o'zidan o'qiladi.
type appElonBrief struct {
	ID              primitive.ObjectID `json:"id"`
	Title           string             `json:"title"`
	Status          string             `json:"status"`
	IsDeleted       bool               `json:"isDeleted"`
	CategoryName    string             `json:"categoryName,omitempty"`
	Region          string             `json:"region,omitempty"`
	District        string             `json:"district,omitempty"`
	LocationText    string             `json:"locationText,omitempty"`
	WorkersNeeded   int                `json:"workersNeeded"`
	AcceptedCount   int                `json:"acceptedCount"`
	PricingType     string             `json:"pricingType,omitempty"`
	PriceAmount     int64              `json:"priceAmount"`
	PerWorkerAmount int64              `json:"perWorkerAmount"`
	PublishedAt     *time.Time         `json:"publishedAt,omitempty"`
	CreatedAt       time.Time          `json:"createdAt"`
	// Egasi. `OwnerPhone` arizada saqlanmaydi (faqat `ownerName`), ya'ni
	// u har doim users dan o'qiladi — Figma «Ish beruvchi telefoni»
	// qatorini talab qiladi.
	OwnerID    primitive.ObjectID `json:"ownerId"`
	OwnerName  string             `json:"ownerName,omitempty"`
	OwnerPhone string             `json:"ownerPhone,omitempty"`
	// OwnerDeleted — egasining hisobi o'chirilgan. Panel telefon o'rniga
	// «Ish beruvchi o'chirilgan» izohini chiqaradi (Figma 3.6.1a · 4).
	OwnerDeleted bool `json:"ownerDeleted"`
}

// appWorkerAppRow — «Shu ishchining boshqa arizalari» jadvalining qatori.
// Ustunlari Figma 3.6.1 · 7 dagi beshta ustun bilan aynan bir xil.
type appWorkerAppRow struct {
	ID           primitive.ObjectID `bson:"_id" json:"id"`
	ElonID       primitive.ObjectID `bson:"elonId" json:"elonId"`
	ElonTitle    string             `bson:"elonTitle" json:"elonTitle"`
	CategoryName string             `bson:"elonCategoryName" json:"categoryName"`
	Amount       int64              `bson:"amount" json:"amount"`
	IsNegotiable bool               `bson:"isNegotiable" json:"isNegotiable"`
	Status       string             `bson:"status" json:"status"`
	AppliedAt    time.Time          `bson:"appliedAt" json:"appliedAt"`
}

// appJournalRow — jurnaldagi bitta yozuv (Figma 3.6.1 · 8-bo'lim).
type appJournalRow struct {
	Kind string    `json:"kind"`
	At   time.Time `json:"at"`
	// Actor — kim bajargani. Bo'sh bo'lsa panel «Tizim» deb ko'rsatadi.
	Actor string `json:"actor,omitempty"`
	// ActorRole — «ishchi» / «ish beruvchi» / admin roli. Yorliq
	// ko'rinishida: "Sardor Qodirov · ishchi".
	ActorRole string `json:"actorRole,omitempty"`
	Source    string `json:"source"`
	// Detail — qo'shimcha izoh (bekor qilish sababi, audit izohi).
	Detail string `json:"detail,omitempty"`
}

// GetApplication returns one application plus everything the admin detail page
// shows: the worker, the elon with its owner, the elon's application counts,
// the worker's other applications and — for superadmins — a journal.
func (h *Handler) GetApplication(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}

	// `appsBase()` — ro'yxat bilan AYNAN bir xil ko'rish maydoni: namoyish
	// arizasi bu yerda ham yo'q.
	filter := appsBase()
	filter["_id"] = id
	var a models.Application
	if err := h.Apps.FindOne(ctx, filter).Decode(&a); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "application not found"))
		return
	}

	// `any` ataylab: topilmasa javobda `null` turishi kerak, bo'sh obyekt
	// emas. Ikkalasi ham bo'lishi mumkin — hisob butunlay o'chirilgan
	// bo'lsa arizada faqat nusxa `workerName` qoladi, e'lon bazadan
	// o'chirilgan bo'lsa esa `elonTitle`. Panel shu holatni aynan `null`
	// orqali biladi va Figma 3.6.1a dagi «e'lon o'chirilgan» ko'rinishiga
	// o'tadi.
	var worker any
	if b := h.appWorker(ctx, a.WorkerID); b != nil {
		worker = b
	}
	var elon any
	if b := h.appElon(ctx, a.ElonID); b != nil {
		elon = b
	}

	httpx.JSON(w, 200, map[string]any{
		"application": a,
		"worker":      worker,
		"elon":        elon,
		// E'londagi arizalar taqsimoti — «3 ta (1 kutilmoqda · 1
		// bajarilgan · 1 bekor qilingan)» qatori. `GetElon` bilan bitta
		// funksiya.
		"elonApplicationCounts": h.elonAppCounts(ctx, a.ElonID),
		"workerApplications":    h.workerApplications(ctx, a),
		// Rol faqat superadminga: Figma 3.6.1a · 6 · rol matritsasi.
		"journal": h.appJournal(ctx, a, httpx.AdminRole(r) == "superadmin"),
	})
}

// appWorker — arizani yuborgan ishchi + uning arizalari soni.
//
// Proyeksiya ataylab qisqa (elonOwner bilan bir xil qoida): parolsiz
// hisobda ham telegram id, blok tafsilotlari, qurilma tarixi bor — ular
// bu sahifada ko'rsatilmaydi, ya'ni bazadan ham so'ralmaydi.
func (h *Handler) appWorker(ctx context.Context, workerID primitive.ObjectID) *appWorkerBrief {
	if workerID.IsZero() || h.Users == nil {
		return nil
	}
	var u models.User
	err := h.Users.FindOne(ctx, bson.M{"_id": workerID},
		options.FindOne().SetProjection(bson.M{
			"firstName": 1, "lastName": 1, "phone": 1,
			"region": 1, "district": 1, "isPhoneVerified": 1,
			"isBlocked": 1, "isDeleted": 1, "createdAt": 1,
			"completedJobsCount": 1,
		})).Decode(&u)
	if err != nil {
		return nil
	}
	b := &appWorkerBrief{
		ID: u.ID, FirstName: u.FirstName, LastName: u.LastName,
		Phone: u.Phone, Region: u.Region, District: u.District,
		IsPhoneVerified: u.IsPhoneVerified, IsBlocked: u.IsBlocked,
		IsDeleted: u.IsDeleted, CreatedAt: u.CreatedAt,
		CompletedJobsCount: u.CompletedJobsCount,
	}
	if h.Apps != nil {
		f := appsBase()
		f["workerId"] = workerID
		if n, err := h.Apps.CountDocuments(ctx, f); err == nil {
			b.ApplicationsTotal = n
		}
	}
	return b
}

// appElon — ariza yuborilgan e'lon va uning egasi.
//
// Egasi uchun ALOHIDA so'rov: `elon.ownerName` nusxasi e'lon
// yaratilgandagi ism, telefon esa u yerda umuman yo'q. Figma «Ish
// beruvchi telefoni» qatorini talab qiladi va u aloqa uchun ishlatiladi
// — ya'ni eskirgan nusxa emas, hozirgi qiymat kerak.
func (h *Handler) appElon(ctx context.Context, elonID primitive.ObjectID) *appElonBrief {
	if elonID.IsZero() || h.Elons == nil {
		return nil
	}
	var e models.Elon
	err := h.Elons.FindOne(ctx, bson.M{"_id": elonID},
		options.FindOne().SetProjection(bson.M{
			"title": 1, "status": 1, "isDeleted": 1, "categoryName": 1,
			"region": 1, "district": 1, "locationText": 1,
			"workersNeeded": 1, "acceptedCount": 1,
			"pricingType": 1, "priceAmount": 1, "perWorkerAmount": 1,
			"publishedAt": 1, "createdAt": 1,
			"ownerId": 1, "ownerName": 1,
		})).Decode(&e)
	if err != nil {
		return nil
	}
	b := &appElonBrief{
		ID: e.ID, Title: e.Title, Status: e.Status, IsDeleted: e.IsDeleted,
		CategoryName: e.CategoryName, Region: e.Region, District: e.District,
		LocationText:  e.LocationText,
		WorkersNeeded: e.WorkersNeeded, AcceptedCount: e.AcceptedCount,
		PricingType: e.PricingType, PriceAmount: e.PriceAmount,
		PerWorkerAmount: e.PerWorkerAmount,
		PublishedAt:     e.PublishedAt, CreatedAt: e.CreatedAt,
		OwnerID: e.OwnerID, OwnerName: strings.TrimSpace(e.OwnerName),
	}
	if e.OwnerID.IsZero() || h.Users == nil {
		return b
	}
	var u models.User
	if err := h.Users.FindOne(ctx, bson.M{"_id": e.OwnerID},
		options.FindOne().SetProjection(bson.M{
			"firstName": 1, "lastName": 1, "phone": 1, "isDeleted": 1,
		})).Decode(&u); err != nil {
		// Hujjat butunlay yo'q — hisob bazadan o'chirilgan. Nusxa ism
		// qoladi, telefon esa yo'q va panel buni ochiq aytadi.
		b.OwnerDeleted = true
		return b
	}
	if ism := strings.TrimSpace(u.FirstName + " " + u.LastName); ism != "" {
		b.OwnerName = ism
	}
	b.OwnerDeleted = u.IsDeleted
	// O'chirilgan hisobda telefon bo'shatiladi (internal/account.softDelete),
	// ya'ni bu yerda baribir bo'sh satr keladi — qo'shimcha shart shart emas.
	b.OwnerPhone = u.Phone
	return b
}

// workerApplications — shu ishchining oxirgi arizalari, JORIYSI bilan birga.
//
// # NEGA JORIYSI ALOHIDA QO'SHILADI
//
// Figma 3.6.1 · 7 da joriy ariza jadvalda «Hozirgi sahifa» chipi bilan
// turadi — u qatorlar orasidagi o'rnini ko'rsatadi. Oddiy "oxirgi 6 ta"
// so'rovi buni kafolatlamaydi: ishchi keyin yana o'nta ariza yuborgan
// bo'lsa, joriy ariza ro'yxatga tushmasdi va admin "bu ariza qayerda?"
// degan savol bilan qolardi. Shuning uchun boshqalari `_id != joriy`
// bilan olinadi va joriysi ustiga qo'shiladi.
func (h *Handler) workerApplications(ctx context.Context, a models.Application) []appWorkerAppRow {
	joriy := appWorkerAppRow{
		ID: a.ID, ElonID: a.ElonID, ElonTitle: a.ElonTitle,
		CategoryName: a.ElonCategoryName, Amount: a.Amount,
		IsNegotiable: a.IsNegotiable, Status: a.Status, AppliedAt: a.AppliedAt,
	}
	out := []appWorkerAppRow{joriy}
	if h.Apps == nil || a.WorkerID.IsZero() {
		return out
	}
	f := appsBase()
	f["workerId"] = a.WorkerID
	f["_id"] = bson.M{"$ne": a.ID}
	cur, err := h.Apps.Find(ctx, f,
		options.Find().
			SetSort(bson.D{{Key: "appliedAt", Value: -1}}).
			SetLimit(maxWorkerApplicationRows).
			SetProjection(bson.M{
				"elonId": 1, "elonTitle": 1, "elonCategoryName": 1,
				"amount": 1, "isNegotiable": 1, "status": 1, "appliedAt": 1,
			}))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var row appWorkerAppRow
		if cur.Decode(&row) == nil {
			out = append(out, row)
		}
	}
	// Yangisidan boshlab — jadval sarlavhasi «Yuborilgan» ustuni bo'yicha
	// kamayish tartibida chizilgan.
	sort.SliceStable(out, func(i, j int) bool { return out[i].AppliedAt.After(out[j].AppliedAt) })
	return out
}

// appJournal — arizaning hayotidagi hodisalar, eskisidan boshlab.
//
// # NEGA IKKI MANBA
//
// Figma 3.6.1 · 8 jadvalida ikki xil qator bor: foydalanuvchi amallari
// («Ariza yaratildi», «Ish beruvchi javob berdi») va admin amallari.
// Birinchisi audit jurnalida UMUMAN yo'q — uni ilova yozmaydi, chunki
// hodisaning o'zi arizaning maydonlarida turibdi (`appliedAt`,
// `decidedAt`, `completedAt`, `cancelledBy`). Shuning uchun jurnal shu
// ikki manbadan yig'iladi: arizaning O'Z vaqt belgilaridan va
// `admin_audit` dagi shu e'lon/ishchiga tegishli yozuvlardan.
//
// Ya'ni bu yerda hech narsa TAXMIN qilinmaydi: har bir qator ostida yo
// arizadagi aniq vaqt belgisi, yo audit yozuvi turadi.
func (h *Handler) appJournal(ctx context.Context, a models.Application, super bool) []appJournalRow {
	out := []appJournalRow{}
	if !super {
		return out
	}

	ishchi := strings.TrimSpace(a.WorkerName)
	beruvchi := strings.TrimSpace(a.OwnerName)

	out = append(out, appJournalRow{
		Kind: appJournalCreated, At: a.AppliedAt,
		Actor: ishchi, ActorRole: "ishchi", Source: appSourceApp,
	})

	if a.DecidedAt != nil {
		switch a.Status {
		// `completed` ham SHU yerda: bajarilgan ariza avval qabul
		// qilingan bo'ladi va `decidedAt` aynan o'sha paytni saqlaydi.
		// Faqat `accepted` ni qarasak, jurnal "yaratildi → bajarildi"
		// bo'lib chiqardi — qabul qilish hodisasi (va uni kim
		// qilgani) yozuvda turgani holda ekrandan tushib qolardi.
		case "accepted", "completed":
			out = append(out, appJournalRow{
				Kind: appJournalAccepted, At: *a.DecidedAt,
				Actor: beruvchi, ActorRole: "ish beruvchi", Source: appSourceApp,
			})
		case "rejected":
			out = append(out, appJournalRow{
				Kind: appJournalRejected, At: *a.DecidedAt,
				Actor: beruvchi, ActorRole: "ish beruvchi", Source: appSourceApp,
				Detail: a.CancelReason,
			})
		case "cancelled":
			// `cancelledBy` — "worker" yoki "employer". Boshqa qiymat
			// yozilmaydi, lekin bo'sh bo'lishi mumkin (eski yozuvlar):
			// unda kim bekor qilgani KO'RSATILMAYDI, taxmin qilinmaydi.
			kim, rol := "", ""
			switch a.CancelledBy {
			case "worker":
				kim, rol = ishchi, "ishchi"
			case "employer":
				kim, rol = beruvchi, "ish beruvchi"
			}
			out = append(out, appJournalRow{
				Kind: appJournalCancelled, At: *a.DecidedAt,
				Actor: kim, ActorRole: rol, Source: appSourceApp,
				Detail: a.CancelReason,
			})
		}
	}

	if a.CompletedAt != nil {
		// Avto-yakunlash (internal/application/autocomplete.go) — odam
		// emas, jadval qildi. Ikkisini ajratmasak, jurnal ish beruvchi
		// tasdiqlagandek ko'rinardi.
		manba, kim, rol := appSourceApp, beruvchi, "ish beruvchi"
		if a.AutoCompleted {
			manba, kim, rol = appSourceSystem, "", ""
		}
		out = append(out, appJournalRow{
			Kind: appJournalCompleted, At: *a.CompletedAt,
			Actor: kim, ActorRole: rol, Source: manba,
		})
	}

	out = append(out, h.appAuditRows(ctx, a)...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// appAuditRows — `admin_audit` dan shu arizaga daxldor amallar.
//
// Nishon (`target`) HEX satr sifatida saqlanadi (Handler.audit), shuning
// uchun solishtirish satr bo'yicha. Ikki nishon qaraladi: arizaning
// e'loni va uni yuborgan ishchi — `appJournalAuditActions` izohiga qarang.
func (h *Handler) appAuditRows(ctx context.Context, a models.Application) []appJournalRow {
	out := []appJournalRow{}
	if h.AuditCol == nil {
		return out
	}
	nishon := bson.A{}
	if !a.ElonID.IsZero() {
		nishon = append(nishon, a.ElonID.Hex())
	}
	if !a.WorkerID.IsZero() {
		nishon = append(nishon, a.WorkerID.Hex())
	}
	if len(nishon) == 0 {
		return out
	}
	amallar := bson.A{}
	for k := range appJournalAuditActions {
		amallar = append(amallar, k)
	}
	cur, err := h.AuditCol.Find(ctx,
		bson.M{
			"target": bson.M{"$in": nishon},
			"action": bson.M{"$in": amallar},
			// Ariza tushishidan OLDINGI amallar bu arizaga daxlsiz: o'shanda
			// u hali mavjud emas edi. Ularni ko'rsatish jurnalni chalg'ituvchi
			// qilardi — masalan bir yil oldingi blok.
			"createdAt": bson.M{"$gte": a.AppliedAt},
		},
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
		var r models.AdminAudit
		if cur.Decode(&r) != nil {
			continue
		}
		rows = append(rows, r)
		if !r.AdminID.IsZero() {
			adminIDs[r.AdminID] = true
		}
	}

	// Rol KO'RSATILADI: bu ro'yxat faqat superadminga chiziladi
	// (appJournal boshidagi qorovul), ya'ni `adminBrief.label` izohidagi
	// cheklov allaqachon bajarilgan.
	briefs := h.adminBriefs(ctx, adminIDs)
	for _, r := range rows {
		matn, ok := appJournalAuditActions[r.Action]
		if !ok {
			continue
		}
		out = append(out, appJournalRow{
			Kind: appJournalAdmin, At: r.CreatedAt,
			Actor: briefs[r.AdminID].label(true), Source: appSourceAdmin,
			// Izoh backend yozgan o'zbekcha matn (elons.go, users.go) —
			// bu yerda qayta yozilmaydi. `matn` esa qaysi amal ekanini
			// aytadi: audit izohi buni har doim ham aytmaydi.
			Detail: strings.TrimSpace(matn + appJournalDetailSep(r.Detail) + r.Detail),
		})
	}
	return out
}

// appJournalDetailSep — audit izohi bo'sh bo'lsa ajratgich ham chizilmaydi.
func appJournalDetailSep(detail string) string {
	if strings.TrimSpace(detail) == "" {
		return ""
	}
	return " — "
}
