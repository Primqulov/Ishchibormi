package admin

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/errlog"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// "3.12.1 · Xatolik — batafsil" ekranining ma'lumotlari.
//
// # NEGA BITTA SO'ROV
//
// Sahifada oltita blok bor: grafik, so'nggi hodisalar, ta'sir taqsimoti,
// ta'sirlangan foydalanuvchilar, muhit va so'rov ma'lumotlari. Ularning
// har biri uchun alohida endpoint qilsak, bitta ekran ochilishi olti marta
// autentifikatsiyadan o'tib, olti marta bir xil guruhni o'qirdi. Bu yerda
// esa guruh bir marta topiladi va qolgani uning fingerprint'i bo'yicha
// hisoblanadi.
const (
	// errRecentLimit — "So'nggi hodisalar" jadvalidagi qatorlar soni.
	errRecentLimit = 8
	// errUsersLimit — "Ta'sirlangan foydalanuvchilar" ro'yxati.
	errUsersLimit = 5
	// errShareLimit — taqsimotda ALOHIDA, o'z nomi bilan ko'rsatiladigan
	// ustunlar soni. Undan keyingi qiymatlar kesib tashlanmaydi: ular bitta
	// "Boshqa" qatoriga yig'iladi, foizlar esa butun kesimga nisbatan olinadi.
	//
	// NEGA 5: kartada JAMI oltita qator sig'adi (Figma 3.12.3 · K ·
	// "Qurilma brendi": 41+30+11+9+5+4 = 100%), oxirgisi esa "Boshqa".
	// Ya'ni nomli qatorlarga beshtasi qoladi — 6 qilsak, dumi bor kesim
	// kartadan chiqib ketadigan yettinchi qatorni qaytarardi.
	errShareLimit = 5
	// errShareOther — o'sha qoldiq qatorining yorlig'i (Figma 3.12.3 · K).
	errShareOther = "Boshqa"
	// errWindow — grafik va taqsimot oynasi.
	errWindow = 24 * time.Hour
	// errImpactWindow — ta'sir taqsimoti oynasi. Grafikdan uzunroq: 24
	// soatda bitta brend bo'yicha ma'lumot ko'pincha yetarli bo'lmaydi.
	errImpactWindow = 30 * 24 * time.Hour
)

type errBucket struct {
	At time.Time `json:"at"`
	N  int64     `json:"n"`
}

type errShare struct {
	Key string `json:"key"`
	N   int64  `json:"n"`
	Pct int    `json:"pct"`
	// Other — bu qator kesimning DUMI ("Boshqa"), nomli qiymat emas.
	//
	// NEGA ALOHIDA BAYROQ: yorliqning o'zi ("Boshqa") panelda oddiy
	// qiymatdan farq qilmaydi va "Eski versiyalarda uchraydi" kabi
	// mantiqlar uni ilova versiyasi deb o'qib, adminga "1.4.1, Boshqa da
	// uchraydi" degan ma'nosiz matnni chizardi. Mashina o'qiydigan belgi
	// bilan mijoz dumni ishonchli chetlab o'tadi — yorliq matniga
	// (va uning tarjimasiga) bog'lanib qolmaydi.
	Other bool `json:"other,omitempty"`
}

type errImpact struct {
	Brand []errShare `json:"brand"`
	OS    []errShare `json:"os"`
	App   []errShare `json:"app"`
}

// errRecent — "So'nggi hodisalar" jadvalining bitta qatori.
type errRecent struct {
	At         time.Time `json:"at"`
	User       string    `json:"user"`
	Platform   string    `json:"platform"`
	App        string    `json:"app"`
	Network    string    `json:"network"`
	Status     string    `json:"status"`
	DurationMs int       `json:"durationMs,omitempty"`
	RequestID  string    `json:"requestId,omitempty"`
}

// errSampleView — "Stack trace · so'nggi hodisa" va o'ng ustundagi ikki blok.
type errSampleView struct {
	At          time.Time          `json:"at"`
	Device      models.ErrorDevice `json:"device"`
	DeviceLabel string             `json:"deviceLabel,omitempty"`
	Message     string             `json:"message,omitempty"`
	Stack       []string           `json:"stack,omitempty"`
	Steps       []models.ErrorStep `json:"steps,omitempty"`
	Method      string             `json:"method,omitempty"`
	Path        string             `json:"path,omitempty"`
	Status      int                `json:"status,omitempty"`
	DurationMs  int                `json:"durationMs,omitempty"`
	RequestID   string             `json:"requestId,omitempty"`
	Actor       string             `json:"actor,omitempty"`
	ActorRole   string             `json:"actorRole,omitempty"`
}

