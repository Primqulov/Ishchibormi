package application

import (
	"regexp"
	"testing"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestSlotsRemaining(t *testing.T) {
	cases := []struct {
		needed, accepted, want int
	}{
		{5, 0, 5},
		{5, 2, 3},
		{5, 5, 0},
		{5, 7, 0}, // over-filled clamps to 0, never negative
		{0, 0, 0},
	}
	for _, c := range cases {
		if got := slotsRemaining(c.needed, c.accepted); got != c.want {
			t.Errorf("slotsRemaining(%d,%d)=%d, want %d", c.needed, c.accepted, got, c.want)
		}
	}
}

func TestHasEnoughSlots(t *testing.T) {
	cases := []struct {
		name                     string
		needed, accepted, people int
		want                     bool
	}{
		{"exact fit", 5, 3, 2, true},
		{"one too many", 5, 3, 3, false},
		{"single into last slot", 5, 4, 1, true},
		{"full elon rejects", 5, 5, 1, false},
		{"over-filled rejects", 5, 7, 1, false},
		{"unbounded (0) always fits", 0, 100, 9, true},
		{"negative needed treated as unbounded", -1, 3, 4, true},
	}
	for _, c := range cases {
		if got := hasEnoughSlots(c.needed, c.accepted, c.people); got != c.want {
			t.Errorf("%s: hasEnoughSlots(%d,%d,%d)=%v, want %v",
				c.name, c.needed, c.accepted, c.people, got, c.want)
		}
	}
}

func TestPeopleOf(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, 1}, // missing/zero counts as one worker
		{-3, 1},
		{1, 1},
		{4, 4},
	}
	for _, c := range cases {
		a := models.Application{PeopleCount: c.in}
		if got := peopleOf(a); got != c.want {
			t.Errorf("peopleOf(PeopleCount=%d)=%d, want %d", c.in, got, c.want)
		}
	}
}

func TestActorRoleAndOtherParty(t *testing.T) {
	worker := primitive.NewObjectID()
	employer := primitive.NewObjectID()
	stranger := primitive.NewObjectID()
	a := models.Application{WorkerID: worker, EmployerID: employer}

	if got := actorRole(a, worker); got != "worker" {
		t.Errorf("actorRole(worker)=%q, want worker", got)
	}
	if got := actorRole(a, employer); got != "employer" {
		t.Errorf("actorRole(employer)=%q, want employer", got)
	}
	if got := actorRole(a, stranger); got != "" {
		t.Errorf("actorRole(stranger)=%q, want empty", got)
	}

	if got := otherParty(a, worker); got != employer {
		t.Errorf("otherParty(worker) should be employer")
	}
	if got := otherParty(a, employer); got != worker {
		t.Errorf("otherParty(employer) should be worker")
	}
}

func TestCanCancel(t *testing.T) {
	live := []string{"pending", "accepted"}
	terminal := []string{"rejected", "cancelled", "completed", "", "unknown"}
	for _, s := range live {
		if !canCancel(s) {
			t.Errorf("canCancel(%q)=false, want true", s)
		}
	}
	for _, s := range terminal {
		if canCancel(s) {
			t.Errorf("canCancel(%q)=true, want false", s)
		}
	}
}

func TestBothConfirmed(t *testing.T) {
	cases := []struct {
		emp, wrk, want bool
	}{
		{false, false, false},
		{true, false, false},
		{false, true, false},
		{true, true, true},
	}
	for _, c := range cases {
		a := models.Application{EmployerConfirmedDone: c.emp, WorkerConfirmedDone: c.wrk}
		if got := bothConfirmed(a); got != c.want {
			t.Errorf("bothConfirmed(emp=%v,wrk=%v)=%v, want %v", c.emp, c.wrk, got, c.want)
		}
	}
}

func TestStartDay(t *testing.T) {
	cases := []struct{ in, want string }{
		// Yalang sana (web/seed).
		{"2026-08-25", "2026-08-25"},
		// To'liq ISO sana-vaqt (Flutter ilovasi) — soat tashlab yuboriladi.
		{"2026-08-25T14:30:00.000", "2026-08-25"},
		{"2026-08-25T08:00:00.000Z", "2026-08-25"},
		{" 2026-08-25T23:59:00+05:00 ", "2026-08-25"},
		// Sana yo'q yoki yaroqsiz — kun aniqlanmaydi.
		{"", ""},
		{"2026-08", ""},
		{"25-08-2026", ""},
		{"kecha", ""},
	}
	for _, c := range cases {
		if got := startDay(c.in); got != c.want {
			t.Errorf("startDay(%q)=%q, want %q", c.in, got, c.want)
		}
	}
}

// Bir kunga bitta ish qoidasining o'zagi: solishtiruv KUN bo'yicha bo'lishi
// kerak, xom satr bo'yicha emas — aks holda bir kundagi, lekin turli soatga
// qo'yilgan ikki ish "boshqa kun" deb qolib ketadi.
func TestSameDay(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		want bool
	}{
		{"bir xil yalang sana", "2026-08-25", "2026-08-25", true},
		{"bir kun, turli soat", "2026-08-25T08:00:00.000", "2026-08-25T14:30:00.000", true},
		{"aralash format, bir kun", "2026-08-25", "2026-08-25T14:30:00.000", true},
		{"ertangi kun", "2026-08-25T08:00:00.000", "2026-08-26T08:00:00.000", false},
		{"boshqa oy", "2026-08-25", "2026-09-25", false},
		{"sanasiz e'lon hech kim bilan mos emas", "", "2026-08-25", false},
		{"ikkalasi ham sanasiz", "", "", false},
		{"yaroqsiz sana", "kecha", "kecha", false},
	}
	for _, c := range cases {
		if got := sameDay(c.a, c.b); got != c.want {
			t.Errorf("%s: sameDay(%q,%q)=%v, want %v", c.name, c.a, c.b, got, c.want)
		}
	}
}

// Mongo filtri ham xuddi shu kun mantiqini bajarishi kerak: e'lon bazada
// qaysi ko'rinishda saqlangan bo'lsa ham, kun mos bo'lsa topilsin.
func TestSameDayElonFilter(t *testing.T) {
	f := sameDayElonFilter("2026-08-25")
	rx, ok := f["startDate"].(primitive.Regex)
	if !ok {
		t.Fatalf("startDate filtri primitive.Regex emas: %T", f["startDate"])
	}
	re, err := regexp.Compile(rx.Pattern)
	if err != nil {
		t.Fatalf("regex kompilyatsiya qilinmadi: %v", err)
	}
	match := []string{
		"2026-08-25",
		"2026-08-25T00:00:00.000",
		"2026-08-25T14:30:00.000Z",
	}
	noMatch := []string{
		"2026-08-26",
		"2026-08-24T23:59:00.000",
		"2026-09-25",
		"",
	}
	for _, v := range match {
		if !re.MatchString(v) {
			t.Errorf("%q mos kelishi kerak edi", v)
		}
	}
	for _, v := range noMatch {
		if re.MatchString(v) {
			t.Errorf("%q mos kelmasligi kerak edi", v)
		}
	}
}
