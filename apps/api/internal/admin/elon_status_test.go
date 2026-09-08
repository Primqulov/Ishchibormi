package admin

import (
	"testing"

	"github.com/ishchibormi/backend/internal/models"
)

// Yashirishda oldingi holat ESLAB QOLINADI va tiklashda aynan u qaytadi.
// Bu «Yashirish ↔ Tiklash» amalini haqiqatan qaytariladigan qiladi
// (Figma 3.5a · 3).
func TestElonStatusUpdateRestoresRememberedStatus(t *testing.T) {
	for _, oldingi := range []string{"recruiting", "filled", "in_progress", "completed", "cancelled", "draft"} {
		// 1-qadam: yashirish.
		holat, izoh := elonStatusUpdate(models.Elon{Status: oldingi}, "hidden")
		if holat != "hidden" {
			t.Errorf("%q -> yashirish natijasi %q", oldingi, holat)
		}
		if izoh == "" {
			t.Errorf("%q uchun audit izohi bo'sh", oldingi)
		}

		// 2-qadam: tiklash — panel "recruiting" so'raydi, server esa
		// eslab qolingan holatga qaytarishi kerak.
		yashirilgan := models.Elon{Status: "hidden", HiddenFromStatus: oldingi}
		holat, _ = elonStatusUpdate(yashirilgan, "recruiting")
		if holat != oldingi {
			t.Errorf("tiklash %q -> %q, kutilgan %q", oldingi, holat, oldingi)
		}
	}
}

// Eslatma yo'q (bu maydon paydo bo'lishidan oldin yashirilgan e'lon) yoki
// tanish bo'lmagan qiymat — eski xulqqa qaytamiz. E'lon bazadagi tasodifiy
// satr sababli tushunarsiz holatga o'tib ketmasligi kerak.
func TestElonStatusUpdateFallsBackToRecruiting(t *testing.T) {
	for nom, prev := range map[string]models.Elon{
		"eslatma yo'q":     {Status: "hidden"},
		"bo'sh satr":       {Status: "hidden", HiddenFromStatus: ""},
		"tanish emas":      {Status: "hidden", HiddenFromStatus: "arxiv"},
		"o'zi ham hidden":  {Status: "hidden", HiddenFromStatus: "hidden"},
		"katta harf bilan": {Status: "hidden", HiddenFromStatus: "RECRUITING"},
	} {
		if holat, _ := elonStatusUpdate(prev, "recruiting"); holat != "recruiting" {
			t.Errorf("%s: tiklash -> %q, kutilgan \"recruiting\"", nom, holat)
		}
	}
}

// Takroriy yashirishda eslatma "hidden" ga aylanib ketmasligi kerak — aks
// holda e'lonni umuman tiklab bo'lmasdi.
func TestElonStatusUpdateRepeatedHideKeepsMemory(t *testing.T) {
	prev := models.Elon{Status: "hidden", HiddenFromStatus: "in_progress"}
	holat, izoh := elonStatusUpdate(prev, "hidden")
	if holat != "hidden" {
		t.Fatalf("holat = %q", holat)
	}
	if izoh != "hidden — allaqachon yashirilgan edi" {
		t.Errorf("izoh = %q — takroriy yashirish ajratilmagan", izoh)
	}
	// Eslatma o'zgarmagani uchun keyingi tiklash asl holatni qaytaradi.
	if h, _ := elonStatusUpdate(prev, "recruiting"); h != "in_progress" {
		t.Errorf("takroriy yashirishdan keyin tiklash -> %q", h)
	}
}

// Yashirilmagan e'longa "recruiting" so'ralsa — bu tiklash EMAS, oddiy
// holat almashtirish. Tiklash mantig'i faqat "hidden" dan chiqishda ishlaydi.
func TestElonStatusUpdatePassesThroughWhenNotHidden(t *testing.T) {
	cases := []struct{ prev, want string }{
		{"filled", "recruiting"},
		{"recruiting", "filled"},
		{"in_progress", "cancelled"},
		{"completed", "cancelled"},
	}
	for _, c := range cases {
		// Eslatma bor bo'lsa ham e'tiborga olinmaydi: e'lon hozir
		// yashirilgan emas.
		prev := models.Elon{Status: c.prev, HiddenFromStatus: "draft"}
		if holat, _ := elonStatusUpdate(prev, c.want); holat != c.want {
			t.Errorf("%q -> %q berildi, %q kutilgan", c.prev, holat, c.want)
		}
	}
}

// Detail moderation permits five reasoned statuses plus the separate hide
// action. Draft and arbitrary inputs remain unavailable.
func TestElonStatusSettableWhitelist(t *testing.T) {
	for _, s := range []string{"hidden", "recruiting", "filled", "in_progress", "completed", "cancelled"} {
		if !elonStatusSettable[s] {
			t.Errorf("%q qo'yilishi kerak edi", s)
		}
	}
	for _, s := range []string{"draft", "", "HIDDEN", "deleted", "$set"} {
		if elonStatusSettable[s] {
			t.Errorf("%q panel orqali qo'yilmasligi kerak", s)
		}
	}
	// Tiklash oq ro'yxati ham yopiq bo'lishi shart.
	for _, s := range []string{"", "arxiv", "HIDDEN", "recruiting "} {
		if elonStatusKnown[s] {
			t.Errorf("%q tanish holat deb hisoblandi", s)
		}
	}
}
