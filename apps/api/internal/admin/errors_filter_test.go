package admin

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ishchibormi/backend/internal/errlog"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func filterFor(t *testing.T, query string) bson.M {
	t.Helper()
	f, err := errFilter(httptest.NewRequest("GET", "/admin/errors?"+query, nil))
	if err != nil {
		t.Fatalf("errFilter(%q) xato qaytardi: %v", query, err)
	}
	return f
}

// Sukut bo'yicha ko'rinish — "Ochiq", Figma 3.12.2 · D va 3.12.3 · J.
// Bu shunchaki qulaylik emas: hal qilingan va e'tiborsiz qoldirilgan
// xatoliklar sukut bo'yicha ko'rinsa, ro'yxat tezda eski yozuvlar bilan
// to'lib, yangi nosozlik ko'zga tashlanmay qolardi.
//
// Teskari tomoni ham muhim: "Bartaraf etilmoqda" va "Qayta paydo bo'ldi"
// SHU ro'yxatda bo'lishi shart. Ish boshlangan yoki qaytgan xatolik ochiq
// ko'rinishdan tushib qolsa, uni hech kim kuzatmay qo'yardi.
func TestErrFilterDefaultsToOpen(t *testing.T) {
	f := filterFor(t, "")
	got, ok := f["status"].(bson.M)
	if !ok {
		t.Fatalf("status filtri yo'q: %#v", f["status"])
	}
	in, ok := got["$in"].([]string)
	if !ok {
		t.Fatalf("$in tipi kutilmagan: %#v", got["$in"])
	}
	want := map[string]bool{}
	for _, s := range errlog.OpenStatuses {
		want[s] = true
	}
	if len(in) != len(want) {
		t.Fatalf("ochiq holatlar soni %d, kutilgan %d: %#v", len(in), len(want), in)
	}
	for _, s := range in {
		if !want[s] {
			t.Errorf("ochiq filtrda kutilmagan holat: %q", s)
		}
		delete(want, s)
	}
	for _, s := range []string{errlog.StatusNew, errlog.StatusWatching, errlog.StatusFixing, errlog.StatusRegressed} {
		if want[s] {
			t.Errorf("ochiq filtrda %q yo'q", s)
		}
	}
	// Yopiq holatlar bu yerda bo'lmasligi kerak.
	for _, s := range in {
		if s == errlog.StatusResolved || s == errlog.StatusIgnored {
			t.Errorf("yopiq holat ochiq filtrga tushib qolgan: %q", s)
		}
	}
}

// Adminning O'ZI qo'ya oladigan holatlar ro'yxati — `regressed` bu yerda
// BO'LMASLIGI kerak. Uni qo'lda qo'yish mumkin bo'lsa, "qayta paydo bo'ldi"
// belgisi haqiqiy takrorlanish dalili bo'lishdan to'xtardi: u endi
// kuzatuvning xulosasi emas, adminning fikri bo'lardi.
func TestManualStatusesExcludeRegressed(t *testing.T) {
	if errlog.ManualStatuses[errlog.StatusRegressed] {
		t.Error("regressed qo'lda qo'yiladigan holatlar ro'yxatida — tizim belgisi qo'lga o'tib ketdi")
	}
	for _, s := range []string{
		errlog.StatusNew, errlog.StatusWatching, errlog.StatusFixing,
		errlog.StatusResolved, errlog.StatusIgnored,
	} {
		if !errlog.ManualStatuses[s] {
			t.Errorf("%q qo'lda qo'yilishi kerak edi", s)
		}
	}
}

func TestErrFilterAll(t *testing.T) {
	if f := filterFor(t, "status=all"); f["status"] != nil {
		t.Errorf("status=all filtr qoldirdi: %#v", f["status"])
	}
}

// Noto'g'ri qiymat JIMGINA e'tiborsiz qoldirilmasligi kerak. Aks holda
// `?status=resolvd` so'rovi butun jurnalni qaytarardi va chaqiruvchi buni
// bilmasdi — filtrga ishonib, noto'g'ri xulosa chiqarardi.
func TestErrFilterRejectsUnknownValues(t *testing.T) {
	bad := []string{
		"status=resolvd", "severity=urgent", "module=payments",
		"from=kecha", "to=2026-13-45",
		"q=" + strings.Repeat("a", maxErrQuery+1),
	}
	for _, q := range bad {
		if _, err := errFilter(httptest.NewRequest("GET", "/admin/errors?"+q, nil)); err == nil {
			t.Errorf("%q qabul qilindi — 400 kutilgan edi", q)
		}
	}
}

func TestErrFilterAcceptsCatalogValues(t *testing.T) {
	for sev := range errlog.Severities {
		if f := filterFor(t, "severity="+sev); f["severity"] != sev {
			t.Errorf("severity=%s o'tmadi", sev)
		}
	}
	for mod := range errlog.Modules {
		if f := filterFor(t, "module="+mod); f["module"] != mod {
			t.Errorf("module=%s o'tmadi", mod)
		}
	}
	for st := range errlog.Statuses {
		if f := filterFor(t, "status="+st); f["status"] != st {
			t.Errorf("status=%s o'tmadi", st)
		}
	}
}

// Qidiruv matni regexp'ga aylanadi. Ekranlanmasa, `.*` butun jurnalni
// qaytarar, `(((` esa so'rovni yiqitardi.
func TestErrFilterEscapesQuery(t *testing.T) {
	f := filterFor(t, "q=.%2A%28")
	or, ok := f["$or"].(bson.A)
	if !ok || len(or) == 0 {
		t.Fatalf("$or yo'q: %#v", f)
	}
	first, _ := or[0].(bson.M)
	re, ok := first["code"].(primitive.Regex)
	if !ok {
		t.Fatalf("regexp emas: %#v", first["code"])
	}
	for _, want := range []string{`\.`, `\*`, `\(`} {
		if !strings.Contains(re.Pattern, want) {
			t.Errorf("qidiruv ekranlanmagan (%s yo'q): %q", want, re.Pattern)
		}
	}
}

// Saralash yopiq ro'yxatdan olinadi: indekslanmagan maydon bo'yicha sort
// Mongo'ni xotirada saralashga majbur qilib, 32 MB chegarasiga urardi.
func TestErrSortsAreClosed(t *testing.T) {
	for _, k := range []string{"last", "count", "users", "first", "severity"} {
		if _, ok := errSorts[k]; !ok {
			t.Errorf("saralash %q yo'q", k)
		}
	}
	if _, ok := errSorts["message"]; ok {
		t.Error("ro'yxatga tasodifiy maydon kirib qolgan")
	}
}