// errUser — "Ta'sirlangan foydalanuvchilar" qatori. Telefon HAR DOIM
// niqoblangan: xatolik jurnali orqali raqamlar bazasini yig'ib bo'lmasligi
// kerak. To'liq raqam faqat "Foydalanuvchilar" sahifasida, o'z RBAC va o'z
// audit izi bilan ko'rinadi.
type errUser struct {
	ID    string `json:"id,omitempty"`
	Label string `json:"label"`
	Sub   string `json:"sub,omitempty"`
	Count int64  `json:"count"`
	Admin bool   `json:"admin,omitempty"`
}

type errDetail struct {
	Group models.ErrorGroup `json:"group"`
	// Env — serverning o'z muhiti ("Qurilma va muhit" kartasidagi alohida
	// "Server muhiti" bloki). Panel uni QURILMA maydonlaridan ajratib
	// chizadi: qiymat hodisa kelgan telefonga emas, uni qabul qilgan
	// jarayonga tegishli. Guruhga bog'liq emas, lekin ayni shu ekranda kerak.
	Env    map[string]string `json:"env"`
	Hourly []errBucket       `json:"hourly"`
	Peak   errBucket         `json:"peak"`
	Recent []errRecent       `json:"recent"`
	Sample *errSampleView    `json:"sample,omitempty"`
	Impact errImpact         `json:"impact"`
	Users  []errUser         `json:"users"`
	// SamplesTotal — qancha to'liq namuna saqlanib turibdi. Panelda
	// "20 tadan ortig'i saqlanmaydi" izohini ko'rsatish uchun.
	SamplesTotal int64 `json:"samplesTotal"`
	// SinceStarted — "Boshlanganidan beri N ta yangi hodisa"
	// (Figma 3.12.3 · J). Group.Count bu savolga javob bermaydi: unda
	// tuzatish boshlangunga qadar to'plangan hamma narsa bor, ya'ni
	// "ish qanday ketyapti" degan savol ostida o'sha eski qoldiq turadi.
	// StartedAt bo'lmasa maydon umuman yuborilmaydi.
	//
	// NEGA KO'RSATKICH: omitempty int64 uchun NOLNI ham tashlab yuboradi,
	// nol esa bu yerdagi eng muhim IJOBIY javob — "ish boshlandi, o'shandan
	// beri bitta ham yangi hodisa yo'q". Maydon tushib qolsa panel uni
	// "startedAt yo'q" bilan bir xil, ya'ni "aniqlanmagan" deb chizadi va
	// yaxshi xabar nosozlik belgisiga aylanadi. Ko'rsatkich bilan
	// "startedAt bo'lmasa yuborilmaydi" kelishuvi saqlanadi, 0 esa yetadi.
	SinceStarted *int64 `json:"sinceStarted,omitempty"`
}

