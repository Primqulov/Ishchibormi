package admin

import (
	"context"
	"net/http"
	"strings"
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

// maxErrQuery — qidiruv matnining chegarasi. Qiymat regexp'ga aylanadi
// (escRe bilan ekranlangan holda), shuning uchun uzunlik cheklanishi shart:
// kilobaytlik "qidiruv" har bir hujjatga qarshi behuda ishlatilardi.
const maxErrQuery = 100

// errSorts — ruxsat etilgan saralashlar (Figma 3.12.2 · D · "Saralash").
// Yopiq ro'yxat: sort maydoni tashqaridan kelgan satr bo'lsa, uni
// to'g'ridan-to'g'ri bson.D ga qo'yish indekssiz maydon bo'yicha
// xotirada sortlashga va 32 MB chegarasiga urilishga olib kelardi.
var errSorts = map[string]bson.D{
	"last":     {{Key: "lastSeenAt", Value: -1}},
	"count":    {{Key: "count", Value: -1}, {Key: "lastSeenAt", Value: -1}},
	"users":    {{Key: "usersCount", Value: -1}, {Key: "lastSeenAt", Value: -1}},
	"first":    {{Key: "firstSeenAt", Value: -1}},
	"severity": {{Key: "sevRank", Value: -1}, {Key: "lastSeenAt", Value: -1}},
}

// errFilter — ro'yxat va "Natija" hisobi uchun umumiy filtr.
//
// Har bir qiymat YOPIQ to'plamga solishtiriladi (errlog.Severities,
// errlog.Modules va h.k.). Bu Mongo inyeksiyasidan himoya emas — driver
// qiymatni operator sifatida talqin qilmaydi — balki "noma'lum filtr
// jimgina e'tiborsiz qoldirilib, admin butun jurnalni ko'rmoqchi bo'lganini
// ko'rmaslik" xatosining oldini olish uchun: noto'g'ri qiymat 400 qaytaradi.
func errFilter(r *http.Request) (bson.M, error) {
	q := r.URL.Query()
	f := bson.M{}

	switch v := strings.TrimSpace(q.Get("status")); v {
	case "", "open":
		// "Ochiq" = hal qilinmagan hamma narsa: Yangi, Kuzatilmoqda,
		// Bartaraf etilmoqda, Qayta paydo bo'ldi (Figma 3.12.3 · J).
		// Ro'yxat shu to'rttadan iborat bo'lishi MUHIM: "Bartaraf
		// etilmoqda" ni tashlab ketsak, ish boshlangan xatolik ochiq
		// ro'yxatdan yo'qolib, hech kim uni kuzatmay qo'yardi.
		f["status"] = bson.M{"$in": errlog.OpenStatuses}
	case "all":
		// filtr yo'q
	default:
		if !errlog.Statuses[v] {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_status", "invalid status filter")
		}
		f["status"] = v
	}

	if v := strings.TrimSpace(q.Get("severity")); v != "" && v != "all" {
		if !errlog.Severities[v] {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_severity", "invalid severity filter")
		}
		f["severity"] = v
	}
	if v := strings.TrimSpace(q.Get("module")); v != "" && v != "all" {
		if !errlog.Modules[v] {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_module", "invalid module filter")
		}
		f["module"] = v
	}

	rng := bson.M{}
	if v := q.Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_range", "invalid from")
		}
		rng["$gte"] = t
	}
	if v := q.Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_range", "invalid to")
		}
		rng["$lte"] = t
	}
	if len(rng) > 0 {
		f["lastSeenAt"] = rng
	}

	if v := strings.TrimSpace(q.Get("q")); v != "" {
		if len(v) > maxErrQuery {
			return nil, httpx.NewError(http.StatusBadRequest, "bad_query", "query too long")
		}
		re := primitive.Regex{Pattern: escRe(v), Options: "i"}
		f["$or"] = bson.A{
			bson.M{"code": re}, bson.M{"ref": re}, bson.M{"title": re},
			bson.M{"message": re}, bson.M{"where": re}, bson.M{"path": re},
		}
	}
	return f, nil
}

