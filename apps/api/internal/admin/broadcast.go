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
	"go.mongodb.org/mongo-driver/mongo/options"
)

type broadcastReq struct {
	Title       string `json:"title" validate:"required"`
	Body        string `json:"body"`
	Region      string `json:"region"`
	ActiveOnly  bool   `json:"activeOnly"`
	ScheduledAt string `json:"scheduledAt"` // RFC3339; empty = send now
}

// Ommaviy tarqatma maydonlarining chegaralari. Figma 3.8 formasi shu
// sonlarni `maxLength` bilan ko'zguga oladi, lekin haqiqiy chegara shu
// yerda: so'rov brauzerdan o'tmasdan ham yuborilishi mumkin.
const (
	bcTitleMax  = 160
	bcBodyMax   = 4000
	bcRegionMax = 100
	// Segment ro'yxatida qaytariladigan viloyatlar soni (Figma 3.8b).
	// `users.region` — tekshirilmaydigan erkin matn, ya'ni bazada
	// nazariy jihatdan minglab turli qiymat yig'ilishi mumkin. Ro'yxat
	// esa TANLASH uchun: uzun quyruq baribir hech kim bosmaydigan,
	// bir-ikki odamlik qiymatlardan iborat bo'ladi.
	bcRegionsMax = 200
	// Rejalashtirilgan vaqtning «orqaga» yo'l qo'yiladigan chekinishi.
	// Brauzer soati serverdan bir-ikki daqiqa farq qilishi normal holat,
	// shuning uchun yaqin o'tmish xato deb hisoblanmaydi.
	bcPastSlop = 5 * time.Minute
	// Eng uzoq muddat — bir yil. Yil raqamidagi xato («2226») aks holda
	// tarqatmani jimgina abadiy navbatda qoldirardi: u «rejalashtirilgan»
	// bo'lib turadi, lekin hech qachon yuborilmaydi.
	bcMaxAhead = 365 * 24 * time.Hour
)

// broadcastSchedule «Rejalashtirish» maydonini tekshiradi va yuborish
// vaqtini qaytaradi: nil — darhol yuborish, ko'rsatkich — kechiktirish.
//
// # NEGA O'TGAN VAQT — XATO
//
// Ilgari o'tgan (yoki tushunarsiz) vaqt jimgina «hozir yubor» degan
// ma'noni bergan. Bu eng qaytarib bo'lmaydigan amal uchun xavfli
// standart edi: adminning sanada bir belgilik xatosi (kechqurun soat
// 18:00 da «bugun 09:00» ni tanlash) o'n minglab foydalanuvchiga darhol
// ketadigan xabarga aylanardi va uni ortga qaytarish yo'q. Endi bunday
// vaqt 400 `bad_time` bilan rad etiladi — «darhol yuborish» faqat
// maydon BO'SH bo'lganda, ya'ni admin ataylab shuni tanlaganda ishlaydi.
func broadcastSchedule(raw string, now time.Time) (*time.Time, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, httpx.NewError(400, "bad_time", "scheduledAt must be RFC3339")
	}
	if t.Before(now.Add(-bcPastSlop)) {
		return nil, httpx.NewError(400, "bad_time", "scheduledAt is in the past")
	}
	if t.After(now.Add(bcMaxAhead)) {
		return nil, httpx.NewError(400, "bad_time", "scheduledAt is too far in the future")
	}
	// Bir daqiqadan yaqin vaqt navbatga qo'yilmaydi: rejalashtiruvchi
	// daqiqada bir marta yurgani uchun natija bir xil, lekin holat
	// («sending») darhol to'g'ri ko'rinadi.
	if t.After(now.Add(time.Minute)) {
		return &t, nil
	}
	return nil, nil
}

// broadcastFilter builds the recipient query for a broadcast: never deleted;
// optionally only a region and/or only non-blocked ("active") users.
func broadcastFilter(req broadcastReq) bson.M {
	filter := bson.M{"isDeleted": bson.M{"$ne": true}}
	if req.ActiveOnly {
		filter["isBlocked"] = bson.M{"$ne": true}
	}
	if region := strings.TrimSpace(req.Region); region != "" {
		filter["region"] = region
	}
	return filter
}

