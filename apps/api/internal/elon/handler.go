package elon

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/category"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/elonquery"
	"github.com/ishchibormi/backend/pkg/geocode"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"github.com/ishchibormi/backend/pkg/userlookup"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Col          *mongo.Collection
	Categories   *mongo.Collection
	Users        *mongo.Collection
	Applications *mongo.Collection
	Storage      *storage.Service
	Notify       *notification.Service

	// Ixtiyoriy kontent tekshiruvi. AttachModerator chaqirilmasa (yoki
	// guard o'chiq bo'lsa) e'lon yaratish/tahrirlash oqimi o'zgarmaydi.
	guard         *moderation.Guard
	maxImageBytes int64

	// viewBumps — Get'dagi ko'rishlar hisobini oshirish navbati. Ilgari har bir
	// GET alohida goroutine ochardi (katta trafikda chegarasiz goroutine); endi
	// bitta worker kanaldan o'qib bajaradi. Kanal to'lsa hisob tashlab yuboriladi
	// — viewsCount statistik ko'rsatkich, so'rovni sekinlatishga arzimaydi.
	viewBumps chan primitive.ObjectID
}

func NewHandler(db *mongo.Database, s *storage.Service, n *notification.Service) *Handler {
	h := &Handler{
		Col:          db.Collection("elons"),
		Categories:   db.Collection("categories"),
		Users:        db.Collection("users"),
		Applications: db.Collection("applications"),
		Storage:      s,
		Notify:       n,
		viewBumps:    make(chan primitive.ObjectID, 256),
	}
	go h.viewBumpWorker()
	return h
}

func (h *Handler) viewBumpWorker() {
	for id := range h.viewBumps {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = h.Col.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$inc": bson.M{"viewsCount": 1}})
		cancel()
	}
}

type upsertReq struct {
	Title        string `json:"title" validate:"required"`
	CategoryID   string `json:"categoryId" validate:"required"`
	Description  string `json:"description" validate:"required"`
	LocationURL  string `json:"locationUrl"`
	LocationText string `json:"locationText"`
	// Ish joyi koordinatalari (xaritadan tanlanadi). Viloyat/tuman shulardan
	// avtomatik aniqlanadi — ish beruvchi qo'lda kiritmaydi.
	Lat           float64  `json:"lat"`
	Lng           float64  `json:"lng"`
	Region        string   `json:"region"`
	District      string   `json:"district"`
	WorkersNeeded int      `json:"workersNeeded" validate:"required,gte=1"`
	PricingType   string   `json:"pricingType"` // per_worker|total|negotiable
	PriceAmount   int64    `json:"priceAmount"`
	StartDate     string   `json:"startDate"`
	WorkTimeFrom  string   `json:"workTimeFrom"`
	WorkTimeTo    string   `json:"workTimeTo"`
	ContactPhone  string   `json:"contactPhone"`
	Gender        string   `json:"gender"` // male|female|mixed (bo'sh => mixed)
	Images        []string `json:"images"`
}

// normalizeGender e'lon jinsini kanonik qiymatga keltiradi. Noma'lum yoki bo'sh
// qiymat "mixed" (aralash) bo'ladi — ya'ni standart holatda ish hammaga ochiq.
func normalizeGender(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "male":
		return "male"
	case "female":
		return "female"
	default:
		return "mixed"
	}
}

func (req *upsertReq) computePrice() (pType string, total int64, perWorker int64) {
	switch req.PricingType {
	case "per_worker":
		return "per_worker", req.PriceAmount * int64(req.WorkersNeeded), req.PriceAmount
	case "total":
		if req.WorkersNeeded <= 0 {
			return "negotiable", 0, 0
		}
		return "total", req.PriceAmount, req.PriceAmount / int64(req.WorkersNeeded)
	default:
		if req.PriceAmount <= 0 {
			return "negotiable", 0, 0
		}
		return "per_worker", req.PriceAmount * int64(req.WorkersNeeded), req.PriceAmount
	}
}

// AttachModerator ixtiyoriy kontent tekshiruvini ulaydi
// (notification.Service.AttachPusher bilan bir xil naqsh: tashqi xizmat
// konstruktorni o'zgartirmasdan, mavjud bo'lsa qo'shiladi).
//
// guard o'chiq bo'lsa hech narsa o'zgarmaydi — moderatsiya faqat
// /api/moderation/* endpointlari orqali ishlatiladi.
func (h *Handler) AttachModerator(g *moderation.Guard, maxImageBytes int64) {
	h.guard = g
	h.maxImageBytes = maxImageBytes
}

// Rad etish xabarlari. Yaratish va TAHRIRLASH ataylab farq qiladi:
// tahrirda e'lon o'z joyida qoladi va faqat o'zgartirish saqlanmaydi —
// "E'lon qabul qilinmadi" desak, foydalanuvchi e'loni o'chib ketdi deb
// o'ylaydi.
const (
	elonCreateReasonPrefix = "E'lon qabul qilinmadi"
	elonUpdateReasonPrefix = "O'zgartirish saqlanmadi"
	// elonUpdateNote — tahrir rad etilganda qo'shiladigan tinchlantiruvchi
	// jumla: foydalanuvchining birinchi savoli "e'lonim yo'qoldimi?" bo'ladi.
	elonUpdateNote = "E'lon avvalgi holatida qoldi."
)

