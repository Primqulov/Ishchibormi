package application

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/userlookup"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Apps   *mongo.Collection
	Elons  *mongo.Collection
	Users  *mongo.Collection
	Notify *notification.Service
}

func NewHandler(db *mongo.Database, n *notification.Service) *Handler {
	return &Handler{
		Apps:   db.Collection("applications"),
		Elons:  db.Collection("elons"),
		Users:  db.Collection("users"),
		Notify: n,
	}
}

type applyReq struct {
	Phone       string `json:"phone"`
	PeopleCount int    `json:"peopleCount"`
}

type cancelReq struct {
	Reason string `json:"reason"`
}

func (h *Handler) Apply(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	elonID, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad elon id"))
		return
	}
	var req applyReq
	_ = httpx.Decode(r, &req)

	var elon models.Elon
	if err := h.Elons.FindOne(r.Context(), bson.M{"_id": elonID, "isDeleted": bson.M{"$ne": true}}).Decode(&elon); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}
	if elon.OwnerID == uid {
		httpx.Err(w, httpx.NewError(400, "self_apply", "cannot apply to own elon"))
		return
	}
	// Demo e'lonlar feedda ko'rinmaydi, lekin havolasi qo'lga tushsa ham real
	// foydalanuvchi ularga ariza bera olmasligi kerak — aks holda u demo
	// hisob bilan aloqaga kirishib qolardi. Xato oddiy "topilmadi": demo
	// e'lonlar borligi tashqaridan bilinmasligi kerak.
	if elon.IsReviewData && !httpx.IsReviewActor(r.Context()) {
		httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
		return
	}
	if elon.Status != "recruiting" {
		// Ish o'rinlari to'lgan bo'lsa aniqroq xabar — sahifa eskirib qolib e'lon
		// hali ko'rinib turgan bo'lsa ham ishchi joy to'lganini biladi.
		if elon.Status == "filled" || (elon.WorkersNeeded > 0 && elon.AcceptedCount >= elon.WorkersNeeded) {
			httpx.Err(w, httpx.NewError(409, "elon_full", "Afsuski, bu ishga kerakli ishchilar allaqachon to'ldi."))
			return
		}
		httpx.Err(w, httpx.NewError(400, "not_recruiting", "Bu e'lon hozircha ariza qabul qilmayapti."))
		return
	}
	// Nechta kishi kelmoqchi. Kamida 1, va e'longa kerakli ishchilar sonidan
	// oshmasligi kerak (guruh bo'lib ariza berilganda mantiqiy chegara).
	people := req.PeopleCount
	if people < 1 {
		people = 1
	}
	if elon.WorkersNeeded > 0 && people > elon.WorkersNeeded {
		httpx.Err(w, httpx.NewError(400, "too_many_people", "kishilar soni e'londagi ishchilar sonidan ko'p bo'lishi mumkin emas"))
		return
	}
	// Bir kunga bitta ish: ishchi shu sanaga allaqachon qabul qilingan (hali
	// yakunlanmagan) ishi bo'lsa, ariza yuborilmaydi — ogohlantirish ishchiga
	// ko'rsatiladi (ish beruvchiga emas).
	if elon.StartDate != "" {
		acur, aerr := h.Apps.Find(r.Context(), bson.M{"workerId": uid, "status": "accepted"})
		if aerr == nil {
			var otherElonIDs []primitive.ObjectID
			for acur.Next(r.Context()) {
				var oa models.Application
				if acur.Decode(&oa) == nil {
					otherElonIDs = append(otherElonIDs, oa.ElonID)
				}
			}
			_ = acur.Close(r.Context())
			if len(otherElonIDs) > 0 {
				n, _ := h.Elons.CountDocuments(r.Context(), bson.M{"_id": bson.M{"$in": otherElonIDs}, "startDate": elon.StartDate})
				if n > 0 {
					httpx.Err(w, httpx.NewError(409, "worker_busy_day", "Siz shu kunga boshqa ishga qabul qilingansiz. Avvalgi ish yakunlangach ariza yuborishingiz mumkin."))
					return
				}
			}
		}
	}
	worker, _ := loadUser(r.Context(), h.Users, uid)
	phone := req.Phone
	if phone == "" && worker != nil {
		phone = worker.Phone
	}
	app := models.Application{
		ElonID:       elonID,
		ElonTitle:    elon.Title,
		WorkerID:     uid,
		EmployerID:   elon.OwnerID,
		WorkerPhone:  phone,
		PeopleCount:  people,
		Amount:       elon.PerWorkerAmount,
		IsNegotiable: elon.PricingType == "negotiable",
		Status:       "pending",
		AppliedAt:    time.Now(),
		// Elon snapshot (ishchining arizalar ro'yxati uchun).
		ElonCategoryName: elon.CategoryName,
		ElonRegion:       elon.Region,
		ElonDistrict:     elon.District,
		OwnerName:        elon.OwnerName,
		OwnerRating:      elon.OwnerRating,
		OwnerAvatarURL:   elon.OwnerAvatarURL,
		// Google Play demo hisobining arizasi bo'lsa belgilaymiz. Bunday ariza
		// ish beruvchining nomzodlar ro'yxatiga tushmaydi va unga bildirishnoma
		// yuborilmaydi (notification.Push'ga qarang), lekin reviewer uni o'z
		// "arizalarim" ro'yxatida ko'radi — ya'ni oqim to'liq sinaladi, real
		// ish beruvchi esa hech narsani sezmaydi.
		IsReviewData: httpx.IsReviewActor(r.Context()),
	}
	if worker != nil {
		// Worker snapshot (ish beruvchining nomzodlar ro'yxati uchun).
		app.WorkerName = strings.TrimSpace(worker.FirstName + " " + worker.LastName)
		app.WorkerRating = worker.WorkerRating
		app.WorkerReviewsCount = worker.WorkerReviewsCount
		app.WorkerAvatarURL = worker.AvatarURL
		app.WorkerVerified = worker.IsPhoneVerified
	}
	// Shu ishga oldingi arizani tekshiramiz. Unique indeks (elonId, workerId)
	// bir ish uchun bitta yozuvga ruxsat beradi, shuning uchun bekor qilingan
	// yoki rad etilgan arizani qayta faollashtiramiz (qayta ariza topshirish).
	var existing models.Application
	if err := h.Apps.FindOne(r.Context(), bson.M{"elonId": elonID, "workerId": uid}).Decode(&existing); err == nil {
		switch existing.Status {
		case "pending", "accepted":
			httpx.Err(w, httpx.NewError(409, "duplicate", "siz allaqachon ariza topshirgansiz"))
			return
		case "completed":
			httpx.Err(w, httpx.NewError(409, "already_done", "bu ish allaqachon yakunlangan"))
			return
		}
		// cancelled | rejected → o'sha yozuvni qayta faollashtiramiz.
		res := h.Apps.FindOneAndUpdate(r.Context(),
			bson.M{"_id": existing.ID},
			bson.M{
				"$set": bson.M{
					"status": "pending", "peopleCount": people, "workerPhone": phone,
					"amount": app.Amount, "isNegotiable": app.IsNegotiable, "appliedAt": time.Now(),
					"elonTitle": elon.Title, "elonCategoryName": elon.CategoryName,
					"elonRegion": elon.Region, "elonDistrict": elon.District,
					"ownerName": elon.OwnerName, "ownerRating": elon.OwnerRating,
					"ownerAvatarUrl": elon.OwnerAvatarURL,
					"workerName":     app.WorkerName, "workerRating": app.WorkerRating,
					"workerReviewsCount": app.WorkerReviewsCount, "workerAvatarUrl": app.WorkerAvatarURL,
					"workerVerified":        app.WorkerVerified,
					"employerConfirmedDone": false, "workerConfirmedDone": false,
					// Qayta faollashtirishda ham belgini tiklaymiz, aks holda
					// eski yozuv sandbox'dan chiqib ketishi mumkin.
					"isReviewData": app.IsReviewData,
				},
				"$unset": bson.M{"decidedAt": "", "cancelledBy": "", "cancelReason": "", "completedAt": ""},
			},
			options.FindOneAndUpdate().SetReturnDocument(options.After))
		if res.Err() != nil {
			httpx.Err(w, res.Err())
			return
		}
		var updated models.Application
		_ = res.Decode(&updated)
		h.Notify.Push(r.Context(), elon.OwnerID, "new_application", "Yangi ariza", "Sizning e'loningizga ariza tushdi: "+elon.Title, &models.RelatedEntity{Type: "application", ID: updated.ID})
		httpx.JSON(w, 201, updated)
		return
	}

	res, err := h.Apps.InsertOne(r.Context(), app)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "siz allaqachon ariza topshirgansiz"))
			return
		}
		httpx.Err(w, err)
		return
	}
	app.ID = res.InsertedID.(primitive.ObjectID)
	h.Notify.Push(r.Context(), elon.OwnerID, "new_application", "Yangi ariza", "Sizning e'loningizga ariza tushdi: "+elon.Title, &models.RelatedEntity{Type: "application", ID: app.ID})
	httpx.JSON(w, 201, app)
}

