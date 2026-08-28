package admin

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
)

// req — berilgan rol va `mode` qiymati bilan admin so'rovini yasaydi.
// Qiymat url.Values orqali kodlanadi: bo'sh joyli qiymat ham haqiqiy
// klient yuboradigan ko'rinishda yetib boradi.
func req(role, mode string) *http.Request {
	q := url.Values{}
	if mode != "" {
		q.Set("mode", mode)
	}
	r := httptest.NewRequest(http.MethodDelete, "/api/admin/users/x?"+q.Encode(), nil)
	return r.WithContext(httpx.WithAdminRole(r.Context(), role))
}

// Parametrsiz kelgan so'rov HECH QACHON bazadan o'chirmasligi kerak.
// Bu eng muhim tekshiruv: eski klient, yangilanmagan ilova yoki qo'lda
// yozilgan so'rov — hammasi xavfsiz tomonga tushishi shart.
func TestDeleteModeDefaultsToHidden(t *testing.T) {
	for _, role := range []string{"superadmin", "moderator", "support"} {
		got, err := deleteMode(req(role, ""))
		if err != nil {
			t.Fatalf("%s: kutilmagan xato: %v", role, err)
		}
		if got != deleteModeHidden {
			t.Errorf("%s: standart rejim = %q, kutilgan %q", role, got, deleteModeHidden)
		}
	}
}

// Bazadan o'chirish — faqat superadmin. Moderator ham shu handlerga yetib
// keladi (route moderator guruhida), shuning uchun tekshiruv shart.
func TestDeleteModePurgeIsSuperadminOnly(t *testing.T) {
	got, err := deleteMode(req("superadmin", "purge"))
	if err != nil {
		t.Fatalf("superadmin uchun xato: %v", err)
	}
	if got != deleteModePurge {
		t.Errorf("superadmin: rejim = %q, kutilgan %q", got, deleteModePurge)
	}

	for _, role := range []string{"moderator", "support", "", "SUPERADMIN "} {
		if _, err := deleteMode(req(role, "purge")); err == nil {
			t.Errorf("%q roli bazadan o'chira olmasligi kerak", role)
		} else if he, ok := err.(*httpx.HTTPError); !ok || he.Status != http.StatusForbidden {
			t.Errorf("%q: kutilgan 403, olingan %v", role, err)
		}
	}
}

// Noma'lum rejim jimgina yashirishga aylanib qolmasligi kerak — chalkash
// so'rov aniq xato bilan rad etilsin.
func TestDeleteModeRejectsUnknown(t *testing.T) {
	for _, m := range []string{"delete", "hard", "1", "purge-all", "hidden purge"} {
		if _, err := deleteMode(req("superadmin", m)); err == nil {
			t.Errorf("mode=%q qabul qilindi, rad etilishi kerak edi", m)
		}
	}
}

// Buzuq so'rov satri (masalan `mode=hidden;purge` — Go uni butunlay tashlab
// yuboradi) rejimni YO'QOTADI. Shunda ham xavfsiz tomonga tushishi kerak:
// hech qanday holatda o'z-o'zidan bazadan o'chirishga aylanmasin.
func TestDeleteModeMalformedQueryFailsSafe(t *testing.T) {
	r := httptest.NewRequest(http.MethodDelete, "/api/admin/users/x?mode=hidden;purge", nil)
	r = r.WithContext(httpx.WithAdminRole(r.Context(), "superadmin"))
	got, err := deleteMode(r)
	if err != nil {
		t.Fatalf("kutilmagan xato: %v", err)
	}
	if got != deleteModeHidden {
		t.Errorf("buzuq so'rovda rejim = %q, kutilgan %q", got, deleteModeHidden)
	}
}

// Katta-kichik harf va bo'sh joy farq qilmasin — panel yuborgan qiymat
// shakli o'zgarsa ham xatti-harakat o'zgarmasligi kerak.
func TestDeleteModeIsCaseInsensitive(t *testing.T) {
	for _, m := range []string{"PURGE", " purge", "Purge "} {
		got, err := deleteMode(req("superadmin", m))
		if err != nil || got != deleteModePurge {
			t.Errorf("mode=%q -> (%q, %v)", m, got, err)
		}
	}
	for _, m := range []string{"HIDDEN", " hidden "} {
		got, err := deleteMode(req("superadmin", m))
		if err != nil || got != deleteModeHidden {
			t.Errorf("mode=%q -> (%q, %v)", m, got, err)
		}
	}
}

// Standart holatda o'chirilganlar ham ko'rinadi — aynan shu tuzatilgan
// xatti-harakat. Ilgari filtr ularni doim chiqarib tashlardi va yashirilgan
// yozuv admin panelidan ham g'oyib bo'lardi.
func TestApplyDeletedFilterShowsEverythingByDefault(t *testing.T) {
	f := bson.M{}
	applyDeletedFilter(f, "")
	if _, set := f["isDeleted"]; set {
		t.Errorf("standart holatda isDeleted sharti qo'yilmasligi kerak: %v", f)
	}
}

func TestApplyDeletedFilterModes(t *testing.T) {
	only := bson.M{}
	applyDeletedFilter(only, "only")
	if only["isDeleted"] != true {
		t.Errorf("deleted=only -> %v, kutilgan true", only["isDeleted"])
	}

	hide := bson.M{}
	applyDeletedFilter(hide, "hide")
	ne, ok := hide["isDeleted"].(bson.M)
	if !ok || ne["$ne"] != true {
		t.Errorf("deleted=hide -> %v, kutilgan {$ne: true}", hide["isDeleted"])
	}

	// Noma'lum qiymat filtrni buzmasin — hammasi ko'rsatilaveradi.
	unknown := bson.M{}
	applyDeletedFilter(unknown, "hammasi")
	if _, set := unknown["isDeleted"]; set {
		t.Errorf("noma'lum qiymat shart qo'ymasligi kerak: %v", unknown)
	}
}

// Filtr mavjud shartlarni o'chirib yubormasligi kerak.
func TestApplyDeletedFilterKeepsOtherConditions(t *testing.T) {
	f := bson.M{"region": "Toshkent"}
	applyDeletedFilter(f, "only")
	if f["region"] != "Toshkent" {
		t.Errorf("mavjud shart yo'qoldi: %v", f)
	}
}