// GetError: GET /admin/errors/{id}.
func (h *Handler) GetError(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	g, err := h.errGroup(ctx, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	now := time.Now()
	out := errDetail{
		Group:  *g,
		Env:    h.errEnv(),
		Hourly: h.errHourly(ctx, g.Fingerprint, now),
	}
	// Taqsimot va "boshlanganidan beri" sanog'i bitta so'rovdan qaytadi:
	// manba bir xil kolleksiya, faqat oyna boshqa (errImpact izohiga qarang).
	out.Impact, out.SinceStarted = h.errImpact(ctx, g.Fingerprint, now.Add(-errImpactWindow), g.StartedAt)
	for _, b := range out.Hourly {
		if b.N > out.Peak.N {
			out.Peak = b
		}
	}

	samples := h.errSamples(ctx, g.Fingerprint, errRecentLimit)
	out.SamplesTotal, _ = h.ErrSamples.CountDocuments(ctx, bson.M{"fingerprint": g.Fingerprint})
	names := h.sampleActors(ctx, samples)
	for _, s := range samples {
		out.Recent = append(out.Recent, recentRow(s, names))
	}
	if len(samples) > 0 {
		out.Sample = sampleView(samples[0], names)
	}
	if out.Recent == nil {
		out.Recent = []errRecent{}
	}
	out.Users = h.errUsers(ctx, samples, names)

	httpx.JSON(w, http.StatusOK, out)
}

// ErrorEvents: GET /admin/errors/{id}/events — "Barchasini ko'rish".
// Saqlanib turgan namunalar (≤ errlog.maxSamples), eng yangisidan.
func (h *Handler) ErrorEvents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	g, err := h.errGroup(ctx, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	page, limit, skip := pageParams(r)
	cur, ferr := h.ErrSamples.Find(ctx, bson.M{"fingerprint": g.Fingerprint},
		options.Find().SetSort(bson.D{{Key: "at", Value: -1}}).SetSkip(skip).SetLimit(int64(limit)))
	if ferr != nil {
		httpx.Err(w, ferr)
		return
	}
	defer cur.Close(ctx)
	var samples []models.ErrorSample
	if err := cur.All(ctx, &samples); err != nil {
		httpx.Err(w, err)
		return
	}
	names := h.sampleActors(ctx, samples)
	rows := []errRecent{}
	for _, s := range samples {
		rows = append(rows, recentRow(s, names))
	}
	total, _ := h.ErrSamples.CountDocuments(ctx, bson.M{"fingerprint": g.Fingerprint})
	paged(w, rows, page, limit, total)
}

// errGroup — id bo'yicha guruh. Xato holatida tayyor httpx xatosi qaytadi.
func (h *Handler) errGroup(ctx context.Context, hex string) (*models.ErrorGroup, error) {
	id, err := primitive.ObjectIDFromHex(hex)
	if err != nil {
		return nil, httpx.NewError(http.StatusBadRequest, "bad_id", "invalid id")
	}
	var g models.ErrorGroup
	switch err := h.ErrGroups.FindOne(ctx, bson.M{"_id": id}).Decode(&g); err {
	case nil:
		return &g, nil
	case mongo.ErrNoDocuments:
		return nil, httpx.NewError(http.StatusNotFound, "not_found", "error group not found")
	default:
		return nil, err
	}
}

// errEnv — serverning o'z muhiti. Faqat NOMLAR va bayroqlar: sir, ulanish
// satri va token bu yerga hech qachon tushmaydi.
func (h *Handler) errEnv() map[string]string {
	return map[string]string{
		"appEnv":  h.Cfg.AppEnv,
		"version": buildVersion,
		// server — javobni AYNAN qaysi mashina bergani. Bir nechta nusxa
		// ishlaganda "xatolik hammasidami yoki bittasidami" degan savolga
		// faqat shu qator javob beradi.
		"server": serverHost(),
	}
}

// serverHost — jarayon ishlab turgan mashina nomi ("Qurilma va muhit"
// kartasidagi "Server muhiti" blokining "Server" qatori, Figma 3.12.3 · M).
//
// Qiymat sync.Once bilan BIR MARTA o'qiladi: host nomi jarayon umri
// davomida o'zgarmaydi, os.Hostname() esa har chaqiruvda tizimga boradi —
// batafsil ekran va kontekst eksporti uni tez-tez so'raydi.
//
// Xato yutiladi va bo'sh satr qoladi: host nomini bilmaslik xatolik
// sahifasini ochilmaydigan qilib qo'ymasligi kerak, panel bo'sh qiymatni
// o'zi "aniqlanmagan" deb chizadi.
func serverHost() string {
	serverHostOnce.Do(func() { serverHostName, _ = os.Hostname() })
	return serverHostName
}

var (
	serverHostOnce sync.Once
	serverHostName string
)

// buildVersion — `-ldflags "-X ...buildVersion=<sha>"` bilan to'ldiriladi
// (Figma 3.12.3 · M: "Backend versiyasi / git SHA — Yo'q"). To'ldirilmasa
// panelda "aniqlanmagan" ko'rinadi: bo'sh katak emas.
var buildVersion = ""

// errHourly — oxirgi 24 soatning soatlik ustunlari.
//
// Guruhlash Mongo tomonida bajariladi: hodisalar hujjatlari ko'p bo'lishi
// mumkin (har 3 soniyalik oynaga bittadan), ularni Go'ga tortib olish
// shunchaki trafik. `$toLong` + `$mod` sanani soatga yaxlitlaydi va
// `$dateTrunc` dan farqli o'laroq eski Mongo versiyalarida ham ishlaydi.
func (h *Handler) errHourly(ctx context.Context, fp string, now time.Time) []errBucket {
	const hourMs = int64(3600_000)
	since := now.Add(-errWindow).Truncate(time.Hour)
	out := make([]errBucket, 0, 25)
	counts := map[int64]int64{}

	agg, err := h.ErrEvents.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{"fingerprint": fp, "at": bson.M{"$gte": since}}}},
		bson.D{{Key: "$group", Value: bson.M{
			"_id": bson.M{"$subtract": bson.A{
				bson.M{"$toLong": "$at"},
				bson.M{"$mod": bson.A{bson.M{"$toLong": "$at"}, hourMs}},
			}},
			"n": bson.M{"$sum": "$n"},
		}}},
	})
	if err == nil {
		var rows []struct {
			ID int64 `bson:"_id"`
			N  int64 `bson:"n"`
		}
		if agg.All(ctx, &rows) == nil {
			for _, r := range rows {
				counts[r.ID] = r.N
			}
		}
	}
	for t := since; !t.After(now); t = t.Add(time.Hour) {
		ms := t.UnixMilli() - t.UnixMilli()%hourMs
		out = append(out, errBucket{At: time.UnixMilli(ms).UTC(), N: counts[ms]})
	}
	return out
}