// Errors: GET /admin/errors — xatolik guruhlari ro'yxati.
//
// Faqat o'qish. Yozuv yo'li butunlay boshqa joyda (internal/errlog): panel
// jurnalga hodisa qo'sha olmaydi, o'chira ham olmaydi — u faqat holatni
// o'zgartiradi (PatchErrorStatus, superadmin). Shu bo'linish jurnalning
// ishonchliligini saqlaydi: "kim nimani o'chirib yubordi" degan savol
// tug'ilmaydi.
func (h *Handler) Errors(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)

	f, err := errFilter(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	sortKey := strings.TrimSpace(r.URL.Query().Get("sort"))
	if sortKey == "" {
		sortKey = "last"
	}
	sort, ok := errSorts[sortKey]
	if !ok {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_sort", "invalid sort"))
		return
	}

	cur, err := h.ErrGroups.Find(ctx, f,
		options.Find().SetSort(sort).SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	rows := []models.ErrorGroup{}
	if err := cur.All(ctx, &rows); err != nil {
		httpx.Err(w, err)
		return
	}

	total, err := h.ErrGroups.CountDocuments(ctx, f)
	if err != nil {
		httpx.Err(w, err)
		return
	}

	// "Natija: N guruh · M hodisa" — sarlavhadagi o'ng blok. Filtrlangan
	// to'plam bo'yicha hisoblanadi, ya'ni filtr o'zgarganda u ham o'zgaradi.
	var events int64
	if total > 0 {
		agg, err := h.ErrGroups.Aggregate(ctx, mongo.Pipeline{
			bson.D{{Key: "$match", Value: f}},
			bson.D{{Key: "$group", Value: bson.M{"_id": nil, "n": bson.M{"$sum": "$count"}}}},
		})
		if err == nil {
			var out []struct {
				N int64 `bson:"n"`
			}
			if agg.All(ctx, &out) == nil && len(out) > 0 {
				events = out[0].N
			}
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": rows, "page": page, "limit": limit, "total": total, "events": events,
	})
}

// errStats — "3.12" sahifasining beshta ko'rsatkichi.
type errStats struct {
	Open        int64 `json:"open"`
	Critical    int64 `json:"critical"`
	Events24h   int64 `json:"events24h"`
	Users24h    int64 `json:"users24h"`
	Resolved7d  int64 `json:"resolved7d"`
	GeneratedAt int64 `json:"generatedAt"`
}

// ErrorStats: GET /admin/errors/stats.
//
// Ro'yxatdan ALOHIDA endpoint. Sabab amaliy: qidiruv maydoni har bosishda
// ro'yxatni qayta so'raydi (debounce bilan), ko'rsatkichlar esa filtrga
// bog'liq emas — ular butun tizimning holati. Bitta endpointga qo'shsak,
// har bir harf uchun ikkita og'ir agregatsiya bajarilardi.
func (h *Handler) ErrorStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := time.Now()
	var st errStats
	st.GeneratedAt = now.Unix()

	open := bson.M{"$in": errlog.OpenStatuses}
	agg, err := h.ErrGroups.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$facet", Value: bson.M{
			"open":     bson.A{bson.M{"$match": bson.M{"status": open}}, bson.M{"$count": "n"}},
			"critical": bson.A{bson.M{"$match": bson.M{"status": open, "severity": errlog.SevCritical}}, bson.M{"$count": "n"}},
			"resolved": bson.A{
				bson.M{"$match": bson.M{"status": errlog.StatusResolved, "resolvedAt": bson.M{"$gte": now.Add(-7 * 24 * time.Hour)}}},
				bson.M{"$count": "n"},
			},
		}}},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	var facets []struct {
		Open     []struct{ N int64 } `bson:"open"`
		Critical []struct{ N int64 } `bson:"critical"`
		Resolved []struct{ N int64 } `bson:"resolved"`
	}
	if err := agg.All(ctx, &facets); err != nil {
		httpx.Err(w, err)
		return
	}
	if len(facets) > 0 {
		if v := facets[0].Open; len(v) > 0 {
			st.Open = v[0].N
		}
		if v := facets[0].Critical; len(v) > 0 {
			st.Critical = v[0].N
		}
		if v := facets[0].Resolved; len(v) > 0 {
			st.Resolved7d = v[0].N
		}
	}

	// Hodisalar 24 soatda: `n` maydonlari yig'indisi (bitta hujjat bir
	// necha takrorlanishni ifodalaydi — internal/errlog/recorder.go).
	// Ta'sirlangan foydalanuvchi: noyob hash'lar soni, ID emas.
	day := bson.M{"at": bson.M{"$gte": now.Add(-24 * time.Hour)}}
	agg2, err := h.ErrEvents.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: day}},
		bson.D{{Key: "$facet", Value: bson.M{
			"events": bson.A{bson.M{"$group": bson.M{"_id": nil, "n": bson.M{"$sum": "$n"}}}},
			"users": bson.A{
				bson.M{"$match": bson.M{"userHash": bson.M{"$nin": bson.A{nil, ""}}}},
				bson.M{"$group": bson.M{"_id": "$userHash"}},
				bson.M{"$count": "n"},
			},
		}}},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	var f2 []struct {
		Events []struct{ N int64 } `bson:"events"`
		Users  []struct{ N int64 } `bson:"users"`
	}
	if err := agg2.All(ctx, &f2); err != nil {
		httpx.Err(w, err)
		return
	}
	if len(f2) > 0 {
		if v := f2[0].Events; len(v) > 0 {
			st.Events24h = v[0].N
		}
		if v := f2[0].Users; len(v) > 0 {
			st.Users24h = v[0].N
		}
	}
	httpx.JSON(w, http.StatusOK, st)
}

