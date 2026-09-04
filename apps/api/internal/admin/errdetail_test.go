package admin

import (
	"encoding/json"
	"strings"
	"testing"
)

// "Ta'sir taqsimoti" ning sof mantig'i (Figma 3.12.3 · K). Bu yerdagi
// hisob-kitob bazaga bog'liq emas: Mongo faqat saralangan bosh qism va
// BUTUN kesim yig'indisini beradi, foiz va "Boshqa" qatori Go tomonida
// yasaladi — demak ularni to'g'ridan-to'g'ri sinash mumkin.

// facetOf — bitta kesim natijasini yig'adigan yordamchi: nomli qatorlar va
// kesimning to'liq yig'indisi (dum shu ikkisining farqidan chiqadi).
func facetOf(total int64, rows ...shareRow) []shareFacet {
	return []shareFacet{{Top: rows, Total: total}}
}

// Dum bor: oxirgi qator "Boshqa" bo'lishi, MASHINA O'QIYDIGAN Other belgisi
// bilan kelishi va foizlar butun kesimga (100% ga) yig'ilishi kerak.
func TestSharesTail(t *testing.T) {
	// 41+30+11+9+5 nomli, qolgan 4 — dum.
	out := shares(facetOf(100,
		shareRow{ID: "Samsung", N: 41},
		shareRow{ID: "Xiaomi", N: 30},
		shareRow{ID: "Apple", N: 11},
		shareRow{ID: "Realme", N: 9},
		shareRow{ID: "Huawei", N: 5},
	))
	if len(out) != errShareLimit+1 {
		t.Fatalf("qatorlar soni %d, kutilgan %d (5 nomli + Boshqa)", len(out), errShareLimit+1)
	}
	last := out[len(out)-1]
	if last.Key != errShareOther || !last.Other {
		t.Errorf("oxirgi qator dum emas: key=%q other=%v", last.Key, last.Other)
	}
	if last.N != 4 || last.Pct != 4 {
		t.Errorf("dum qiymati noto'g'ri: n=%d pct=%d, kutilgan 4/4", last.N, last.Pct)
	}
	sum := 0
	for i, s := range out[:len(out)-1] {
		if s.Other {
			t.Errorf("nomli qator %d (%q) dum deb belgilandi", i, s.Key)
		}
		sum += s.Pct
	}
	sum += last.Pct
	// Yaxlitlash har qatorda ±0.5% berishi mumkin, shuning uchun aniq 100
	// emas, tor oraliq tekshiriladi.
	if sum < 98 || sum > 102 {
		t.Errorf("foizlar yig'indisi %d%%, ~100%% kutilgan", sum)
	}
}

// Dum yo'q (nomli qatorlar butun kesimni qoplaydi) — "Boshqa" qatori
// UMUMAN qo'shilmasligi kerak, aks holda panelda 0% li bo'sh ustun paydo
// bo'lardi.
func TestSharesNoTail(t *testing.T) {
	out := shares(facetOf(10,
		shareRow{ID: "Android", N: 7},
		shareRow{ID: "iOS", N: 3},
	))
	if len(out) != 2 {
		t.Fatalf("qatorlar soni %d, kutilgan 2", len(out))
	}
	for _, s := range out {
		if s.Key == errShareOther || s.Other {
			t.Errorf("dum yo'q edi, lekin %q qatori qo'shildi", s.Key)
		}
	}
	if out[0].Pct != 70 || out[1].Pct != 30 {
		t.Errorf("foizlar noto'g'ri: %d/%d, kutilgan 70/30", out[0].Pct, out[1].Pct)
	}
}

// Bo'sh kesim: nolga bo'linish YO'Q va javob nil emas, bo'sh ro'yxat
// (JSON'da `[]` bo'lib chiqadi — panel uni `null` deb tekshirmasligi kerak).
func TestSharesEmpty(t *testing.T) {
	for name, in := range map[string][]shareFacet{
		"facet umuman yo'q": {},
		"total nol":         facetOf(0),
		"total manfiy":      facetOf(-1, shareRow{ID: "X", N: 1}),
	} {
		out := shares(in)
		if out == nil {
			t.Errorf("%s: nil qaytdi, bo'sh ro'yxat kutilgan", name)
		}
		if len(out) != 0 {
			t.Errorf("%s: %d ta qator qaytdi, 0 kutilgan", name, len(out))
		}
	}
}