// withNote — rad etish xabariga qo'shimcha jumla qo'shadi.
//
// Faqat rad etish xatolariga (matn va rasm) tegadi: 503 (moderatsiya
// ishlamayapti) kabi xatolarda "e'lon avvalgi holatida qoldi" deyish
// o'rinsiz bo'lardi — u yerda tekshiruv umuman bo'lmagan.
func withNote(err error, note string) error {
	var he *httpx.HTTPError
	if errors.As(err, &he) && (he.Code == "content_rejected" || he.Code == "image_rejected") {
		return httpx.NewError(he.Status, he.Code, he.Message+" "+note)
	}
	return err
}

// moderateElon — e'lonni CHOP ETISHDAN OLDIN to'liq tekshiradi: sarlavha +
// tavsif, so'ng (bo'lsa) har bir rasm.
//
// Tartib ataylab shunday: matn bitta arzon chaqiruv, rasm esa har biri
// alohida. Matn rad etilsa rasmlarga umuman pul sarflanmaydi.
//
// Tashqi xizmat yiqilganda standart qaror — o'tkazib yuborish (fail-open):
// Gemini uzilganda butun e'lon joylash oqimini to'xtatish bitta nomaqbul
// e'lon o'tib ketishidan og'irroq zarar. FailClosed buni teskarisiga
// o'giradi. Har ikki holatda ham xato logga yoziladi.
func (h *Handler) moderateElon(ctx context.Context, uid primitive.ObjectID, req *upsertReq) (bool, error) {
	if !h.guard.On() {
		return false, nil
	}
	out, err := h.guard.CheckText(ctx, uid, "elon", elonCreateReasonPrefix, req.Title, req.Description)
	if err != nil {
		return false, err
	}
	skipped := out == moderation.OutcomeSkipped
	imgSkipped, err := h.moderateImages(ctx, uid, req.Images, elonCreateReasonPrefix)
	return skipped || imgSkipped, err
}

// moderateElonUpdate — TAHRIRLASHDA tekshiruv (PATCH /api/elons/{id}).
//
// Create'dan farqi: faqat O'ZGARGAN qism tekshiriladi.
//   - matn — sarlavha yoki tavsif o'zgargan bo'lsagina;
//   - rasm — faqat YANGI qo'shilganlari (eskilari e'lon joylanganda
//     allaqachon tekshirilgan).
//
// Sabab: narxni yoki ish vaqtini o'zgartirgan tahrir tashqi so'rovga pul
// sarflamasligi kerak. Ayni paytda foydalanuvchi toza e'lon joylab, keyin uni
// tahrirlab nomaqbul matn yoki rasm qo'sha olmaydi — aynan shu teshik yopiladi.
//
// prev nil bo'lsa (avvalgi hujjat topilmadi) hammasi tekshiriladi — xavfsiz
// tomonga og'amiz.
func (h *Handler) moderateElonUpdate(ctx context.Context, uid primitive.ObjectID, req *upsertReq, prev *models.Elon) (bool, error) {
	if !h.guard.On() {
		return false, nil
	}
	skipped := false
	if prev == nil || !sameText(req.Title, prev.Title) || !sameText(req.Description, prev.Description) {
		out, err := h.guard.CheckText(ctx, uid, "elon-update", elonUpdateReasonPrefix, req.Title, req.Description)
		if err != nil {
			return false, withNote(err, elonUpdateNote)
		}
		skipped = out == moderation.OutcomeSkipped
	}
	if req.Images == nil {
		// Rasm maydoni umuman yuborilmagan — mavjud rasmlar o'zgarmaydi.
		return skipped, nil
	}
	var old []string
	if prev != nil {
		old = prev.Images
	}
	imgSkipped, err := h.moderateImages(ctx, uid, addedImages(req.Images, old), elonUpdateReasonPrefix)
	if err != nil {
		return false, withNote(err, elonUpdateNote)
	}
	return skipped || imgSkipped, nil
}

// sameText — bo'sh joylarni hisobga olmasdan taqqoslaydi.
func sameText(a, b string) bool { return strings.TrimSpace(a) == strings.TrimSpace(b) }

// addedImages — next da bor, prev da yo'q rasmlar (kirish tartibi saqlanadi).
func addedImages(next, prev []string) []string {
	if len(prev) == 0 {
		return next
	}
	had := make(map[string]bool, len(prev))
	for _, u := range prev {
		had[u] = true
	}
	out := make([]string, 0, len(next))
	for _, u := range next {
		if !had[u] {
			out = append(out, u)
		}
	}
	return out
}