// errImpact — "Ta'sir taqsimoti" (Figma 3.12.3 · K): brend, OS va ilova
// versiyasi kesimida. Hodisalar bo'yicha hisoblanadi (namunalar bo'yicha
// emas), ya'ni foizlar butun oqimni aks ettiradi — ko'rinadigan olti
// ustunni emas: kesimning dumi ham "Boshqa" qatori bo'lib qaytadi va
// foizlar KESIMNING to'liq yig'indisiga nisbatan olinadi.
//
// Ikkinchi qaytadigan qiymat — "Boshlanganidan beri N ta yangi hodisa"
// (Figma 3.12.3 · J). U ATAYLAB shu yerdagi $facet ichida hisoblanadi:
// manba bir xil kolleksiya, faqat oyna boshqa, ya'ni alohida so'rov
// batafsil ekranga bittayam yangi ma'lumot bermay, yana bitta aylanma
// yo'l qo'shardi. StartedAt bo'lmasa tarmoq umuman qurilmaydi va sanoq
// o'rniga nil qaytadi — "hisoblanmadi" bilan "nolta yangi hodisa" ni
// ajratadigan yagona narsa shu (errDetail.SinceStarted izohiga qarang).
func (h *Handler) errImpact(ctx context.Context, fp string, since time.Time, startedAt *time.Time) (errImpact, *int64) {
	var out errImpact
	// Tashqi $match ikkala hisobning eng eskisiga tortiladi: tuzatish
	// ta'sir oynasidan (30 kun) oldinroq boshlangan bo'lsa, "boshlanganidan
	// beri" sanog'i shu chegarada kesilib qolmasin. Taqsimotning o'z oynasi
	// esa har bir tarmoq ichida qaytadan qo'yiladi.
	from := since
	if startedAt != nil && startedAt.Before(from) {
		from = *startedAt
	}
	facet := bson.M{
		"brand": shareStage("$brand", since),
		"os":    shareStage("$os", since),
		"app":   shareStage("$appVersion", since),
	}
	if startedAt != nil {
		facet["since"] = bson.A{
			bson.M{"$match": bson.M{"at": bson.M{"$gte": *startedAt}}},
			// Hujjatlar emas, `n` yig'indisi: recorder bir necha soniyalik
			// oynadagi takrorlanishlarni bitta hujjatga yig'adi, ya'ni
			// CountDocuments haqiqiy sondan kam ko'rsatardi.
			bson.M{"$group": bson.M{"_id": nil, "n": bson.M{"$sum": "$n"}}},
		}
	}
	agg, err := h.ErrEvents.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{"fingerprint": fp, "at": bson.M{"$gte": from}}}},
		bson.D{{Key: "$facet", Value: facet}},
	})
	if err != nil {
		return out, nil
	}
	var rows []struct {
		Brand []shareFacet `bson:"brand"`
		OS    []shareFacet `bson:"os"`
		App   []shareFacet `bson:"app"`
		Since []struct {
			N int64 `bson:"n"`
		} `bson:"since"`
	}
	if agg.All(ctx, &rows) != nil || len(rows) == 0 {
		return out, nil
	}
	out.Brand = shares(rows[0].Brand)
	out.OS = shares(rows[0].OS)
	out.App = shares(rows[0].App)
	var sinceStarted *int64
	if startedAt != nil {
		// Bo'sh tarmoq — bu XATO emas, javob: $group boshlanishdan keyin
		// bironta hodisa bo'lmasa umuman hujjat qaytarmaydi. Shuning uchun
		// startedAt bor ekan, sanoq har doim yuboriladi — nol bo'lsa ham.
		var n int64
		if v := rows[0].Since; len(v) > 0 {
			n = v[0].N
		}
		sinceStarted = &n
	}
	return out, sinceStarted
}