type errStatusReq struct {
	Status string `json:"status"`
	Note   string `json:"note"`
	// AssigneeID — "Bartaraf etilmoqda" uchun mas'ul admin. Bo'sh bo'lsa
	// amalni bajargan admin o'ziga oladi.
	AssigneeID string `json:"assigneeId"`
	// PlannedVersion / FixedVersion — Figma 3.12.3 · J dagi qo'shimcha
	// maydonlar ("rejalashtirilgan versiya", "tuzatilgan versiya").
	PlannedVersion string `json:"plannedVersion"`
	FixedVersion   string `json:"fixedVersion"`
	// Reason — "E'tiborsiz qoldirildi" uchun MAJBURIY sabab.
	Reason string `json:"reason"`
}

// maxVersionLen — versiya satrining chegarasi ("1.4.2 (86)" kabi).
const maxVersionLen = 40

// minIgnoreReason — "E'tiborsiz" sababi shu belgidan qisqa bo'lsa qabul
// qilinmaydi. "ok" yoki "-" deb yozib nosozlikni ko'zdan yashirib
// bo'lmasligi kerak: sabab keyin audit jurnalida o'qiladi.
const minIgnoreReason = 10

// PatchErrorStatus: PATCH /admin/errors/{id}/status — hayot siklini
// qo'lda o'zgartirish (Figma 3.12.2 · B va F, 3.12.3 · J).
//
// # KIM NIMA QILA OLADI
//
// Endpoint moderator+ uchun ochiq (kuzatish va tuzatish oqimi kundalik
// ish), lekin ikkita chegara handler ichida turadi:
//
//   - `ignored` — FAQAT superadmin va faqat sabab bilan. Bu holat
//     xatolikni ochiq ro'yxatdan ham, ogohlantirishlardan ham chiqaradi,
//     ya'ni amalda "nosozlikni ko'rinmas qilish" tugmasi.
//   - `regressed` — hech kim qo'lda qo'ya olmaydi. Uni faqat recorder
//     qo'yadi (internal/errlog/recorder.go), hal qilingan xatolik qayta
//     paydo bo'lganda. Qo'lda ruxsat bersak, "qayta paydo bo'ldi"
//     belgisining ma'nosi yo'qolardi: u endi hodisa emas, fikr bo'lardi.
//
// Har bir o'zgarish IKKI joyga yoziladi: guruhning `activity` tarixiga
// (batafsil ekrandagi "Amallar tarixi") va admin audit jurnaliga.
func (h *Handler) PatchErrorStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_id", "invalid id"))
		return
	}
	var in errStatusReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Err(w, err)
		return
	}
	in.Status = strings.TrimSpace(in.Status)
	if !errlog.ManualStatuses[in.Status] {
		// Noma'lum holat ham, `regressed` ham shu yerda to'xtaydi.
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_status", "invalid status"))
		return
	}

	actor := h.adminLabel(ctx, httpx.AdminID(r))
	role := httpx.AdminRole(r)
	// Izoh admin yozadi, lekin baribir tozalanadi va qisqartiriladi:
	// u keyin ro'yxatda ko'rsatiladi va boshqa adminlarga o'qiladi.
	note := errlog.Clip(errlog.Text(in.Note), errlog.MaxNote)
	reason := errlog.Clip(errlog.Text(in.Reason), errlog.MaxNote)

	if in.Status == errlog.StatusIgnored {
		if role != "superadmin" {
			httpx.Err(w, httpx.NewError(http.StatusForbidden, "forbidden", "insufficient role"))
			return
		}
		if len([]rune(reason)) < minIgnoreReason {
			httpx.Err(w, httpx.NewError(http.StatusBadRequest, "reason_required",
				"e'tiborsiz qoldirish uchun sabab yozilishi shart"))
			return
		}
	}

	// "Bartaraf etilmoqda" uchun guruh AVVAL o'qiladi: startedAt ni va
	// mas'ulni qayta yozish kerakmi degan qaror faqat oldingi qiymatlarga
	// qarab chiqariladi. Yagona atomar muqobil — aggregatsiya quvuri bilan
	// yangilash ($cond) — bu yerda yaramaydi: quvurli yangilashda
	// `$push … $slice` yo'q, ya'ni activity tarixini qo'lda $concatArrays +
	// $slice bilan qayta qurishga to'g'ri kelardi va bitta jimgina
	// yozuvning narxi butun tarix mantig'ining murakkablashuvi bo'lardi.
	// O'qish bilan yozish orasidagi tirqish esa amalda zararsiz: eng yomon
	// holatda ikki admin bir soniyada bosganda startedAt millisekundlarga
	// siljiydi — ma'lumot yo'qolmaydi.
	var prev models.ErrorGroup
	if in.Status == errlog.StatusFixing {
		// Faqat qaror uchun kerak bo'lgan maydonlar: activity va
		// userHashes massivlarini tarmoqdan olib o'tish shart emas.
		err = h.ErrGroups.FindOne(ctx, bson.M{"_id": id}, options.FindOne().
			SetProjection(bson.M{"status": 1, "startedAt": 1, "assignee": 1, "assigneeId": 1})).Decode(&prev)
		if err == mongo.ErrNoDocuments {
			httpx.Err(w, httpx.NewError(http.StatusNotFound, "not_found", "error group not found"))
			return
		}
		if err != nil {
			httpx.Err(w, err)
			return
		}
	}

	now := time.Now()
	set := bson.M{"status": in.Status}
	unset := bson.M{}
	// Izoh faqat yuborilgan bo'lsa yoziladi. Aks holda holatni
	// o'zgartirish oldingi izohni jimgina o'chirib tashlardi.
	if note != "" {
		set["note"] = note
	}
	// masul / siklBelgi — activity satri uchun. Qiymat switch ichida
	// aniqlanadi, chunki qaror aynan o'sha yerda (oldingi holat bilan
	// solishtirilganda) qabul qilinadi, satr esa keyin bir joyda yig'iladi.
	var masul, siklBelgi string

	switch in.Status {
	case errlog.StatusFixing:
		// startedAt — "Boshlangan 29.08 · 10:12" maydonining va
		// "boshlanganidan beri N ta yangi hodisa" hisobining tayanchi
		// (errdetail.go · errImpact). Shuning uchun u har saqlashda emas,
		// faqat YANGI ish sikli boshlanganda yoziladi: guruh allaqachon
		// "fixing" da tursa (admin versiyani yoki izohni tahrirlayapti),
		// sana joyida qoladi va sanoq nolga qaytmaydi. Guruh
		// resolved/ignored/regressed dan qaytgan bo'lsa — bu boshqa sikl,
		// o'shanda sana yangilanishi to'g'ri.
		switch {
		case prev.StartedAt == nil:
			set["startedAt"] = now
		case prev.Status != errlog.StatusFixing:
			set["startedAt"] = now
			siklBelgi = "qayta boshlandi"
		default:
			siklBelgi = "ish davom etmoqda"
		}
		// Mas'ul faqat ANIQ ko'rsatilganda almashadi. Ilgari bu yerda
		// so'zsiz `assignee = actor` turardi: PATCH /assignee bilan
		// biriktirilgan dasturchi holat qayta saqlanganda jimgina
		// almashib ketardi va buni hech kim ko'rmasdi.
		masul = prev.Assignee
		aid, aok := h.resolveAssignee(ctx, in.AssigneeID)
		// NEGA xato qaytariladi: id YUBORILGAN, lekin u mavjud faol
		// adminga mos kelmadi (yaroqsiz hex, o'chirilgan yoki yo'q
		// hisob). Ilgari bunday so'rov jimgina o'tib ketardi — guruhda
		// allaqachon mas'ul bo'lsa hech qanday shox bajarilmasdi va
		// javob 200 bo'lardi: admin "biriktirdim" deb o'ylab qolardi,
		// aslida hech narsa o'zgarmagan. PATCH /assignee xuddi shu
		// ma'lumot uchun 400 qaytaradi, shuning uchun bu yerda ham
		// AYNAN o'sha kod va matn — bir xil kiritma bir xil javob
		// berishi kerak.
		if !aok && strings.TrimSpace(in.AssigneeID) != "" {
			httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_assignee", "admin topilmadi"))
			return
		}
		if aok {
			set["assigneeId"] = aid.id
			set["assignee"] = aid.label
			masul = aid.label
		} else if prev.Assignee == "" && prev.AssigneeID.IsZero() {
			// Mas'ul umuman yo'q — amalni bajargan admin o'ziga oladi.
			set["assignee"] = actor
			masul = actor
		}
		if v := errlog.Clip(errlog.Text(in.PlannedVersion), maxVersionLen); v != "" {
			set["plannedVersion"] = v
		}
	case errlog.StatusResolved:
		set["resolvedAt"] = now
		set["resolvedBy"] = actor
		if v := errlog.Clip(errlog.Text(in.FixedVersion), maxVersionLen); v != "" {
			set["fixedVersion"] = v
			set["closedVersion"] = v
		}
		if note != "" {
			set["fixNote"] = note
		}
	case errlog.StatusIgnored:
		set["ignoreReason"] = reason
		unset["resolvedAt"] = ""
		unset["resolvedBy"] = ""
	default:
		// Yangi/Kuzatilmoqda ga qaytarish — "hal qilindi" belgisini
		// olib tashlaydi, lekin `fixedVersion` qoladi: qaysi versiyada
		// yopilgani regressiyani tekshirishda kerak bo'ladi.
		unset["resolvedAt"] = ""
		unset["resolvedBy"] = ""
		unset["ignoreReason"] = ""
	}

	line := errlog.StatusLabel(in.Status)
	if in.Status == errlog.StatusIgnored {
		line += " · sabab: " + reason
	} else if v, _ := set["plannedVersion"].(string); v != "" {
		line += " · reja: " + v
	} else if v, _ := set["fixedVersion"].(string); v != "" {
		line += " · versiya: " + v
	}
	// Sikl belgisi tarixda ham, audit jurnalida ham ko'rinadi: aks holda
	// ketma-ket bir xil "Bartaraf etilmoqda" yozuvlari turardi va ishning
	// haqiqiy boshlangan payti qaysi biri ekani bilinmasdi.
	if siklBelgi != "" {
		line += " · " + siklBelgi
	}
	// masul — set'dan emas, hisoblangan qiymatdan olinadi: mavjud mas'ul
	// saqlanib qolganda u set'ga umuman yozilmaydi, lekin satrda "mas'ul"
	// baribir ko'rinishi kerak.
	if masul != "" {
		line += " · mas'ul: " + masul
	}

	upd := bson.M{
		"$set": set,
		"$push": bson.M{"activity": bson.M{
			"$each":  bson.A{models.ErrorActivity{Kind: "status", Text: line, Actor: actor, At: now}},
			"$slice": -errlog.MaxActivity,
		}},
	}
	if len(unset) > 0 {
		upd["$unset"] = unset
	}

	var g models.ErrorGroup
	err = h.ErrGroups.FindOneAndUpdate(ctx, bson.M{"_id": id}, upd,
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&g)
	if err == mongo.ErrNoDocuments {
		httpx.Err(w, httpx.NewError(http.StatusNotFound, "not_found", "error group not found"))
		return
	}
	if err != nil {
		httpx.Err(w, err)
		return
	}

	// "E'tiborsiz" alohida amal kodi bilan yoziladi: audit sahifasida uni
	// oddiy holat o'zgarishidan ajratib filtrlash mumkin bo'lsin.
	action := "error_status"
	if in.Status == errlog.StatusIgnored {
		action = "error_ignore"
	}
	h.audit(r, action, g.ID.Hex(), g.Ref+" · "+g.Code+" → "+line)

	httpx.JSON(w, http.StatusOK, g)
}