// moderateImages — e'lon rasmlarini tekshiradi.
//
// Rasmlar so'rovda URL bo'lib keladi (klient ularni avval /api/uploads ga
// yuklagan), shuning uchun baytlar storage'dan qaytarib o'qiladi — URL'ni
// Gemini'ga URL sifatida uzatib bo'lmaydi — u faqat inline baytlarni oladi.
//
// Chaqiruvlar parallel: e'londa 6 tagacha rasm bo'lishi mumkin, ketma-ket
// tekshirish foydalanuvchini bir necha soniya kutishga majbur qilardi.
func (h *Handler) moderateImages(ctx context.Context, uid primitive.ObjectID, urls []string, reasonPrefix string) (bool, error) {
	if len(urls) == 0 || h.Storage == nil {
		return false, nil
	}
	type outcome struct {
		res *moderation.Result
		err error
	}
	results := make([]outcome, len(urls))
	var wg sync.WaitGroup
	for i, url := range urls {
		wg.Add(1)
		go func(i int, url string) {
			defer wg.Done()
			data, err := h.Storage.Download(ctx, h.Storage.KeyFromURL(url), h.maxImageBytes)
			if err != nil {
				results[i] = outcome{err: fmt.Errorf("download %s: %w", url, err)}
				return
			}
			res, err := h.guard.Service().CheckImage(ctx, sniffImageMIME(data), data)
			results[i] = outcome{res: res, err: err}
		}(i, url)
	}
	wg.Wait()

	// Natijalarni KIRISH tartibida ko'rib chiqamiz, shunda bir nechta rasm
	// muammoli bo'lsa ham javob doim bir xil (birinchi rasm haqida) bo'ladi.
	skipped := false
	for i, o := range results {
		if o.err != nil {
			// Kvota tugagan bo'lsa bu nil qaytaradi va rasm tekshirilmasdan
			// o'tadi — e'lon "keyin ko'riladi" deb belgilanadi.
			if err := h.guard.Unavailable("elon-image", o.err); err != nil {
				return false, err
			}
			skipped = true
			continue
		}
		if !o.res.Allowed {
			// Rad etilgan rasm endi hech qaysi e'longa tegishli emas va
			// storage'da yetim qolardi. Loyihaning o'z tozalash yordamchisi
			// bilan o'chiramiz (best-effort, xatosi log qilinadi).
			go upload.DeleteByURL(h.Storage, urls[i])
			return false, h.guard.Reject(ctx, uid, "elon-image", "image_rejected", o.res, reasonPrefix)
		}
	}
	return skipped, nil
}