type shareRow struct {
	ID string `bson:"_id"`
	N  int64  `bson:"n"`
}

// shareFacet — bitta kesimning natijasi: ko'rinadigan bosh qismi (Top) va
// BUTUN kesimning yig'indisi (Total). Ikkalasi birga keladi, chunki foiz
// kesilgan ro'yxatga emas, to'liq yig'indiga nisbatan hisoblanadi.
type shareFacet struct {
	Top   []shareRow `bson:"top"`
	Total int64      `bson:"total"`
}

// shareStage — bitta kesim bo'yicha taqsimot bosqichlari.
//
// # NEGA $limit EMAS
//
// $limit dumni butunlay tashlab yuborardi: qolgan olti qator o'zaro
// bo'linib, foizlar yolg'on 100% ga yig'ilardi va "yana kimdir bor" degan
// ma'lumot hech qayerda ko'rinmasdi. Shuning uchun saralangan qatorlar
// avval bitta hujjatga yig'iladi ($push), keyin $slice bosh qismini
// kesib beradi — butun yig'indi esa yonida turadi. Ichma-ich $facet
// Mongo'da taqiqlangani uchun ikkalasi aynan shu ko'rinishda birlashadi.
func shareStage(field string, since time.Time) bson.A {
	return bson.A{
		// Bo'sh qiymat taqsimotga kirmaydi: "" nomli ustun foizni
		// buzardi va hech narsani anglatmasdi. `at` chegarasi bu yerda
		// takrorlanadi, chunki tashqi $match "boshlanganidan beri"
		// sanog'i uchun ta'sir oynasidan kengroq bo'lishi mumkin.
		bson.M{"$match": bson.M{
			"at":                           bson.M{"$gte": since},
			strings.TrimPrefix(field, "$"): bson.M{"$nin": bson.A{nil, ""}},
		}},
		bson.M{"$group": bson.M{"_id": field, "n": bson.M{"$sum": "$n"}}},
		bson.M{"$sort": bson.M{"n": -1}},
		bson.M{"$group": bson.M{
			"_id":   nil,
			"rows":  bson.M{"$push": "$$ROOT"},
			"total": bson.M{"$sum": "$n"},
		}},
		bson.M{"$project": bson.M{
			"total": 1,
			"top":   bson.M{"$slice": bson.A{"$rows", errShareLimit}},
		}},
	}
}

// shares — xom kesimni foizli qatorlarga aylantiradi.
//
// Foiz butun kesimga nisbatan olinadi, ko'rinadigan qatorlar yig'indisiga
// emas. Kesilgan dum yo'qolmaydi: undan ro'yxat oxirida bitta "Boshqa"
// qatori yasaladi (Figma 3.12.3 · K da ham aynan shunday — oxirgi ustun
// "Boshqa · 4%").
func shares(in []shareFacet) []errShare {
	out := []errShare{}
	if len(in) == 0 || in[0].Total <= 0 {
		return out
	}
	total := in[0].Total
	var shown int64
	for _, r := range in[0].Top {
		shown += r.N
		out = append(out, errShare{Key: r.ID, N: r.N, Pct: sharePct(r.N, total)})
	}
	if rest := total - shown; rest > 0 {
		// Other: true — qator dum ekanini mijozga YORLIQ MATNISIZ aytadi
		// (errShare.Other izohiga qarang).
		out = append(out, errShare{Key: errShareOther, N: rest, Pct: sharePct(rest, total), Other: true})
	}
	return out
}