/* ── Segment ro'yxati (Figma 3.8b) ────────────────────────────────────────

# NEGA RO'YXAT BAZADAN OLINADI, KODGA YOZILMAYDI

`users.region` hech qanday ro'yxat bilan cheklanmagan: u foydalanuvchi
profilidan kelgan erkin matn va amalda unda ikki xil lug'at yozilgan
(«Toshkent shahri» va «Toshkent»). Agar panel viloyatlar ro'yxatini
o'zida saqlaganda, admin ro'yxatdan tanlagan bo'lsa ham segment bo'sh
chiqishi mumkin edi — ya'ni «viloyat nomini xato yozish» muammosi
«jimgina hech kimga ketmadi» muammosiga aylanardi. Shu bois ro'yxat
BAZADAGI haqiqiy qiymatlardan yig'iladi, har birining yonida esa
qabul qiluvchilar soni turadi: admin yuborishdan oldin ko'radi.

# NIMA ATAYLAB YO'Q: normalizatsiya

Qiymatlar bir-biriga qo'shilmaydi va tuzatilmaydi. Yuborish filtri
AYNAN mos qiymat bo'yicha ishlaydi (`broadcastFilter`), shuning uchun
ro'yxatdagi qator o'sha filtr topadigan odamlar sonini ko'rsatadi:
ko'ringan son bilan haqiqiy son bir xil bo'ladi. Bir hududning ikki
xil yozilishini birlashtirsak, ularning bir qismi jimgina xabarsiz
qolardi. */

// bcRegionCount — segment ro'yxatining bitta qatori. Bir struktura
// ikki vazifada: guruhlash natijasini o'qish (`bson`) va javob (`json`).
type bcRegionCount struct {
	Region string `bson:"_id" json:"region"`
	Count  int64  `bson:"count" json:"count"`
}

// broadcastRegionItems xom guruhlash natijasini ro'yxatga aylantiradi:
// yuborib BO'LMAYDIGAN qiymatlarni tashlab, sonini cheklaydi. Tartib
// pipeline'dan keladi (soni ko'p bo'lgani yuqorida), shu bois bu yerda
// qayta tartiblanmaydi — kesilganda ham eng kattalari qoladi.
//
// Nima uchun tashlanadi:
//   - bo'sh qiymat — segment sifatida u «barcha viloyatlar» degani,
//     ya'ni alohida qator bo'lishi mantiqsiz;
//   - chetida bo'shliq bor qiymat (« Samarqand ») — yuborish filtri
//     kelgan qiymatning chetini kesadi, demak bunday odamlarni HECH
//     QANDAY segment topmaydi. Ro'yxatga qo'ysak, «Samarqand» ni
//     tanlagan admin ko'rsatilgan sondan kamroq odamga yuborardi;
//   - `bcRegionMax` dan uzun qiymat — server bunday segmentni
//     `too_long` bilan rad etadi, ya'ni tanlash imkoni yolg'on bo'lardi.
func broadcastRegionItems(xom []bcRegionCount) []bcRegionCount {
	out := make([]bcRegionCount, 0, len(xom))
	for _, v := range xom {
		if v.Count <= 0 || v.Region == "" || strings.TrimSpace(v.Region) != v.Region {
			continue
		}
		if len([]rune(v.Region)) > bcRegionMax {
			continue
		}
		out = append(out, v)
		if len(out) == bcRegionsMax {
			break
		}
	}
	return out
}