// sniffImageMIME — baytlardan rasm turini aniqlaydi. Fayl nomiga yoki
// saqlangan Content-Type'ga ishonilmaydi.
func sniffImageMIME(data []byte) string {
	n := len(data)
	if n > 512 {
		n = 512
	}
	return strings.ToLower(strings.TrimSpace(
		strings.SplitN(http.DetectContentType(data[:n]), ";", 2)[0]))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req upsertReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateUpsert(&req); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateStartDate(req.StartDate, time.Now(), false); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateURLs(&req, h.Storage, uid.Hex()); err != nil {
		httpx.Err(w, err)
		return
	}
	// Kontent moderatsiyasi (matn + rasmlar) — arzon tekshiruvlardan KEYIN
	// (bekorga tashqi so'rov qilinmasin), bazaga yozishdan OLDIN. Ya'ni rad
	// etilgan e'lon bazaga umuman tushmaydi va feedda ko'rinmaydi.
	modSkipped, err := h.moderateElon(r.Context(), uid, &req)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	catID, err := primitive.ObjectIDFromHex(req.CategoryID)
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_request", "bad categoryId"))
		return
	}
	var cat models.Category
	if err := h.Categories.FindOne(r.Context(), bson.M{"_id": catID}).Decode(&cat); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "category not found"))
		return
	}
	pType, total, per := req.computePrice()

	var owner models.User
	_ = h.Users.FindOne(r.Context(), bson.M{"_id": uid}).Decode(&owner)

	// Viloyat/tuman koordinatadan avtomatik aniqlanadi (ish beruvchi xato
	// kiritmasligi uchun). Manzil matni saqlanmaydi — aniq koordinata bor.
	region, district := resolveLocation(r.Context(), req.Lat, req.Lng, req.Region, req.District)
	locationURL := req.LocationURL
	if locationURL == "" && (req.Lat != 0 || req.Lng != 0) {
		locationURL = mapsURL(req.Lat, req.Lng)
	}

	now := time.Now()
	// E'lon darhol chop etiladi — alohida "qoralama" bosqichi yo'q.
	e := models.Elon{
		OwnerID:           uid,
		Title:             strings.TrimSpace(req.Title),
		CategoryID:        catID,
		CategoryName:      cat.Name,
		Description:       req.Description,
		LocationURL:       locationURL,
		Lat:               req.Lat,
		Lng:               req.Lng,
		Region:            region,
		District:          district,
		WorkersNeeded:     req.WorkersNeeded,
		PricingType:       pType,
		PriceAmount:       total,
		PerWorkerAmount:   per,
		StartDate:         req.StartDate,
		WorkTimeFrom:      req.WorkTimeFrom,
		WorkTimeTo:        req.WorkTimeTo,
		ContactPhone:      req.ContactPhone,
		Gender:            normalizeGender(req.Gender),
		Status:            "recruiting",
		PublishedAt:       &now,
		CreatedAt:         now,
		UpdatedAt:         now,
		OwnerName:         strings.TrimSpace(owner.FirstName + " " + owner.LastName),
		OwnerRating:       owner.Rating,
		OwnerReviewsCount: owner.ReviewsCount,
		OwnerAvatarURL:    owner.AvatarURL,
		Images:            req.Images,
		// E'lonni Google Play demo hisobi yaratgan bo'lsa belgilaymiz: bunday
		// e'lonlar feed/qidiruv/sitemap'dan chiqariladi, ya'ni real
		// foydalanuvchi ularni hech qachon ko'rmaydi. Egasining o'z
		// ro'yxatida ("mening e'lonlarim") ko'rinaveradi, shuning uchun
		// reviewer to'liq oqimni sinay oladi.
		IsReviewData: httpx.IsReviewActor(r.Context()),
		// AI kvotasi tugagan paytda chop etilgan e'lon — keyin qo'lda
		// ko'rib chiqiladi. Foydalanuvchi buni bilmaydi (json:"-").
		ModerationPending: modSkipped,
	}
	res, err := h.Col.InsertOne(r.Context(), e)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	e.ID = res.InsertedID.(primitive.ObjectID)
	category.IncrementUsage(r.Context(), h.Categories, catID)
	httpx.JSON(w, 201, e)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var e models.Elon
	if err := h.Col.FindOne(r.Context(), bson.M{"_id": id, "isDeleted": bson.M{"$ne": true}}).Decode(&e); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}
	caller, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	participant := caller == e.OwnerID
	if !participant && !caller.IsZero() {
		n, _ := h.Applications.CountDocuments(r.Context(), bson.M{
			"elonId": id, "$or": []bson.M{{"workerId": caller}, {"employerId": caller}},
		}, options.Count().SetLimit(1))
		participant = n > 0
	}
	publicStatus := e.Status == "recruiting" || e.Status == "filled"
	if (e.IsReviewData && !httpx.IsReviewActor(r.Context())) ||
		((e.OwnerBlocked || !publicStatus) && !participant) {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}
	// bump view count async (worker navbati orqali; to'lsa — tashlanadi)
	select {
	case h.viewBumps <- id:
	default:
	}
	list := []models.Elon{e}
	h.liveOwnerAvatars(r.Context(), list)
	httpx.JSON(w, 200, list[0])
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req upsertReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateUpsert(&req); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateStartDate(req.StartDate, time.Now(), true); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := validateURLs(&req, h.Storage, uid.Hex()); err != nil {
		httpx.Err(w, err)
		return
	}
	// Avvalgi holat ikki joyda kerak: moderatsiya faqat O'ZGARGAN qismni
	// tekshirishi uchun va quyidagi rasm farqi uchun. Ilgari u faqat rasm
	// farqi uchun olinardi — endi bitta so'rov ikkalasiga xizmat qiladi.
	var prev *models.Elon
	{
		var doc models.Elon
		if err := h.Col.FindOne(r.Context(), bson.M{"_id": id, "ownerId": uid}).Decode(&doc); err == nil {
			prev = &doc
		}
	}
	// Kontent moderatsiyasi — geokodlash va bazaga yozishdan OLDIN, ya'ni rad
	// etilgan tahrir hech qanday iz qoldirmaydi (rasm farqi ham bajarilmaydi).
	modSkipped, err := h.moderateElonUpdate(r.Context(), uid, &req, prev)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	pType, total, per := req.computePrice()
	region, district := resolveLocation(r.Context(), req.Lat, req.Lng, req.Region, req.District)
	locationURL := req.LocationURL
	if locationURL == "" && (req.Lat != 0 || req.Lng != 0) {
		locationURL = mapsURL(req.Lat, req.Lng)
	}
	// Image diff: delete any S3 images that are removed from the new list.
	if req.Images != nil && prev != nil {
		keep := map[string]bool{}
		for _, u := range req.Images {
			keep[u] = true
		}
		for _, u := range prev.Images {
			if !keep[u] {
				go upload.DeleteByURL(h.Storage, u)
			}
		}
	}
	set := bson.M{
		"title":           req.Title,
		"description":     req.Description,
		"locationUrl":     locationURL,
		"lat":             req.Lat,
		"lng":             req.Lng,
		"region":          region,
		"district":        district,
		"workersNeeded":   req.WorkersNeeded,
		"pricingType":     pType,
		"priceAmount":     total,
		"perWorkerAmount": per,
		"startDate":       req.StartDate,
		"workTimeFrom":    req.WorkTimeFrom,
		"workTimeTo":      req.WorkTimeTo,
		"contactPhone":    req.ContactPhone,
		"gender":          normalizeGender(req.Gender),
		"updatedAt":       time.Now(),
		// Tekshirilmasdan saqlangan tahrir keyin qo'lda ko'riladi.
		"moderationPending": modSkipped,
	}
	if req.Images != nil {
		set["images"] = req.Images
	}
	if req.CategoryID != "" {
		if catID, err := primitive.ObjectIDFromHex(req.CategoryID); err == nil {
			var cat models.Category
			if err := h.Categories.FindOne(r.Context(), bson.M{"_id": catID}).Decode(&cat); err == nil {
				set["categoryId"] = catID
				set["categoryName"] = cat.Name
			}
		}
	}
	res := h.Col.FindOneAndUpdate(r.Context(),
		bson.M{"_id": id, "ownerId": uid, "status": bson.M{"$in": []string{"draft", "recruiting", "filled"}}},
		bson.M{"$set": set},
		options.FindOneAndUpdate().SetReturnDocument(options.After))
	var e models.Elon
	if err := res.Decode(&e); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found_or_forbidden", "elon not found or not yours"))
		return
	}
	httpx.JSON(w, 200, e)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	// Rasmlarni S3/diskdan o'chirish uchun oldin o'qib olamiz.
	var prev models.Elon
	_ = h.Col.FindOne(r.Context(), bson.M{"_id": id, "ownerId": uid}).Decode(&prev)
	// E'lonni bazadan BUTUNLAY o'chiramiz (soft-delete emas).
	res, err := h.Col.DeleteOne(r.Context(), bson.M{"_id": id, "ownerId": uid})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.DeletedCount == 0 {
		httpx.Err(w, httpx.NewError(404, "not_found_or_forbidden", "elon not found or not yours"))
		return
	}
	// Shu e'longa bog'liq arizalarni ham o'chiramiz (bog'liqsiz yozuvlar qolmasligi uchun).
	_, _ = h.Applications.DeleteMany(r.Context(), bson.M{"elonId": id})
	for _, u := range prev.Images {
		go upload.DeleteByURL(h.Storage, u)
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// Cancel: e'lon egasi o'z e'lonini yopadi — ilovadagi "E'lonni o'chirish".
//
// Yozuv bazadan o'chirilmaydi (Delete dan farqi shu): `status` "cancelled"
// bo'lgani uchun e'lon ommaviy feeddan chiqadi va yangi ariza qabul qilmaydi,
// ammo egasining "E'lon qilingan ishlar" tarixida "Bekor qilingan" holatida
// ko'rinib turadi. `isDeleted` ataylab tegilmaydi — aks holda egasi o'sha
// karta ustidan e'lon tafsilotlarini ocholmay qolardi (Get uni filtrlaydi).
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	// Faqat hali ochiq e'lonni bekor qilish mumkin: yakunlangan ish tarixi
	// o'zgarmasligi va e'lon ikki marta bekor qilinmasligi kerak.
	res := h.Col.FindOneAndUpdate(r.Context(),
		bson.M{"_id": id, "ownerId": uid, "status": bson.M{"$in": []string{"draft", "recruiting", "filled", "in_progress"}}},
		bson.M{"$set": bson.M{"status": "cancelled", "updatedAt": time.Now()}},
		options.FindOneAndUpdate().SetReturnDocument(options.After))
	var e models.Elon
	if err := res.Decode(&e); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found_or_forbidden", "elon not found or not yours"))
		return
	}
	// Javob kutayotgan yoki qabul qilingan arizalar ochiq qolib ketmasin —
	// ishchi bekor qilingan ishni kutib o'tirmasligi uchun ular ham yopiladi.
	cur, cerr := h.Applications.Find(r.Context(),
		bson.M{"elonId": id, "status": bson.M{"$in": []string{"pending", "accepted"}}})
	workers := []primitive.ObjectID{}
	if cerr == nil {
		for cur.Next(r.Context()) {
			var a models.Application
			if cur.Decode(&a) == nil {
				workers = append(workers, a.WorkerID)
			}
		}
		cur.Close(r.Context())
	}
	_, _ = h.Applications.UpdateMany(r.Context(),
		bson.M{"elonId": id, "status": bson.M{"$in": []string{"pending", "accepted"}}},
		bson.M{"$set": bson.M{
			"status":       "cancelled",
			"cancelledBy":  "employer",
			"cancelReason": "E'lon bekor qilindi",
			"decidedAt":    time.Now(),
		}})
	if h.Notify != nil {
		for _, wid := range workers {
			h.Notify.Push(r.Context(), wid, "application_cancelled", "Ariza bekor qilindi",
				e.Title+" — e'lon bekor qilindi", &models.RelatedEntity{Type: "elon", ID: id})
		}
	}
	httpx.JSON(w, 200, e)
}