// errNoteReq — "Izoh qo'shish".
type errNoteReq struct {
	Text string `json:"text"`
}

// PostErrorNote: POST /admin/errors/{id}/notes.
//
// Izoh HOLATNI o'zgartirmaydi — u faqat tarixga qo'shiladi. Shu sababli
// moderator ham yozishi mumkin: "292-qatorda tekshiruv yo'q" degan
// kuzatuv jurnalning qiymatini oshiradi, xatolikni yashirmaydi.
func (h *Handler) PostErrorNote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_id", "invalid id"))
		return
	}
	var in errNoteReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Err(w, err)
		return
	}
	text := errlog.Clip(errlog.Text(in.Text), errlog.MaxNote)
	if text == "" {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_text", "izoh bo'sh"))
		return
	}
	now := time.Now()
	actor := h.adminLabel(ctx, httpx.AdminID(r))
	var g models.ErrorGroup
	err = h.ErrGroups.FindOneAndUpdate(ctx, bson.M{"_id": id},
		bson.M{"$push": bson.M{"activity": bson.M{
			"$each":  bson.A{models.ErrorActivity{Kind: "note", Text: text, Actor: actor, At: now}},
			"$slice": -errlog.MaxActivity,
		}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&g)
	if err == mongo.ErrNoDocuments {
		httpx.Err(w, httpx.NewError(http.StatusNotFound, "not_found", "error group not found"))
		return
	}
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "error_note", g.ID.Hex(), g.Ref+" · "+text)
	httpx.JSON(w, http.StatusOK, g)
}