// BroadcastRegions returns the segment options for the broadcast form: every
// region value that actually exists in `users`, each with the number of
// recipients it would reach, plus the total for "all regions". Superadmin-only
// (same route group as sending).
func (h *Handler) BroadcastRegions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// `activeOnly` — formadagi katakchaning ko'zgusi. Sonlar AYNAN
	// yuboriladigan filtr bilan hisoblanishi kerak: aks holda ro'yxat
	// bloklangan hisoblarni ham qo'shib, sonni oshirib ko'rsatardi.
	activeOnly := false
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("activeOnly"))) {
	case "1", "true", "on", "yes":
		activeOnly = true
	}

	asos := broadcastFilter(broadcastReq{ActiveOnly: activeOnly})
	total, err := h.Users.CountDocuments(ctx, asos)
	if err != nil {
		httpx.Err(w, err)
		return
	}

	moslik := bson.M{}
	for k, v := range asos {
		moslik[k] = v
	}
	// `$type` — himoya: `region` maydoniga satr bo'lmagan qiymat tushib
	// qolsa (qo'lda tahrirlangan hujjat, eski migratsiya), guruhlash
	// butun so'rovni yiqitmasin.
	moslik["region"] = bson.M{"$type": "string", "$ne": ""}
	// `$limit` chegarasi ikki barobar: yuqoridagi filtr bir qism
	// qiymatni tashlab ketadi, shuning uchun zaxira bilan olinadi —
	// aks holda bir nechta yaroqsiz qiymat ro'yxatni qisqartirardi.
	cur, err := h.Users.Aggregate(ctx, []bson.D{
		{{Key: "$match", Value: moslik}},
		{{Key: "$group", Value: bson.M{"_id": "$region", "count": bson.M{"$sum": 1}}}},
		{{Key: "$sort", Value: bson.D{{Key: "count", Value: -1}, {Key: "_id", Value: 1}}}},
		{{Key: "$limit", Value: 2 * bcRegionsMax}},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	var xom []bcRegionCount
	if err := cur.All(ctx, &xom); err != nil {
		httpx.Err(w, err)
		return
	}

	httpx.JSON(w, 200, map[string]any{
		"items":      broadcastRegionItems(xom),
		"total":      total,
		"activeOnly": activeOnly,
	})
}

// Broadcast queues a segmented notification and returns immediately. The actual
// per-user push runs in a background goroutine (with its own context), so a
// large audience no longer blocks the request — the doc's flagged problem. Send
// progress is recorded on the broadcasts collection (status sending -> done).
func (h *Handler) Broadcast(w http.ResponseWriter, r *http.Request) {
	var req broadcastReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "title required"))
		return
	}
	if len([]rune(req.Title)) > bcTitleMax || len([]rune(req.Body)) > bcBodyMax || len([]rune(req.Region)) > bcRegionMax {
		httpx.Err(w, httpx.NewError(400, "too_long", "broadcast field is too long"))
		return
	}
	// Ixtiyoriy reja. Tekshiruv alohida funksiyada — u Mongo'siz test
	// qilinadi (broadcast_validate_test.go).
	scheduledAt, err := broadcastSchedule(req.ScheduledAt, time.Now())
	if err != nil {
		httpx.Err(w, err)
		return
	}

	filter := broadcastFilter(req)
	/* Qabul qiluvchilar soni — endi JAVOBGARLIKLI qadam (Figma 3.8b · E).
	 *
	 * # NEGA XATO JIMGINA O'TKAZILMAYDI
	 *
	 * Ilgari sanoq xatosi e'tiborsiz qoldirilardi: `total` 0 bo'lib
	 * qolar, javobda «0 foydalanuvchiga» yozilar, lekin fon jarayoni
	 * BARIBIR filtrga tushgan hammaga yuborardi. Ya'ni admin ekranda
	 * «hech kimga ketmadi» deb o'qib, aslida o'n minglab odamga xabar
	 * ketgan bo'lardi. Endi sanoq bajarilmasa — tarqatma boshlanmaydi.
	 *
	 * # NEGA BO'SH SEGMENT RAD ETILADI
	 *
	 * Segment ro'yxatdan tanlanadi, ya'ni 0 ta qabul qiluvchi — deyarli
	 * har doim xato: viloyat qiymati bazadan yo'qolgan yoki katakcha
	 * bilan birga hech kim qolmagan. Bunday tarqatmani qabul qilish
	 * tarixni ma'nosiz «yuborildi · 0» qatorlari bilan to'ldirar va
	 * adminni «xabar ketdi» deb o'ylashga majbur qilardi. */
	total, err := h.Users.CountDocuments(r.Context(), filter)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if total == 0 {
		httpx.Err(w, httpx.NewError(409, "empty_segment", "segment matches no recipients"))
		return
	}

	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	status := "sending"
	if scheduledAt != nil {
		status = "scheduled"
	}
	bc := models.Broadcast{
		Title: req.Title, Body: req.Body, Region: strings.TrimSpace(req.Region),
		ActiveOnly: req.ActiveOnly, SentCount: 0, Status: status,
		ScheduledAt: scheduledAt, CreatedBy: adminID, CreatedAt: time.Now(),
	}
	res, err := h.Broadcasts.InsertOne(r.Context(), bc)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	bc.ID = res.InsertedID.(primitive.ObjectID)

	if scheduledAt != nil {
		h.audit(r, "broadcast_schedule", req.Title, scheduledAt.Format(time.RFC3339))
		httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "scheduled", "scheduledAt": scheduledAt})
		return
	}
	h.audit(r, "broadcast", req.Title, req.Body)
	// Fire-and-forget delivery. Uses a fresh background context because the
	// request context is cancelled once we respond below.
	go h.sendBroadcast(bc.ID, filter, req.Title, req.Body)
	httpx.JSON(w, 202, map[string]any{"id": bc.ID, "recipients": total, "status": "sending"})
}

// RunScheduler polls for due scheduled broadcasts once a minute until ctx is
// cancelled. Runs as a single background goroutine started in main.
func (h *Handler) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	h.dispatchDueBroadcasts(ctx) // catch anything already due at startup
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.dispatchDueBroadcasts(ctx)
		}
	}
}