// sharePct chegaralari: eng kichik ulush ham 0% bo'lib qolmasligi, eng
// kattasi 100% dan oshmasligi kerak.
func TestSharePct(t *testing.T) {
	cases := []struct {
		n, total int64
		want     int
	}{
		{100, 100, 100}, // butun kesim
		{1, 100, 1},     // bitta hodisa ham ko'rinadi
		{1, 200, 1},     // 0.5% — pastga emas, yuqoriga yaxlitlanadi
		{1, 300, 0},     // 0.33% — nolga yaxlitlanadi
		{2, 3, 67},      // 66.6% → 67
		{1, 3, 33},      // 33.3% → 33
		{0, 10, 0},
	}
	for _, c := range cases {
		if got := sharePct(c.n, c.total); got != c.want {
			t.Errorf("sharePct(%d, %d) = %d, kutilgan %d", c.n, c.total, got, c.want)
		}
	}
}

// maskPhone qo'riqchisi kesimlar arifmetikasiga mos bo'lishi kerak: 9 dan
// kam raqamda kesimlar manfiy indeksga tushib PANIKA berardi, panika esa
// butun "Xatolik — batafsil" sahifasini 500 ga tushirardi.
func TestMaskPhoneGuard(t *testing.T) {
	cases := map[string]string{
		"1234567":       "",                  // 7 raqam — eski qo'riqchi o'tkazib yuborardi
		"12345678":      "",                  // 8 raqam — eski qo'riqchi o'tkazib yuborardi
		"901234542":     "90 ••• •• 42",      // 9 raqam — davlat kodisiz milliy format
		"+998901234542": "+998 90 ••• •• 42", // 12 raqam — to'liq format
	}
	for in, want := range cases {
		got := func() (s string) {
			// Panika bo'lsa test butun paketni yiqitmasin — aynan shu
			// nuqson qayta paydo bo'lganini aniq xabar bilan ko'rsatamiz.
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("maskPhone(%q) panika berdi: %v", in, r)
					s = "<panic>"
				}
			}()
			return maskPhone(in)
		}()
		if got != want {
			t.Errorf("maskPhone(%q) = %q, kutilgan %q", in, got, want)
		}
	}
}

// SinceStarted JSON'da ko'rsatkich bo'lishi SHART.
//
// "Ish boshlandi, o'shandan beri bitta ham yangi hodisa yo'q" — bu eng
// ijobiy javob, lekin uning qiymati 0. Oddiy `int64` + `omitempty` bilan
// nol JSON'dan tushib qolar va panel uni "startedAt yo'q" bilan bir xil
// ko'rib "aniqlanmagan" chizardi, ya'ni yaxshi xabar nosozlik belgisiga
// aylanardi. Ko'rsatkich ikki holatni ajratadi: nil = hisoblanmadi,
// &0 = hisoblandi va nolta.
func TestSinceStartedJSON(t *testing.T) {
	zero := int64(0)
	b, err := json.Marshal(errDetail{SinceStarted: &zero})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"sinceStarted":0`) {
		t.Errorf("sinceStarted 0 tushib qoldi: %s", b)
	}
	b2, err := json.Marshal(errDetail{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b2), "sinceStarted") {
		t.Errorf("startedAt yo'q, lekin maydon yuborildi: %s", b2)
	}
}

// Dum qatori MASHINA O'QIYDIGAN belgi bilan kelishi kerak.
//
// Frontend "Eski versiyalarda" xulosasini `impact.app` dan yasaydi. Agar
// dum faqat "Boshqa" yorlig'i bilan ajratilsa, o'sha yorliq o'zgargan
// (yoki tarjima qilingan) kuni tekshiruv JIMGINA buziladi va "Boshqa"
// versiya deb o'qiladi.
func TestShareOtherFlagJSON(t *testing.T) {
	b, err := json.Marshal(shares(facetOf(100, shareRow{ID: "Samsung", N: 90})))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"other":true`) {
		t.Errorf("dum qatorida other belgisi yo'q: %s", b)
	}
	// Nomli qatorda belgi umuman bo'lmasligi kerak (omitempty).
	if n := strings.Count(string(b), `"other"`); n != 1 {
		t.Errorf("other %d marta chiqdi, kutilgan 1 (faqat dumda): %s", n, b)
	}
}