// errAssignReq — mas'ul adminni o'zgartirish ("O'zgartirish" havolasi).
type errAssignReq struct {
	AssigneeID string `json:"assigneeId"`
}

// PatchErrorAssignee: PATCH /admin/errors/{id}/assignee.
func (h *Handler) PatchErrorAssignee(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_id", "invalid id"))
		return
	}
	var in errAssignReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Err(w, err)
		return
	}
	now := time.Now()
	actor := h.adminLabel(ctx, httpx.AdminID(r))
	set := bson.M{}
	unset := bson.M{}
	line := "Mas'ul olib tashlandi"
	if strings.TrimSpace(in.AssigneeID) == "" {
		unset["assigneeId"] = ""
		unset["assignee"] = ""
	} else {
		a, ok := h.resolveAssignee(ctx, in.AssigneeID)
		if !ok {
			httpx.Err(w, httpx.NewError(http.StatusBadRequest, "bad_assignee", "admin topilmadi"))
			return
		}
		set["assigneeId"] = a.id
		set["assignee"] = a.label
		line = "Mas'ul: " + a.label
	}
	upd := bson.M{"$push": bson.M{"activity": bson.M{
		"$each":  bson.A{models.ErrorActivity{Kind: "assign", Text: line, Actor: actor, At: now}},
		"$slice": -errlog.MaxActivity,
	}}}
	if len(set) > 0 {
		upd["$set"] = set
	}
	if len(unset) > 0 {
		upd["$unset"] = unset
	}
	var g models.ErrorGroup
	err = h.ErrGroups.FindOneAndUpdate(ctx, bson.M{"_id": id}, upd,
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&g)
	if err == mongo.ErrNoDocuments {
		httpx.Err(w, httpx.NewError(http.StatusNotFound, "not_found", "error group not found"))
		return
	}
	if err != nil {
		httpx.Err(w, err)
		return
	}
	h.audit(r, "error_assign", g.ID.Hex(), g.Ref+" · "+line)
	httpx.JSON(w, http.StatusOK, g)
}