// dispatchDueBroadcasts atomically claims each due broadcast (scheduled ->
// sending via FindOneAndUpdate, so only one worker/tick can win) and delivers
// it. Recipients are rebuilt from the stored segment.
func (h *Handler) dispatchDueBroadcasts(ctx context.Context) {
	for {
		var bc models.Broadcast
		err := h.Broadcasts.FindOneAndUpdate(ctx,
			bson.M{"status": "scheduled", "scheduledAt": bson.M{"$lte": time.Now()}},
			bson.M{"$set": bson.M{"status": "sending"}},
			options.FindOneAndUpdate().SetReturnDocument(options.After),
		).Decode(&bc)
		if err != nil {
			return // ErrNoDocuments (nothing due) or a transient error — retry next tick
		}
		filter := broadcastFilter(broadcastReq{Region: bc.Region, ActiveOnly: bc.ActiveOnly})
		h.sendBroadcast(bc.ID, filter, bc.Title, bc.Body)
	}
}

// CancelBroadcast deletes a broadcast that hasn't started sending yet.
func (h *Handler) CancelBroadcast(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	res, err := h.Broadcasts.DeleteOne(r.Context(), bson.M{"_id": id, "status": "scheduled"})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.DeletedCount == 0 {
		httpx.Err(w, httpx.NewError(409, "not_scheduled", "only scheduled broadcasts can be cancelled"))
		return
	}
	h.audit(r, "broadcast_cancel", id.Hex(), "")
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// sendBroadcast delivers one notification per matching user and marks the
// broadcast done. Runs detached from the HTTP request.
func (h *Handler) sendBroadcast(id primitive.ObjectID, filter bson.M, title, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cur, err := h.Users.Find(ctx, filter)
	if err != nil {
		_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "done"}})
		return
	}
	defer cur.Close(ctx)
	count := 0
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			h.Notify.Push(ctx, u.ID, "system", title, body, nil)
			count++
		}
	}
	_, _ = h.Broadcasts.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"sentCount": count, "status": "done"}})
}

// adminBroadcastRow — tarix jadvalining bitta qatori (Figma 3.8).
//
// # NIMA ATAYLAB YO'Q: createdBy
//
// `models.Broadcast` da tarqatmani yuborgan xodimning ichki ObjectID'si
// saqlanadi — u audit jurnali uchun kerak, lekin Figma 3.8 jadvalida
// chizilmagan va panelda hech qayerda ko'rsatilmaydi. Javobda ortiqcha
// qolsa, xodimlarning ichki ID'lari brauzer tarixiga, proksi va
// devtools loglariga hech kimga kerak bo'lmagan holda oqib ketardi.
// Shu bois ro'yxat alohida struktura va proyeksiya bilan o'qiladi
// (turkumlar ro'yxatidagi `adminCategoryRow` bilan bir xil yondashuv),
// tuzilishning bir-biriga mos qolishini esa test qulflaydi.
type adminBroadcastRow struct {
	ID          primitive.ObjectID `bson:"_id" json:"id"`
	Title       string             `bson:"title" json:"title"`
	Body        string             `bson:"body" json:"body"`
	Region      string             `bson:"region" json:"region"`
	ActiveOnly  bool               `bson:"activeOnly" json:"activeOnly"`
	SentCount   int                `bson:"sentCount" json:"sentCount"`
	Status      string             `bson:"status" json:"status"`
	ScheduledAt *time.Time         `bson:"scheduledAt,omitempty" json:"scheduledAt,omitempty"`
	CreatedAt   time.Time          `bson:"createdAt" json:"createdAt"`
}

var bcRowProjection = bson.M{
	"title": 1, "body": 1, "region": 1, "activeOnly": 1,
	"sentCount": 1, "status": 1, "scheduledAt": 1, "createdAt": 1,
}

// ListBroadcasts returns the broadcast history (newest first, paginated).
func (h *Handler) ListBroadcasts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	page, limit, skip := pageParams(r)
	cur, err := h.Broadcasts.Find(ctx, bson.M{},
		options.Find().
			SetProjection(bcRowProjection).
			SetSort(bson.D{{Key: "createdAt", Value: -1}}).
			SetSkip(skip).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(ctx)
	out := []adminBroadcastRow{}
	for cur.Next(ctx) {
		var b adminBroadcastRow
		if err := cur.Decode(&b); err == nil {
			out = append(out, b)
		}
	}
	total, _ := h.Broadcasts.CountDocuments(ctx, bson.M{})
	paged(w, out, page, limit, total)
}
