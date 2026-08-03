package application

import (
	"context"
	"time"

	"github.com/ishchibormi/backend/internal/elon"
	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// autoCompleteAfter — qabul qilingan ish belgilangan boshlanish vaqtidan shuncha
// o'tgach, ikki tomon ham bekor qilmagan bo'lsa, avtomatik yakunlangan deb
// hisoblanadi va ish tarixiga (arxivga) tushadi.
const autoCompleteAfter = 18 * time.Hour

// autoCompleteTick — scheduler tekshiruvi qanchalik tez-tez ishlashi. 18 soatlik
// muddat uchun daqiqa aniqligi shart emas.
const autoCompleteTick = 10 * time.Minute

// RunAutoCompleteScheduler — qabul qilingan (accepted) arizalarni davriy
// tekshiradi va belgilangan boshlanish vaqtidan autoCompleteAfter o'tgan, hali
// bekor qilinmagan/yakunlanmaganlarini avtomatik "completed" holatiga o'tkazadi.
// main'da bitta fon goroutine sifatida ishga tushiriladi; ctx bekor qilinganda
// (server o'chganda) to'xtaydi.
func (h *Handler) RunAutoCompleteScheduler(ctx context.Context) {
	ticker := time.NewTicker(autoCompleteTick)
	defer ticker.Stop()
	h.autoCompleteDue(ctx) // ishga tushganda darhol bir marta
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.autoCompleteDue(ctx)
		}
	}
}

// autoCompleteDue — hozircha muddati yetgan barcha qabul qilingan arizalarni
// yakunlaydi. Faqat status "accepted" bo'lganlar tanlanadi — bu ikki tomondan
// birortasi ham bekor qilmaganini kafolatlaydi (bekor qilish statusni
// "cancelled" ga o'zgartiradi).
func (h *Handler) autoCompleteDue(ctx context.Context) {
	now := time.Now()

	cur, err := h.Apps.Find(ctx, bson.M{"status": "accepted"})
	if err != nil {
		return
	}
	var accepted []models.Application
	for cur.Next(ctx) {
		var a models.Application
		if cur.Decode(&a) == nil {
			accepted = append(accepted, a)
		}
	}
	_ = cur.Close(ctx)
	if len(accepted) == 0 {
		return
	}

	// Kerakli e'lonlarni bitta so'rov bilan yuklab, xaritaga joylaymiz. Soft
	// o'chirilgan e'lonlar ham qoladi — ish bajarilgan, e'lon ko'rinmasligi
	// arxivga ta'sir qilmaydi.
	ids := make([]primitive.ObjectID, 0, len(accepted))
	seen := map[primitive.ObjectID]bool{}
	for _, a := range accepted {
		if !seen[a.ElonID] {
			seen[a.ElonID] = true
			ids = append(ids, a.ElonID)
		}
	}
	elons := map[primitive.ObjectID]models.Elon{}
	if ecur, eerr := h.Elons.Find(ctx, bson.M{"_id": bson.M{"$in": ids}}); eerr == nil {
		for ecur.Next(ctx) {
			var e models.Elon
			if ecur.Decode(&e) == nil {
				elons[e.ID] = e
			}
		}
		_ = ecur.Close(ctx)
	}

	for _, a := range accepted {
		e, ok := elons[a.ElonID]
		if !ok {
			continue // e'lon topilmadi (butunlay o'chirilgan) — o'tkazib yuboramiz
		}
		if !autoCompleteReady(e, now) {
			continue
		}
		h.completeAuto(ctx, a, now)
	}
}

// autoCompleteReady — e'lonning belgilangan boshlanish vaqtidan autoCompleteAfter
// o'tgan bo'lsa true. Belgilangan vaqt yo'q (bo'sh/noto'g'ri startDate) bo'lsa
// hech qachon avtomatik yakunlanmaydi. Sof funksiya — testlanadi.
func autoCompleteReady(e models.Elon, now time.Time) bool {
	start, ok := elon.ScheduledStart(e)
	if !ok {
		return false
	}
	return now.Sub(start) >= autoCompleteAfter
}

// completeAuto — bitta arizani atomik ravishda yakunlaydi. Status shartli
// yangilanadi ("accepted" bo'lsa) — shu tik yoki qo'lda confirm-done bilan
// poyga bo'lsa, faqat bittasi g'olib chiqadi va sanoq ikki marta oshmaydi.
func (h *Handler) completeAuto(ctx context.Context, a models.Application, now time.Time) {
	res, err := h.Apps.UpdateOne(ctx,
		bson.M{"_id": a.ID, "status": "accepted"},
		bson.M{"$set": bson.M{"status": "completed", "completedAt": now, "autoCompleted": true}},
	)
	if err != nil || res.ModifiedCount == 0 {
		return // poygada yutqazdik yoki xato — sanoqni oshirmaymiz
	}
	// Ikki tomonning ham bajarilgan ishlar sanog'ini oshiramiz (qo'lda
	// yakunlash bilan bir xil).
	_, _ = h.Users.UpdateOne(ctx, bson.M{"_id": a.WorkerID}, bson.M{"$inc": bson.M{"completedJobsCount": 1}})
	_, _ = h.Users.UpdateOne(ctx, bson.M{"_id": a.EmployerID}, bson.M{"$inc": bson.M{"completedJobsCount": 1}})
	h.Notify.Push(ctx, a.WorkerID, "job_completed", "Ish yakunlandi", a.ElonTitle+" — avtomatik yakunlandi va ish tarixiga o'tkazildi", &models.RelatedEntity{Type: "application", ID: a.ID})
	h.Notify.Push(ctx, a.EmployerID, "job_completed", "Ish yakunlandi", a.ElonTitle+" — avtomatik yakunlandi va ish tarixiga o'tkazildi", &models.RelatedEntity{Type: "application", ID: a.ID})
}
