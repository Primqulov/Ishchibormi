package admin

import (
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Arizaning batafsil sahifasi (Figma 3.6.1) jurnalni va «shu ishchining
// arizalari» jadvalini SERVER yig'gan holda oladi — mijoz ularni qayta
// hisoblamaydi. Shuning uchun quyidagi qoidalar shu yerda qotirilgan:
// jurnal moderatorga ko'rinmaydi, hodisa ostida har doim aniq vaqt belgisi
// turadi va joriy ariza jadvaldan hech qachon tushib qolmaydi.
//
// Kolleksiyalar `nil`: bu funksiyalar audit va Mongo qismini o'tkazib
// yuborishi kerak (`h.AuditCol == nil`, `h.Apps == nil`), ya'ni mantiq
// bazasiz ham sinaladi.

// arizaNamunasi — to'ldirilgan ariza; har test kerakli maydonini o'zgartiradi.
func arizaNamunasi() models.Application {
	return models.Application{
		ID:               primitive.NewObjectID(),
		ElonID:           primitive.NewObjectID(),
		WorkerID:         primitive.NewObjectID(),
		ElonTitle:        "Ombor yuk tashish",
		ElonCategoryName: "Yuk tashish",
		WorkerName:       "Sardor Qodirov",
		OwnerName:        "Bunyod Karimov",
		Amount:           350000,
		Status:           "pending",
		AppliedAt:        time.Date(2026, 8, 22, 9, 14, 0, 0, time.UTC),
	}
}

// Jurnal — FAQAT superadminga. Figma 3.6.1 · 8: «Moderator uchun bu
// kartochka ko'rinmaydi». Bo'sh massiv qaytadi, `nil` emas: JSON'da `[]`
// bo'lib chiqishi kerak, aks holda panel `null` ni tekshirishga majbur
// bo'lardi.
func TestAppJournalHiddenFromModerator(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()

	got := h.appJournal(context.Background(), a, false)
	if got == nil {
		t.Fatal("nil qaytdi, bo'sh ro'yxat kutilgan")
	}
	if len(got) != 0 {
		t.Errorf("moderatorga %d yozuv ko'rindi: %+v", len(got), got)
	}
}

// «Kutilmoqda» arizada BITTA hodisa bor: uni ishchi yuborgan. Javob
// berilmagani uchun ikkinchi qator yozib qo'yilmasligi kerak — panel uni
// "ish beruvchi javob berdi" deb ko'rsatardi.
func TestAppJournalPendingHasOnlyCreated(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()

	got := h.appJournal(context.Background(), a, true)
	if len(got) != 1 {
		t.Fatalf("%d yozuv qaytdi, 1 kutilgan: %+v", len(got), got)
	}
	y := got[0]
	if y.Kind != appJournalCreated || y.Source != appSourceApp {
		t.Errorf("yozuv turi/manbasi noto'g'ri: kind=%q source=%q", y.Kind, y.Source)
	}
	if y.Actor != "Sardor Qodirov" || y.ActorRole != "ishchi" {
		t.Errorf("amalni bajargan noto'g'ri: %q / %q", y.Actor, y.ActorRole)
	}
	if !y.At.Equal(a.AppliedAt) {
		t.Errorf("vaqt %v, kutilgan %v", y.At, a.AppliedAt)
	}
}

// Bekor qilingan ariza: kim bekor qilgani `cancelledBy` dan olinadi va
// sabab yozuv ostida qoladi. Yozuvlar ESKISIDAN boshlab keladi — jadval
// shu tartibda chiziladi.
func TestAppJournalCancelledUsesCancelledBy(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()
	qaror := a.AppliedAt.Add(30 * time.Hour)
	a.Status = "cancelled"
	a.CancelledBy = "worker"
	a.CancelReason = "Boshqa ish topdim"
	a.DecidedAt = &qaror

	got := h.appJournal(context.Background(), a, true)
	if len(got) != 2 {
		t.Fatalf("%d yozuv qaytdi, 2 kutilgan: %+v", len(got), got)
	}
	if got[0].Kind != appJournalCreated {
		t.Errorf("birinchi yozuv %q, %q kutilgan (eskisidan boshlab)", got[0].Kind, appJournalCreated)
	}
	y := got[1]
	if y.Kind != appJournalCancelled {
		t.Fatalf("ikkinchi yozuv turi %q, %q kutilgan", y.Kind, appJournalCancelled)
	}
	if y.Actor != "Sardor Qodirov" || y.ActorRole != "ishchi" {
		t.Errorf("bekor qilgan %q / %q, ishchi kutilgan", y.Actor, y.ActorRole)
	}
	if y.Detail != "Boshqa ish topdim" {
		t.Errorf("sabab yo'qoldi: %q", y.Detail)
	}
}

// `cancelledBy` bo'sh (eski yozuv) — kim bekor qilgani TAXMIN QILINMAYDI.
// Ishchini yozib qo'ysak, panel dalil o'rniga faraz ko'rsatardi.
func TestAppJournalCancelledWithoutActorStaysEmpty(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()
	qaror := a.AppliedAt.Add(2 * time.Hour)
	a.Status = "cancelled"
	a.DecidedAt = &qaror

	got := h.appJournal(context.Background(), a, true)
	if len(got) != 2 {
		t.Fatalf("%d yozuv qaytdi, 2 kutilgan: %+v", len(got), got)
	}
	if got[1].Actor != "" || got[1].ActorRole != "" {
		t.Errorf("bo'sh `cancelledBy` da amal egasi to'ldirildi: %q / %q",
			got[1].Actor, got[1].ActorRole)
	}
}

// Avtomatik yakunlangan ish — odam emas, jadval bajargan. Manba
// «avtomatik» bo'lishi va amal egasi BO'SH qolishi kerak: aks holda
// jurnal ish beruvchi tasdiqlagandek ko'rinardi.
func TestAppJournalAutoCompletedHasNoActor(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()
	qaror := a.AppliedAt.Add(3 * time.Hour)
	yakun := a.AppliedAt.Add(72 * time.Hour)
	a.Status = "completed"
	a.DecidedAt = &qaror
	a.CompletedAt = &yakun
	a.AutoCompleted = true

	got := h.appJournal(context.Background(), a, true)
	if len(got) != 3 {
		t.Fatalf("%d yozuv qaytdi, 3 kutilgan: %+v", len(got), got)
	}
	// Bajarilgan ariza avval QABUL QILINGAN: `decidedAt` shu paytni
	// saqlaydi va u jurnalda alohida qator bo'lishi kerak. Busiz jurnal
	// "yaratildi → bajarildi" bo'lib, qabul qilish hodisasi yozuvda
	// turgani holda ekrandan tushib qolardi.
	if got[1].Kind != appJournalAccepted || !got[1].At.Equal(qaror) {
		t.Errorf("qabul qilish yozuvi yo'q yoki vaqti noto'g'ri: %+v", got[1])
	}
	y := got[2]
	if y.Kind != appJournalCompleted {
		t.Fatalf("oxirgi yozuv turi %q, %q kutilgan", y.Kind, appJournalCompleted)
	}
	if y.Source != appSourceSystem {
		t.Errorf("manba %q, %q kutilgan", y.Source, appSourceSystem)
	}
	if y.Actor != "" || y.ActorRole != "" {
		t.Errorf("avtomatik yakunda amal egasi yozildi: %q / %q", y.Actor, y.ActorRole)
	}
	// Vaqt bo'yicha o'sish tartibi buzilmasligi kerak.
	for i := 1; i < len(got); i++ {
		if got[i].At.Before(got[i-1].At) {
			t.Errorf("tartib buzildi: %v dan keyin %v", got[i-1].At, got[i].At)
		}
	}
}

// Ish beruvchi o'zi yakunlaganda manba «ilova» bo'lib qoladi — avtomatik
// yakun bilan aynan shu maydon farq qiladi.
func TestAppJournalManualCompleteKeepsEmployer(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()
	yakun := a.AppliedAt.Add(50 * time.Hour)
	a.Status = "completed"
	a.CompletedAt = &yakun

	got := h.appJournal(context.Background(), a, true)
	y := got[len(got)-1]
	if y.Source != appSourceApp || y.Actor != "Bunyod Karimov" {
		t.Errorf("qo'lda yakunlash: source=%q actor=%q, %q / ish beruvchi kutilgan",
			y.Source, y.Actor, appSourceApp)
	}
}

// Joriy ariza jadvaldan HECH QACHON tushib qolmaydi: u «Hozirgi sahifa»
// chipi bilan turadigan qator (Figma 3.6.1 · 7). Baza ulanmagan bo'lsa ham
// kamida shu bitta qator qaytadi.
func TestWorkerApplicationsAlwaysIncludesCurrent(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()

	got := h.workerApplications(context.Background(), a)
	if len(got) != 1 {
		t.Fatalf("%d qator qaytdi, 1 kutilgan: %+v", len(got), got)
	}
	r := got[0]
	if r.ID != a.ID {
		t.Errorf("qator ID %v, joriy ariza %v kutilgan", r.ID, a.ID)
	}
	if r.ElonTitle != a.ElonTitle || r.CategoryName != a.ElonCategoryName {
		t.Errorf("qator arizadan to'ldirilmadi: %+v", r)
	}
	if r.Amount != a.Amount || r.Status != a.Status || !r.AppliedAt.Equal(a.AppliedAt) {
		t.Errorf("qator qiymatlari mos emas: %+v", r)
	}
}

// Ishchi ID si bo'sh (buzuq yozuv) — Mongo'ga `workerId: ObjectId("000…")`
// so'rovi ketmasligi kerak. Joriy qator baribir qaytadi.
func TestWorkerApplicationsSkipsQueryWithoutWorker(t *testing.T) {
	h := &Handler{}
	a := arizaNamunasi()
	a.WorkerID = primitive.NilObjectID

	got := h.workerApplications(context.Background(), a)
	if len(got) != 1 || got[0].ID != a.ID {
		t.Errorf("%d qator qaytdi: %+v", len(got), got)
	}
}

// Eksport yozuvi (`export_applications`) jurnalga TUSHMAYDI: uning nishoni
// bitta ariza emas, filtr kesimi — arizaga bog'lash yolg'on bo'lardi.
// Ro'yxat o'sib ketsa, shu qoida jimgina buzilishi mumkin edi.
func TestAppJournalAuditActionsExcludeExport(t *testing.T) {
	if _, bor := appJournalAuditActions["export_applications"]; bor {
		t.Error("eksport amali jurnal ro'yxatiga qo'shilgan")
	}
	if len(appJournalAuditActions) == 0 {
		t.Error("jurnal uchun birorta admin amali qolmagan")
	}
}