func (h *Handler) Accept(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, "accepted")
}
func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, "rejected")
}

func (h *Handler) decide(w http.ResponseWriter, r *http.Request, decision string) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	appID, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var app models.Application
	if err := h.Apps.FindOne(r.Context(), bson.M{"_id": appID}).Decode(&app); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "application not found"))
		return
	}
	if app.EmployerID != uid {
		httpx.Err(w, httpx.NewError(403, "forbidden", "not your application to decide"))
		return
	}
	if app.Status != "pending" {
		httpx.Err(w, httpx.NewError(400, "bad_state", "application is not pending"))
		return
	}
	now := time.Now()
	people := peopleOf(app)
	// Qabul qilishda ishchilar sonini inobatga olamiz: guruh arizasidagi kishilar
	// soni qolgan bo'sh o'rindan ko'p bo'lsa, qabul qilib bo'lmaydi (ish beruvchi
	// mos kishilik arizani tanlaydi).
	if decision == "accepted" {
		var pre models.Elon
		if err := h.Elons.FindOne(r.Context(), bson.M{"_id": app.ElonID}).Decode(&pre); err != nil {
			httpx.Err(w, httpx.NewError(404, "not_found", "elon not found"))
			return
		}
		if !hasEnoughSlots(pre.WorkersNeeded, pre.AcceptedCount, people) {
			httpx.Err(w, httpx.NewError(409, "not_enough_slots",
				fmt.Sprintf("Bu arizada %d kishi, ammo atigi %d o'rin qoldi. Kamroq kishilik arizani tanlang.", people, slotsRemaining(pre.WorkersNeeded, pre.AcceptedCount))))
			return
		}
	}
	set := bson.M{"status": decision, "decidedAt": now}
	if _, err := h.Apps.UpdateOne(r.Context(), bson.M{"_id": appID}, bson.M{"$set": set}); err != nil {
		httpx.Err(w, err)
		return
	}
	if decision == "accepted" {
		// increment elon acceptedCount by the number of people in this
		// application (guruh arizasi), mark filled if reached
		var elon models.Elon
		_ = h.Elons.FindOneAndUpdate(r.Context(),
			bson.M{"_id": app.ElonID},
			bson.M{"$inc": bson.M{"acceptedCount": people}, "$set": bson.M{"updatedAt": now}},
			options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&elon)
		filled := false
		if elon.AcceptedCount >= elon.WorkersNeeded && elon.Status == "recruiting" {
			_, _ = h.Elons.UpdateOne(r.Context(), bson.M{"_id": elon.ID}, bson.M{"$set": bson.M{"status": "filled"}})
			filled = true
		}
		h.Notify.Push(r.Context(), app.WorkerID, "application_accepted", "Arizangiz qabul qilindi", elon.Title, &models.RelatedEntity{Type: "application", ID: appID})

		// Joy to'lgach: shu e'londagi qolgan kutilayotgan arizalarni avtomatik
		// rad etamiz va har biriga "joy to'ldi" xabarini yuboramiz.
		if filled {
			rcur, rerr := h.Apps.Find(r.Context(), bson.M{"elonId": app.ElonID, "status": "pending"})
			if rerr == nil {
				var rest []models.Application
				for rcur.Next(r.Context()) {
					var ra models.Application
					if rcur.Decode(&ra) == nil {
						rest = append(rest, ra)
					}
				}
				_ = rcur.Close(r.Context())
				for _, ra := range rest {
					_, _ = h.Apps.UpdateOne(r.Context(), bson.M{"_id": ra.ID, "status": "pending"}, bson.M{"$set": bson.M{
						"status": "rejected", "decidedAt": now,
						"cancelReason": "Ish o'rinlari to'ldi",
					}})
					h.Notify.Push(r.Context(), ra.WorkerID, "application_rejected", "Joy to'ldi", ra.ElonTitle+" — ish o'rinlari to'ldi, arizangiz qabul qilinmadi", &models.RelatedEntity{Type: "application", ID: ra.ID})
				}
			}
		}
		// Bir kunga bitta ish: ishchi endi shu sanaga band. Uning shu kunga
		// yuborilgan boshqa kutilayotgan arizalarini avtomatik bekor qilamiz —
		// boshqa ish beruvchilar band ishchini qabul qilib qo'ymasligi uchun.
		if elon.StartDate != "" {
			pcur, perr := h.Apps.Find(r.Context(), bson.M{"workerId": app.WorkerID, "status": "pending", "_id": bson.M{"$ne": appID}})
			if perr == nil {
				var pend []models.Application
				for pcur.Next(r.Context()) {
					var pa models.Application
					if pcur.Decode(&pa) == nil {
						pend = append(pend, pa)
					}
				}
				_ = pcur.Close(r.Context())
				if len(pend) > 0 {
					ids := make([]primitive.ObjectID, 0, len(pend))
					for _, pa := range pend {
						ids = append(ids, pa.ElonID)
					}
					sameDay := map[primitive.ObjectID]bool{}
					ecur, eerr := h.Elons.Find(r.Context(), bson.M{"_id": bson.M{"$in": ids}, "startDate": elon.StartDate})
					if eerr == nil {
						for ecur.Next(r.Context()) {
							var se models.Elon
							if ecur.Decode(&se) == nil {
								sameDay[se.ID] = true
							}
						}
						_ = ecur.Close(r.Context())
					}
					cancelledAny := false
					for _, pa := range pend {
						if !sameDay[pa.ElonID] {
							continue
						}
						_, _ = h.Apps.UpdateOne(r.Context(), bson.M{"_id": pa.ID, "status": "pending"}, bson.M{"$set": bson.M{
							"status": "cancelled", "cancelledBy": "worker",
							"cancelReason": "Shu kunga boshqa ishga qabul qilindi (avtomatik bekor qilindi)",
							"decidedAt":    now,
						}})
						cancelledAny = true
						h.Notify.Push(r.Context(), pa.EmployerID, "application_cancelled", "Ariza bekor qilindi", pa.ElonTitle+" — ishchi shu kunga boshqa ishga qabul qilindi", &models.RelatedEntity{Type: "application", ID: pa.ID})
					}
					if cancelledAny {
						h.Notify.Push(r.Context(), app.WorkerID, "application_cancelled", "Arizalaringiz bekor qilindi", "Shu kunga boshqa kutilayotgan arizalaringiz avtomatik bekor qilindi", nil)
					}
				}
			}
		}
	} else {
		h.Notify.Push(r.Context(), app.WorkerID, "application_rejected", "Arizangiz rad etildi", app.ElonTitle, &models.RelatedEntity{Type: "application", ID: appID})
	}
	httpx.JSON(w, 200, map[string]string{"status": decision})
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	appID, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	// Bekor qilish sababi majburiy — sababsiz bekor qilib bo'lmaydi.
	var req cancelReq
	_ = httpx.Decode(r, &req)
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		httpx.Err(w, httpx.NewError(400, "reason_required", "bekor qilish sababini yozing"))
		return
	}
	var app models.Application
	if err := h.Apps.FindOne(r.Context(), bson.M{"_id": appID}).Decode(&app); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "application not found"))
		return
	}
	who := actorRole(app, uid)
	if who == "" {
		httpx.Err(w, httpx.NewError(403, "forbidden", "not your application"))
		return
	}
	if !canCancel(app.Status) {
		httpx.Err(w, httpx.NewError(400, "bad_state", "cannot cancel from this state"))
		return
	}
	wasAccepted := app.Status == "accepted"
	_, err = h.Apps.UpdateOne(r.Context(), bson.M{"_id": appID}, bson.M{"$set": bson.M{"status": "cancelled", "cancelledBy": who, "cancelReason": reason, "decidedAt": time.Now()}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if wasAccepted {
		// roll back acceptedCount (guruh arizasidagi kishilar soniga) + status if needed
		people := peopleOf(app)
		var elon models.Elon
		_ = h.Elons.FindOneAndUpdate(r.Context(),
			bson.M{"_id": app.ElonID},
			bson.M{"$inc": bson.M{"acceptedCount": -people}, "$set": bson.M{"updatedAt": time.Now()}},
			options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&elon)
		if elon.Status == "filled" && elon.AcceptedCount < elon.WorkersNeeded {
			_, _ = h.Elons.UpdateOne(r.Context(), bson.M{"_id": elon.ID}, bson.M{"$set": bson.M{"status": "recruiting"}})
		}
	}
	// notify the other party
	other := otherParty(app, uid)
	h.Notify.Push(r.Context(), other, "application_cancelled", "Ariza bekor qilindi", app.ElonTitle+" — sabab: "+reason, &models.RelatedEntity{Type: "application", ID: appID})
	httpx.JSON(w, 200, map[string]string{"status": "cancelled"})
}

// ConfirmDone: dual-confirm completion.
func (h *Handler) ConfirmDone(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	appID, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var app models.Application
	if err := h.Apps.FindOne(r.Context(), bson.M{"_id": appID}).Decode(&app); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "application not found"))
		return
	}
	if app.Status != "accepted" {
		httpx.Err(w, httpx.NewError(400, "bad_state", "only accepted applications can be confirmed"))
		return
	}
	var setField string
	switch actorRole(app, uid) {
	case "worker":
		setField = "workerConfirmedDone"
	case "employer":
		setField = "employerConfirmedDone"
	default:
		httpx.Err(w, httpx.NewError(403, "forbidden", "not your application"))
		return
	}
	_, err = h.Apps.UpdateOne(r.Context(), bson.M{"_id": appID}, bson.M{"$set": bson.M{setField: true}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	// refetch and decide
	if err := h.Apps.FindOne(r.Context(), bson.M{"_id": appID}).Decode(&app); err != nil {
		httpx.Err(w, err)
		return
	}
	if bothConfirmed(app) {
		now := time.Now()
		// Shartli yangilash: faqat hali "accepted" bo'lsa yakunlaymiz. Avtomatik
		// yakunlash scheduleri ayni paytda shu arizani yopib qo'ygan bo'lsa,
		// ModifiedCount 0 bo'ladi va sanoqni ikki marta oshirmaymiz.
		res, uerr := h.Apps.UpdateOne(r.Context(), bson.M{"_id": appID, "status": "accepted"}, bson.M{"$set": bson.M{"status": "completed", "completedAt": now}})
		if uerr == nil && res.ModifiedCount == 1 {
			// bump completedJobsCount on both users
			_, _ = h.Users.UpdateOne(r.Context(), bson.M{"_id": app.WorkerID}, bson.M{"$inc": bson.M{"completedJobsCount": 1}})
			_, _ = h.Users.UpdateOne(r.Context(), bson.M{"_id": app.EmployerID}, bson.M{"$inc": bson.M{"completedJobsCount": 1}})
			// notify both
			h.Notify.Push(r.Context(), app.WorkerID, "job_completed", "Ish yakunlandi", app.ElonTitle, &models.RelatedEntity{Type: "application", ID: appID})
			h.Notify.Push(r.Context(), app.EmployerID, "job_completed", "Ish yakunlandi", app.ElonTitle, &models.RelatedEntity{Type: "application", ID: appID})
		}
		httpx.JSON(w, 200, map[string]string{"status": "completed"})
		return
	}
	// notify the other side to confirm
	other := otherParty(app, uid)
	h.Notify.Push(r.Context(), other, "job_completed_request", "Tasdiqlash so'rovi", "Ish yakunlanganini tasdiqlang: "+app.ElonTitle, &models.RelatedEntity{Type: "application", ID: appID})
	httpx.JSON(w, 200, map[string]string{"status": "awaiting_other"})
}

// pageOpts — ixtiyoriy limit/page query paramlaridan Find opsiyalari. Javob
// shakli o'zgarmasligi uchun (klientlar oddiy massiv kutadi) paginatsiya
// metadata qaytarilmaydi: param bermagan eski klientlar defaultLimit tagacha
// yozuvni avvalgidek oladi — ilgari bu ro'yxatlar umuman cheksiz edi.
func pageOpts(r *http.Request, defaultLimit, maxLimit int) *options.FindOptions {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > maxLimit {
		limit = defaultLimit
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	return options.Find().
		SetSort(bson.D{{Key: "appliedAt", Value: -1}}).
		SetSkip(int64((page - 1) * limit)).
		SetLimit(int64(limit))
}

// MyApplications: applications I made as worker.
func (h *Handler) MyApplications(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	cur, err := h.Apps.Find(r.Context(), bson.M{"workerId": uid}, pageOpts(r, 100, 200))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Application{}
	for cur.Next(r.Context()) {
		var a models.Application
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	h.liveAppAvatars(r.Context(), out)
	httpx.JSON(w, 200, out)
}

// MyElonsApplications: applications received on my elons (grouped by elon).
func (h *Handler) MyElonsApplications(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	// Ish beruvchi Google Play demo hisobidan kelgan arizani ko'rmaydi. Demo
	// hisob esa (o'zi ish beruvchi bo'lganda) ularni ko'radi, shuning uchun
	// reviewer nomzodlar ro'yxati oqimini ham sinay oladi.
	filter := bson.M{"employerId": uid}
	if !httpx.IsReviewActor(r.Context()) {
		filter["isReviewData"] = bson.M{"$ne": true}
	}
	cur, err := h.Apps.Find(r.Context(), filter, pageOpts(r, 200, 500))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	grouped := map[string][]models.Application{}
	for cur.Next(r.Context()) {
		var a models.Application
		if err := cur.Decode(&a); err == nil {
			grouped[a.ElonID.Hex()] = append(grouped[a.ElonID.Hex()], a)
		}
	}
	groupsList := make([][]models.Application, 0, len(grouped))
	for _, apps := range grouped {
		groupsList = append(groupsList, apps)
	}
	h.liveAppAvatars(r.Context(), groupsList...)
	httpx.JSON(w, 200, grouped)
}

// History: completed/cancelled/rejected for the user (worker or employer).
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	filter := bson.M{
		"$or":    []bson.M{{"workerId": uid}, {"employerId": uid}},
		"status": bson.M{"$in": []string{"completed", "cancelled", "rejected"}},
	}
	cur, err := h.Apps.Find(r.Context(), filter, pageOpts(r, 100, 200))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Application{}
	for cur.Next(r.Context()) {
		var a models.Application
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	h.liveAppAvatars(r.Context(), out)
	httpx.JSON(w, 200, out)
}

func loadUser(ctx context.Context, col *mongo.Collection, id primitive.ObjectID) (*models.User, error) {
	var u models.User
	if err := col.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
		return nil, errors.New("not_found")
	}
	return &u, nil
}

// liveAppAvatars — arizalardagi ishchi va ish beruvchi avatarini joriy (eng
// oxirgi) qiymatga yangilaydi. Saqlangan snapshot emas, jonli: profil rasmi
// keyin qo'yilsa/o'zgartirilsa ham process va tarix ro'yxatlarida darhol yangisi
// ko'rinadi. Bir nechta ro'yxat berilsa ham bitta so'rov bilan ishlaydi.
func (h *Handler) liveAppAvatars(ctx context.Context, groups ...[]models.Application) {
	ids := []primitive.ObjectID{}
	for _, apps := range groups {
		for _, a := range apps {
			ids = append(ids, a.WorkerID, a.EmployerID)
		}
	}
	m := userlookup.Avatars(ctx, h.Users, ids)
	for _, apps := range groups {
		for i := range apps {
			if v, ok := m[apps[i].WorkerID]; ok {
				apps[i].WorkerAvatarURL = v
			}
			if v, ok := m[apps[i].EmployerID]; ok {
				apps[i].OwnerAvatarURL = v
			}
		}
	}
}