// sharePct — foiz. total/2 qo'shimchasi butun bo'linmani pastga emas, eng
// yaqin butun songa yaxlitlaydi: aks holda kichik ustunlar doim 0% bo'lardi.
func sharePct(n, total int64) int {
	return int((n*100 + total/2) / total)
}

func (h *Handler) errSamples(ctx context.Context, fp string, n int64) []models.ErrorSample {
	cur, err := h.ErrSamples.Find(ctx, bson.M{"fingerprint": fp},
		options.Find().SetSort(bson.D{{Key: "at", Value: -1}}).SetLimit(n))
	if err != nil {
		return nil
	}
	defer cur.Close(ctx)
	var out []models.ErrorSample
	if cur.All(ctx, &out) != nil {
		return nil
	}
	return out
}

// actorInfo — namunadagi id'ning o'qiladigan ko'rinishi.
type actorInfo struct {
	Label string
	Role  string
	Sub   string
	Admin bool
}

// sampleActors — namunalardagi foydalanuvchi va admin id'larini ikkita
// so'rov bilan nomga aylantiradi.
//
// # NEGA ISM SAQLANMAYDI
//
// Namunada faqat ObjectID turadi. Ism va telefon `users`/`admins` dan
// O'QISH paytida olinadi — ya'ni foydalanuvchi hisobini o'chirsa yoki
// ismini o'zgartirsa, xatolik jurnali eski nusxani ushlab qolmaydi.
// Telefon esa har doim niqoblanadi (maskPhone).
func (h *Handler) sampleActors(ctx context.Context, ss []models.ErrorSample) map[primitive.ObjectID]actorInfo {
	out := map[primitive.ObjectID]actorInfo{}
	var users, admins []primitive.ObjectID
	for _, s := range ss {
		if !s.UserID.IsZero() {
			users = append(users, s.UserID)
		}
		if !s.AdminID.IsZero() {
			admins = append(admins, s.AdminID)
		}
	}
	if len(users) > 0 {
		cur, err := h.Users.Find(ctx, bson.M{"_id": bson.M{"$in": users}},
			options.Find().SetProjection(bson.M{"firstName": 1, "lastName": 1, "phone": 1}))
		if err == nil {
			var list []models.User
			if cur.All(ctx, &list) == nil {
				for _, u := range list {
					name := strings.TrimSpace(u.FirstName + " " + u.LastName)
					if name == "" {
						name = "Foydalanuvchi"
					}
					out[u.ID] = actorInfo{Label: name, Sub: maskPhone(u.Phone)}
				}
			}
		}
	}
	if len(admins) > 0 {
		cur, err := h.Admins.Find(ctx, bson.M{"_id": bson.M{"$in": admins}},
			options.Find().SetProjection(bson.M{"name": 1, "username": 1, "role": 1}))
		if err == nil {
			var list []models.Admin
			if cur.All(ctx, &list) == nil {
				for _, a := range list {
					name := a.Name
					if name == "" {
						name = "@" + a.Username
					}
					out[a.ID] = actorInfo{Label: name, Role: a.Role, Sub: a.Role, Admin: true}
				}
			}
		}
	}
	return out
}

// maskPhone — "+998901234542" → "+998 90 ••• •• 42".
//
// Niqob QAYTARIB BO'LMAYDI: o'rtadagi beshta raqam butunlay yo'qoladi.
// Qolgani odamni tanish uchun emas, ro'yxatdagi ikki qatorni bir-biridan
// ajratish uchun yetarli.
func maskPhone(p string) string {
	d := make([]rune, 0, len(p))
	for _, r := range p {
		if r >= '0' && r <= '9' {
			d = append(d, r)
		}
	}
	// NEGA 9: quyidagi kesimlar oxiridan sanaydi — operator kodi
	// d[len-9:len-7], abonent dumi d[len-2:]. Ya'ni arifmetika kamida
	// TO'QQIZTA raqamni talab qiladi (milliy format: "901234542", davlat
	// kodi bo'lsa head'ga tushadi). Qo'riqchi 7 bo'lganida 7–8 raqamli
	// yozuv manfiy indeksga tushib panika berardi, telefon esa bazadan
	// keladi va models.User.Phone da uzunlik cheklovi yo'q — bitta g'alati
	// yozuv butun "Xatolik — batafsil" sahifasini 500 ga tushirardi
	// (sahifadagi hamma blok bitta so'rovdan keladi).
	//
	// To'liq bo'lmagan raqam niqoblanmaydi, bo'sh satr qaytadi: Sub
	// omitempty, ya'ni ro'yxatda shunchaki ostki satr ko'rinmaydi.
	if len(d) < 9 {
		return ""
	}
	head := string(d[:len(d)-9])
	mid := string(d[len(d)-9 : len(d)-7])
	tail := string(d[len(d)-2:])
	s := ""
	if head != "" {
		s = "+" + head + " "
	}
	return s + mid + " ••• •• " + tail
}