// Feed: public listing for recruiting only (paged). Ish o'rinlari to'lgan
// (filled) e'lonlar ro'yxatda ko'rinmaydi.
func (h *Handler) Feed(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	cat := strings.TrimSpace(r.URL.Query().Get("categoryId"))
	gender := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("gender")))
	region := strings.TrimSpace(r.URL.Query().Get("region"))
	minPrice, _ := strconv.ParseInt(r.URL.Query().Get("minPrice"), 10, 64)
	maxPrice, _ := strconv.ParseInt(r.URL.Query().Get("maxPrice"), 10, 64)
	sort := r.URL.Query().Get("sort") // price|time|rating
	if len([]rune(q)) > 200 || len([]rune(region)) > 100 || len(cat) > 64 {
		httpx.Err(w, httpx.NewError(400, "query_too_long", "filter value is too long"))
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 24
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	} else if page > 10_000 {
		page = 10_000
	}
	// Faol e'lon filtri — o'chirilmagan, egasi bloklanmagan, hali `recruiting`
	// va vaqti o'tmagan (kechagi/eski e'lonlar va bugun bo'lib o'tganlari
	// feedda ko'rinmaydi). Kategoriya sanoqlari ham shu filtrdan foydalanadi.
	//
	// Google Play demo hisobi yaratgan e'lonlar ommaviy feedga hech qachon
	// tushmaydi. Demo hisobning o'ziga esa ular ko'rinadi: reviewer e'lon
	// joylagandan keyin uni feedda topa olmasa, ilova buzuq deb o'ylashi
	// mumkin edi.
	filter := elonquery.ActiveFilter(time.Now(), httpx.IsReviewActor(r.Context()))
	if q != "" {
		rx := primitive.Regex{Pattern: regexpEscape(q), Options: "i"}
		filter["$or"] = []bson.M{{"title": rx}, {"description": rx}, {"locationText": rx}, {"categoryName": rx}}
	}
	if cat != "" {
		if cid, err := primitive.ObjectIDFromHex(cat); err == nil {
			filter["categoryId"] = cid
		}
	}
	// Jins bo'yicha filtr. "aralash" eski/bo'sh (gender saqlanmagan) e'lonlarni
	// ham qamrab oladi — ular hech kimga tegishli emas deb yo'qolib qolmasin.
	switch gender {
	case "male":
		filter["gender"] = "male"
	case "female":
		filter["gender"] = "female"
	case "mixed":
		filter["gender"] = bson.M{"$in": bson.A{"mixed", "", nil}}
	}
	// Joylashuv (viloyat) bo'yicha filtr.
	if region != "" {
		filter["region"] = region
	}
	// Narx (ishchi boshiga) bo'yicha oraliq filtri. Kelishiladigan (perWorkerAmount=0)
	// e'lonlar narx oralig'i berilganda ro'yxatga tushmaydi.
	if minPrice > 0 || maxPrice > 0 {
		priceRange := bson.M{}
		if minPrice > 0 {
			priceRange["$gte"] = minPrice
		}
		if maxPrice > 0 {
			priceRange["$lte"] = maxPrice
		}
		filter["perWorkerAmount"] = priceRange
	}
	sortDoc := bson.D{{Key: "publishedAt", Value: -1}}
	switch sort {
	case "price":
		sortDoc = bson.D{{Key: "perWorkerAmount", Value: -1}}
	case "rating":
		sortDoc = bson.D{{Key: "ownerRating", Value: -1}}
	case "time":
		sortDoc = bson.D{{Key: "publishedAt", Value: -1}}
	}
	cur, err := h.Col.Find(r.Context(), filter,
		options.Find().SetSort(sortDoc).SetSkip(int64((page-1)*limit)).SetLimit(int64(limit)))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Elon{}
	for cur.Next(r.Context()) {
		var e models.Elon
		if err := cur.Decode(&e); err == nil {
			out = append(out, e)
		}
	}
	h.liveOwnerAvatars(r.Context(), out)
	total, _ := h.Col.CountDocuments(r.Context(), filter)
	httpx.JSON(w, 200, map[string]any{"items": out, "page": page, "limit": limit, "total": total})
}