// errAssignee — "Mas'ul admin" tanlash ro'yxatining bitta qatori.
type errAssignee struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Role  string `json:"role"`
}

// Assignees: GET /admin/errors/assignees.
//
// # NEGA `GET /admins` ISHLATILMAYDI
//
// U faqat superadmin uchun ochiq va kadr hisobining HAMMASINI beradi:
// login, 2FA yoqilganmi, yaratilgan sana. Mas'ul tanlash uchun bu ortiqcha
// va xavfli — moderator xatolikni o'ziga yoki hamkasbiga biriktirishi
// kerak, lekin buning uchun kadrlar bo'limini ko'rishi shart emas.
//
// Shu sababli alohida, TOR ro'yxat: id, ko'rinadigan nom va rol. Faqat
// FAOL hisoblar — o'chirilgan admin "mas'ul" bo'lib qolmasligi kerak
// (resolveAssignee ham aynan shu shartni takrorlaydi).
func (h *Handler) Assignees(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cur, err := h.Admins.Find(ctx, bson.M{"isActive": true},
		options.Find().
			SetProjection(bson.M{"username": 1, "name": 1, "role": 1}).
			SetSort(bson.D{{Key: "name", Value: 1}, {Key: "username", Value: 1}}).
			SetLimit(200))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	var list []models.Admin
	if err := cur.All(ctx, &list); err != nil {
		httpx.Err(w, err)
		return
	}
	out := []errAssignee{}
	for _, a := range list {
		label := a.Name
		if label == "" {
			label = "@" + a.Username
		}
		out = append(out, errAssignee{ID: a.ID.Hex(), Label: label, Role: a.Role})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

type assigneeRef struct {
	id    primitive.ObjectID
	label string
}

// resolveAssignee — mas'ul faqat MAVJUD va FAOL admin bo'lishi mumkin.
// Tashqaridan kelgan id shu tekshiruvdan o'tmasa, guruhga yozilmaydi:
// aks holda panel o'chirilgan hisobni "mas'ul" deb ko'rsatib turardi.
func (h *Handler) resolveAssignee(ctx context.Context, hex string) (assigneeRef, bool) {
	oid, err := primitive.ObjectIDFromHex(strings.TrimSpace(hex))
	if err != nil {
		return assigneeRef{}, false
	}
	var a models.Admin
	if h.Admins.FindOne(ctx, bson.M{"_id": oid, "isActive": true},
		options.FindOne().SetProjection(bson.M{"username": 1, "name": 1, "role": 1})).Decode(&a) != nil {
		return assigneeRef{}, false
	}
	label := a.Name
	if label == "" {
		label = "@" + a.Username
	}
	if a.Role != "" {
		label += " · " + a.Role
	}
	return assigneeRef{id: a.ID, label: label}, true
}

// adminLabel — "@username" ko'rinishidagi yorliq. Topilmasa bo'sh satr:
// yorliq yo'qligi holatni o'zgartirishga to'sqinlik qilmasligi kerak.
func (h *Handler) adminLabel(ctx context.Context, hex string) string {
	oid, err := primitive.ObjectIDFromHex(hex)
	if err != nil {
		return ""
	}
	var a models.Admin
	if h.Admins.FindOne(ctx, bson.M{"_id": oid},
		options.FindOne().SetProjection(bson.M{"username": 1})).Decode(&a) != nil {
		return ""
	}
	if a.Username == "" {
		return ""
	}
	return "@" + a.Username
}