func recentRow(s models.ErrorSample, names map[primitive.ObjectID]actorInfo) errRecent {
	row := errRecent{
		At:         s.At,
		Platform:   strings.TrimSpace(s.Device.OS + " " + s.Device.OSVersion),
		App:        s.Device.AppVersion,
		Network:    s.Device.Network,
		DurationMs: s.DurationMs,
		RequestID:  s.RequestID,
	}
	if row.Platform == "" {
		row.Platform = s.Device.Platform
	}
	if s.Device.Browser != "" {
		row.Platform = strings.TrimSpace(s.Device.Browser + " · " + row.Platform)
		if s.Device.AppVersion == "" {
			row.App = "web"
		}
	}
	if s.Status > 0 {
		row.Status = strconv.Itoa(s.Status)
	}
	switch id := actorOf(s); {
	case id.IsZero():
		row.User = ""
	default:
		if a, ok := names[id]; ok {
			row.User = a.Label
			if a.Role != "" {
				row.User += " · " + a.Role
			}
		}
	}
	// Kim ekani noma'lum bo'lsa ham hodisa yo'qolmaydi: hash bo'lsa,
	// undan qisqa yorliq yasaymiz. Bu "kim" degan javob emas — u faqat
	// "bir xil odammi yoki boshqami" degan savolga javob beradi.
	if row.User == "" && s.UserHash != "" {
		row.User = "#" + strings.ToUpper(s.UserHash[:6])
	}
	return row
}

func actorOf(s models.ErrorSample) primitive.ObjectID {
	if !s.AdminID.IsZero() {
		return s.AdminID
	}
	return s.UserID
}

func sampleView(s models.ErrorSample, names map[primitive.ObjectID]actorInfo) *errSampleView {
	v := &errSampleView{
		At:          s.At,
		Device:      s.Device,
		DeviceLabel: errlog.DeviceLabel(s.Device),
		Message:     s.Message,
		Stack:       s.Stack,
		Steps:       s.Steps,
		Method:      s.Method,
		Path:        s.Path,
		Status:      s.Status,
		DurationMs:  s.DurationMs,
		RequestID:   s.RequestID,
	}
	if a, ok := names[actorOf(s)]; ok {
		v.Actor = a.Label
		v.ActorRole = a.Role
	}
	return v
}

// errUsers — "Ta'sirlangan foydalanuvchilar".
//
// Ro'yxat NAMUNALAR bo'yicha tuziladi (guruhda ≤ 20 ta), umumiy son esa
// guruhning `usersCount` maydonidan olinadi. Panelda ular alohida
// ko'rsatiladi: "Barchasi (N)" — haqiqiy son, ro'yxat esa saqlanib turgan
// namunalar kesimi. Aks holda "5 foydalanuvchi" deb yozib, uchtasini
// ko'rsatgan bo'lardik.
func (h *Handler) errUsers(_ context.Context, ss []models.ErrorSample, names map[primitive.ObjectID]actorInfo) []errUser {
	type acc struct {
		errUser
		n int64
	}
	order := []primitive.ObjectID{}
	seen := map[primitive.ObjectID]*acc{}
	for _, s := range ss {
		id := actorOf(s)
		if id.IsZero() {
			continue
		}
		a := seen[id]
		if a == nil {
			info := names[id]
			label := info.Label
			if label == "" {
				label = "…" + id.Hex()[18:]
			}
			a = &acc{errUser: errUser{ID: id.Hex(), Label: label, Sub: info.Sub, Admin: info.Admin}}
			seen[id] = a
			order = append(order, id)
		}
		a.n++
	}
	out := []errUser{}
	for _, id := range order {
		if len(out) >= errUsersLimit {
			break
		}
		a := seen[id]
		a.Count = a.n
		out = append(out, a.errUser)
	}
	return out
}