// liveOwnerAvatars — e'lonlardagi ish beruvchi avatarini joriy (eng oxirgi)
// qiymatga yangilaydi. Saqlangan snapshot emas, jonli: foydalanuvchi rasmini
// e'londan keyin qo'ysa/o'zgartirsa ham feed va boshqa ro'yxatlarda darhol
// yangisi ko'rinadi. Bir nechta ro'yxat (masalan active+archived) berilsa ham
// bitta so'rov bilan ishlaydi (N+1 yo'q).
func (h *Handler) liveOwnerAvatars(ctx context.Context, groups ...[]models.Elon) {
	ids := []primitive.ObjectID{}
	for _, es := range groups {
		for _, e := range es {
			ids = append(ids, e.OwnerID)
		}
	}
	m := userlookup.Avatars(ctx, h.Users, ids)
	for _, es := range groups {
		for i := range es {
			if v, ok := m[es[i].OwnerID]; ok {
				es[i].OwnerAvatarURL = v
			}
		}
	}
}

// sitemapMaxLimit — XML sitemap uchun bitta so'rovda qaytariladigan maksimal
// e'lonlar soni. Google bitta sitemap fayliga 50 000 URL limiti bilan mos.
const sitemapMaxLimit = 50000

// sitemapItem — sitemap uchun eng yengil proyeksiya (faqat URL + lastModified
// uchun kerakli maydonlar). To'liq e'lon yuklanmaydi.
type sitemapItem struct {
	ID          primitive.ObjectID `json:"id"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	CreatedAt   time.Time          `json:"createdAt"`
	PublishedAt *time.Time         `json:"publishedAt,omitempty"`
}

// Sitemap: XML sitemap uchun FAOL e'lonlar ro'yxati (id + vaqtlar).
//
// Feed bilan bir xil "faol" filtridan foydalanadi (recruiting, o'chirilmagan,
// vaqti o'tmagan) — shu sabab sitemap va ommaviy feed doim mos bo'ladi.
// Proyeksiya + katta `limit` (50k gacha) tufayli N+1 so'rov bo'lmaydi:
// har bir sitemap bo'lagi bitta optimal so'rov bilan olinadi.
func (h *Handler) Sitemap(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > sitemapMaxLimit {
		limit = sitemapMaxLimit
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	// Demo e'lonlar sitemap'ga ham tushmaydi — aks holda ular Google'ga
	// indekslanish uchun berilgan bo'lardi.
	filter := elonquery.ActiveFilter(time.Now(), false)

	// Barqaror tartib (_id) + proyeksiya — sahifalash to'g'ri ishlashi va
	// so'rov yengil bo'lishi uchun. (Juda katta hajmda keyinchalik _id-range
	// pagination'ga o'tish mumkin; hozircha skip yetarli.)
	opts := options.Find().
		SetProjection(bson.M{"_id": 1, "updatedAt": 1, "createdAt": 1, "publishedAt": 1}).
		SetSort(bson.D{{Key: "_id", Value: 1}}).
		SetSkip(int64((page - 1) * limit)).
		SetLimit(int64(limit))

	cur, err := h.Col.Find(r.Context(), filter, opts)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())

	out := []sitemapItem{}
	for cur.Next(r.Context()) {
		var e models.Elon
		if err := cur.Decode(&e); err == nil {
			out = append(out, sitemapItem{
				ID:          e.ID,
				UpdatedAt:   e.UpdatedAt,
				CreatedAt:   e.CreatedAt,
				PublishedAt: e.PublishedAt,
			})
		}
	}
	total, _ := h.Col.CountDocuments(r.Context(), filter)

	// CDN/proxy uchun ham 5 daqiqa cache (frontend ISR bilan mos — #7).
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=60")
	httpx.JSON(w, 200, map[string]any{"items": out, "page": page, "limit": limit, "total": total})
}

// MyElons: owner's elons grouped by status.
func (h *Handler) MyElons(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	cur, err := h.Col.Find(r.Context(),
		bson.M{"ownerId": uid},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	now := time.Now()
	active := []models.Elon{}
	archived := []models.Elon{}
	for cur.Next(r.Context()) {
		var e models.Elon
		if err := cur.Decode(&e); err != nil {
			continue
		}
		// Faol = hozir ishchilarga ko'rinadigan (feeddagi kabi): o'chirilmagan,
		// hali ochiq (recruiting/filled/in_progress) va belgilangan vaqti o'tmagan.
		open := e.Status == "recruiting" || e.Status == "filled" || e.Status == "in_progress"
		if !e.IsDeleted && open && !isExpired(e, now, elonquery.FeedExpiryGrace) {
			active = append(active, e)
		} else {
			// Arxiv = vaqti o'tgan, yakunlangan yoki bekor qilingan e'lonlar.
			archived = append(archived, e)
		}
	}
	h.liveOwnerAvatars(r.Context(), active, archived)
	httpx.JSON(w, 200, map[string]any{"active": active, "archived": archived})
}

// uzTZ — O'zbekiston vaqti (UTC+5, yozgi vaqt yo'q); elonquery.NotExpiredExpr'dagi
// "Asia/Tashkent" bilan mos keladi.
var uzTZ = time.FixedZone("UZT", 5*3600)

// maxScheduleDays — ish faqat shu qadar kun oldinga joylashtiriladi: bugun (0),
// erta (1) va indin (2). Ya'ni ruxsat etilgan oraliq [bugun .. bugun+2 kun].
const maxScheduleDays = 2

// validateStartDate — startDate O'zbekiston vaqti bo'yicha bugundan indingacha
// (0..maxScheduleDays kun) oralig'ida ekanini tekshiradi. Faqat kun qismi
// (YYYY-MM-DD) muhim; soat e'tiborga olinmaydi. Bo'sh startDate ruxsat etiladi
// (ixtiyoriy maydon) — mavjud xatti-harakat buzilmasligi uchun.
//
// allowPast=true bo'lsa o'tgan sana ta'qiqlanmaydi (tahrirlashda: e'lon avval
// joylashtirilib, vaqti allaqachon o'tgan bo'lishi mumkin). Kelajakdagi yuqori
// chegara (bugun+maxScheduleDays) esa har doim tekshiriladi.
func validateStartDate(startDate string, now time.Time, allowPast bool) error {
	s := strings.TrimSpace(startDate)
	if s == "" {
		return nil
	}
	datePart := s
	if len(s) >= 10 {
		datePart = s[:10]
	}
	day, err := time.ParseInLocation("2006-01-02", datePart, uzTZ)
	if err != nil {
		return httpx.NewError(400, "bad_start_date", "invalid start date")
	}
	nowUz := now.In(uzTZ)
	today := time.Date(nowUz.Year(), nowUz.Month(), nowUz.Day(), 0, 0, 0, 0, uzTZ)
	maxDay := today.AddDate(0, 0, maxScheduleDays)
	if !allowPast && day.Before(today) {
		return httpx.NewError(400, "start_date_past", "start date cannot be in the past")
	}
	if day.After(maxDay) {
		return httpx.NewError(400, "start_date_too_far", "start date can be at most 3 days ahead (today, tomorrow or the day after)")
	}
	return nil
}

// ScheduledStart — e'lon belgilangan boshlanish vaqtini (instant) qaytaradi.
// Kun startDate'dan, soat startDate ichidan (to'liq ISO sana-vaqt bo'lsa),
// bo'lmasa workTimeFrom'dan, u ham bo'lmasa kun oxiri (23:59) deb olinadi;
// naive vaqt Asia/Tashkent bo'yicha talqin qilinadi. Mantiq elonquery.NotExpiredExpr
// (feed filtri) bilan bir xil. startDate bo'sh yoki noto'g'ri bo'lsa ok=false
// qaytadi (belgilangan vaqt yo'q — chaqiruvchi shu holatni hisobga oladi).
func ScheduledStart(e models.Elon) (time.Time, bool) {
	s := strings.TrimSpace(e.StartDate)
	if s == "" {
		return time.Time{}, false
	}
	datePart := s
	if len(s) >= 10 {
		datePart = s[:10]
	}
	timePart := ""
	if len(s) >= 16 {
		timePart = s[11:16] // to'liq ISO sana-vaqtdan HH:MM
	}
	if timePart == "" {
		if wf := strings.TrimSpace(e.WorkTimeFrom); wf != "" {
			timePart = wf
		} else {
			timePart = "23:59"
		}
	}
	start, err := time.ParseInLocation("2006-01-02T15:04", datePart+"T"+timePart, uzTZ)
	if err != nil {
		return time.Time{}, false
	}
	return start, true
}

// isExpired — e'lon belgilangan boshlanish vaqtidan `grace` dan ko'p o'tgan
// bo'lsa true qaytaradi. Bo'sh yoki noto'g'ri sana muddati o'tmagan deb
// hisoblanadi (e'lon tasodifan arxivga tushib qolmasligi uchun).
func isExpired(e models.Elon, now time.Time, grace time.Duration) bool {
	start, ok := ScheduledStart(e)
	if !ok {
		return false
	}
	return start.Before(now.Add(-grace))
}

// resolveLocation aniqlangan koordinatadan viloyat/tuman qaytaradi. Reverse
// geocoding muvaffaqiyatsiz bo'lsa, klient yuborgan qiymatlarga qaytadi.
func resolveLocation(ctx context.Context, lat, lng float64, fallbackRegion, fallbackDistrict string) (string, string) {
	if lat != 0 || lng != 0 {
		if p, err := geocode.Reverse(ctx, lat, lng); err == nil {
			region := p.Region
			district := p.District
			if region == "" {
				region = strings.TrimSpace(fallbackRegion)
			}
			if district == "" {
				district = strings.TrimSpace(fallbackDistrict)
			}
			return region, district
		}
	}
	return strings.TrimSpace(fallbackRegion), strings.TrimSpace(fallbackDistrict)
}

func mapsURL(lat, lng float64) string {
	return fmt.Sprintf("https://www.google.com/maps?q=%f,%f", lat, lng)
}

// validateURLs rejects any user-supplied URL that isn't a safe http(s) link.
// locationUrl and images are later rendered in hrefs/img on other users'
// browsers, so a javascript:/data: value would be a stored-XSS vector.
func validateURLs(req *upsertReq, store *storage.Service, userID string) error {
	if !httpx.IsSafeHTTPURL(req.LocationURL) {
		return httpx.NewError(400, "bad_location_url", "location url must be http(s)")
	}
	for _, img := range req.Images {
		if strings.TrimSpace(img) == "" || store == nil || !store.URLBelongsToUser(img, userID) {
			return httpx.NewError(400, "bad_image_url", "image must be uploaded by this account")
		}
	}
	return nil
}

func validateUpsert(req *upsertReq) error {
	title := strings.TrimSpace(req.Title)
	description := strings.TrimSpace(req.Description)
	if title == "" || description == "" || req.WorkersNeeded < 1 {
		return httpx.NewError(400, "bad_request", "title, description and workersNeeded required")
	}
	if len([]rune(title)) > 160 || len([]rune(description)) > 5000 {
		return httpx.NewError(400, "too_long", "title or description is too long")
	}
	if req.WorkersNeeded > 100 || req.PriceAmount < 0 || req.PriceAmount > 1_000_000_000_000 {
		return httpx.NewError(400, "bad_amount", "workers or price is out of range")
	}
	if len(req.Images) > 6 {
		return httpx.NewError(400, "too_many_images", "at most 6 images are allowed")
	}
	if len(req.LocationURL) > 2048 || len([]rune(req.ContactPhone)) > 32 ||
		len([]rune(req.Region)) > 100 || len([]rune(req.District)) > 100 {
		return httpx.NewError(400, "too_long", "job field is too long")
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		return httpx.NewError(400, "bad_coordinates", "coordinates are out of range")
	}
	return nil
}

func regexpEscape(s string) string {
	r := strings.NewReplacer(
		".", `\.`, "*", `\*`, "+", `\+`, "?", `\?`, "(", `\(`,
		")", `\)`, "[", `\[`, "]", `\]`, "{", `\{`, "}", `\}`,
		"|", `\|`, "^", `\^`, "$", `\$`, `\`, `\\`,
	)
	return r.Replace(s)
}
