package admin

import (
	"strings"
	"testing"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/errlog"
	"github.com/ishchibormi/backend/internal/models"
)

// AI konteksti — panel ishlab chiqaradigan eng zich diagnostika matni va u
// ATAYLAB tashqariga ko'chiriladi (nusxa olish, .md fayl, Telegram). Ya'ni
// niqob ishlamasa, sir perimetrdan chiqib ketadi va buni hech kim sezmaydi.
// Shuning uchun har bir shakl alohida tekshiriladi.
func TestMaskSecrets(t *testing.T) {
	cases := []struct {
		name string
		in   string
		// gone — natijada QOLMASLIGI kerak bo'lgan bo'laklar.
		gone []string
		// keep — diagnostika uchun kerak, saqlanishi kerak.
		keep []string
	}{
		{
			name: "JWT",
			in:   `Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2YThkYTJiNyJ9.QWxpVmFsaXlldlNpZ25hdHVyZQ`,
			gone: []string{"eyJhbGciOiJIUzI1NiJ9", "QWxpVmFsaXlldlNpZ25hdHVyZQ"},
		},
		{
			name: "Bearer token",
			in:   `curl -H "Authorization: Bearer sk_live_9aF2kQzR7wLmXpTn" /api/admin/users`,
			gone: []string{"sk_live_9aF2kQzR7wLmXpTn"},
			keep: []string{"/api/admin/users"},
		},
		{
			name: "kalit=qiymat",
			in:   `{"password":"Admin123!","otp":"482913","secret":"s3cr3tvalue"}`,
			gone: []string{"Admin123!", "482913", "s3cr3tvalue"},
		},
		{
			name: "telefon",
			in:   `foydalanuvchi +998 90 123 45 42 bilan bog'lanmadi`,
			gone: []string{"123 45 42", "9012345"},
			keep: []string{"bog'lanmadi"},
		},
		{
			name: "telefon ajratgichsiz",
			in:   `phone=+998901234542`,
			gone: []string{"901234542", "1234542"},
		},
		{
			name: "IP manzil",
			in:   `client 213.230.99.144 timed out`,
			gone: []string{"99.144"},
			keep: []string{"213.230.•••.•••", "timed out"},
		},
		{
			name: "uzun raqam",
			in:   `card 4278310012345678 rejected`,
			gone: []string{"4278310012345678"},
			keep: []string{"rejected"},
		},
		{
			// `code` ataylab niqoblanmaydi: javob tanasidagi xato kodi
			// diagnostikaning o'zagi va sir emas.
			name: "xato kodi saqlanadi",
			in:   `{"error":{"code":"internal","message":"nil map"}}`,
			keep: []string{`"code":"internal"`, "nil map"},
		},
		{
			name: "stack trace o'qiladigan qoladi",
			in:   `#0 ApiClient.get · lib/core/network/api_client.dart:292:24`,
			keep: []string{"ApiClient.get", "api_client.dart:292:24"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := maskSecrets(c.in)
			for _, g := range c.gone {
				if strings.Contains(got, g) {
					t.Errorf("niqoblanmagan bo'lak %q qoldi:\n%s", g, got)
				}
			}
			for _, k := range c.keep {
				if !strings.Contains(got, k) {
					t.Errorf("kerakli bo'lak %q yo'qoldi:\n%s", k, got)
				}
			}
		})
	}
}

// maskSecrets bo'sh matnda ham, juda uzun matnda ham yiqilmasligi kerak:
// u eksport yo'lidagi YAGONA filtr, panic bo'lsa ma'lumot niqobsiz
// qaytmaydi — javob umuman kelmaydi, lekin ekran ham ishlamaydi.
func TestMaskSecretsEdgeCases(t *testing.T) {
	if maskSecrets("") != "" {
		t.Error("bo'sh matn o'zgardi")
	}
	long := strings.Repeat("+998901234542 213.230.99.144 token=abcdef123456 ", 200)
	out := maskSecrets(long)
	if strings.Contains(out, "901234542") || strings.Contains(out, "99.144") ||
		strings.Contains(out, "abcdef123456") {
		t.Error("uzun matnda niqob ishlamadi")
	}
}

// Telefon niqobi QAYTARIB BO'LMAYDIGAN bo'lishi kerak: o'rtadagi raqamlar
// butunlay yo'qoladi, faqat operator kodi va oxirgi ikkitasi qoladi.
func TestMaskPhone(t *testing.T) {
	cases := map[string]string{
		"+998901234542":      "+998 90 ••• •• 42",
		"998 90 123 45 42":   "+998 90 ••• •• 42",
		"+998 (99) 887-6655": "+998 99 ••• •• 55",
		"":                   "",
		"12345":              "",
		// 7 va 8 raqam — kesimlar arifmetikasining chegarasi: qo'riqchi 7
		// bo'lganida bu ikkisi manfiy indeksga tushib PANIKA berardi
		// (maskPhone izohiga qarang). To'liq bo'lmagan raqam niqoblanmaydi.
		"1234567":  "",
		"12345678": "",
	}
	for in, want := range cases {
		if got := maskPhone(in); got != want {
			t.Errorf("maskPhone(%q) = %q, kutilgan %q", in, got, want)
		}
	}
	// Niqoblangan qiymatdan asl raqamni tiklab bo'lmasligini tekshiramiz:
	// turli raqamlar bir xil niqobga tushishi mumkin bo'lishi KERAK.
	if maskPhone("+998901114542") != maskPhone("+998909994542") {
		t.Error("niqob juda ko'p ma'lumot qoldirmoqda — o'rta raqamlar ajralib turadi")
	}
}

// `include` ro'yxati yopiq to'plam: noma'lum kalit JIMGINA tashlanmaydi.
// Aks holda `include=stack,stak` so'rovi stekni bir marta qo'shib, admin
// esa ikkinchi kalitni yozganini bilmay qolardi.
func TestParseInclude(t *testing.T) {
	inc, unavail, err := parseInclude("")
	if err != nil || len(inc) != len(incDefault) || len(unavail) != 0 {
		t.Fatalf("bo'sh include sukut to'plamini bermadi: %v %v %v", inc, unavail, err)
	}
	inc, unavail, err = parseInclude("stack, device ,serverlog,stack")
	if err != nil {
		t.Fatalf("to'g'ri include xato qaytardi: %v", err)
	}
	if len(inc) != 2 || inc[0] != incStack || inc[1] != incDevice {
		t.Errorf("include noto'g'ri: %v", inc)
	}
	if len(unavail) != 1 || unavail[0] != incServerLog {
		t.Errorf("mavjud bo'lmagan kalit ajratilmadi: %v", unavail)
	}
	if _, _, err := parseInclude("stack,mask"); err == nil {
		t.Error("noma'lum kalit qabul qilindi — 400 kutilgan edi")
	}
	// "mask" degan kalit umuman yo'q: niqoblashni o'chirish imkoniyati
	// API darajasida MAVJUD EMAS, faqat UI da o'chirilmaydigan tugma emas.
	if incAvailable["mask"] || incUnavailable["mask"] {
		t.Error("niqoblash kaliti include to'plamiga tushib qolgan")
	}
}

// Chastota chegarasi haqiqatan to'xtatishi kerak: eksport — jurnalni
// bo'lak-bo'lak tashqariga ko'chirishning eng qulay yo'li.
func TestRateBucket(t *testing.T) {
	b := &rateBucket{limit: 3, window: time.Minute, hits: map[string][]time.Time{}}
	for i := 0; i < 3; i++ {
		if !b.allow("a") {
			t.Fatalf("%d-chi urinish to'xtatildi", i+1)
		}
	}
	if b.allow("a") {
		t.Error("chegaradan keyin ham ruxsat berildi")
	}
	// Kalitlar mustaqil: bitta admin ikkinchisining budjetini yemaydi.
	if !b.allow("b") {
		t.Error("boshqa kalit ham to'xtatildi")
	}
}

// join — osilib qolgan ajratgichning oldini oladi.
//
// `strings.TrimSpace(a + sep + b)` faqat probelni oladi, ajratgichning
// o'zi qolib ketadi: "Brauzer: Dart 3 ·" yoki bundan yomoni "Brauzer: ·" —
// oxirgisida `val()` ham aldanadi, chunki satr bo'sh emas va "aniqlanmagan"
// o'rniga yolg'iz ajratgich ko'rinadi.
func TestJoinAjratgich(t *testing.T) {
	cases := []struct {
		sep   string
		parts []string
		want  string
	}{
		{" · ", []string{"Chrome 128", "Blink"}, "Chrome 128 · Blink"},
		{" · ", []string{"Dart 3", ""}, "Dart 3"},
		{" · ", []string{"", "Blink"}, "Blink"},
		{" · ", []string{"", ""}, ""},
		{" · ", []string{"  ", "\t"}, ""},
		{" / ", []string{"3.24.0", ""}, "3.24.0"},
		{" / ", []string{"", "3.5.0"}, "3.5.0"},
	}
	for _, c := range cases {
		got := join(c.sep, c.parts...)
		if got != c.want {
			t.Errorf("join(%q, %q) = %q, kutilgan %q", c.sep, c.parts, got, c.want)
		}
		// Bo'sh natija `val()` ga tushganda "aniqlanmagan" bo'lishi kerak.
		if c.want == "" && val(got) != unknownVal {
			t.Errorf("join(%q, %q) → val() = %q, kutilgan %q", c.sep, c.parts, val(got), unknownVal)
		}
	}
}

// "Manba:" qatori odam o'qiydigan modul nomini yozishi kerak.
//
// AI kontekstiga xom kalit ("client_app") bormasligi kerak, va bu qator
// panelning demo nusxasi (`xatoDemo.ts` — `MODUL[g.module]`) bilan bir xil
// matn berishi shart: aks holda backend ulanganda ekrandagi matn jimgina
// o'zgaradi.
func TestManbaModulNomi(t *testing.T) {
	if got := join(" · ", "Foydalanuvchi ilova", errlog.ModuleLabel("client_app")); got != "Foydalanuvchi ilova · Foydalanuvchi ilovasi" {
		t.Errorf("manba = %q", got)
	}
	// Runtime bo'sh bo'lsa ajratgich osilib qolmasin.
	if got := join(" · ", "", errlog.ModuleLabel("backend")); got != "Backend" {
		t.Errorf("runtime bo'sh: %q", got)
	}
	// Noma'lum kalit yo'qolmasin — xom qiymat qaytadi.
	if got := errlog.ModuleLabel("kelajakdagi_modul"); got != "kelajakdagi_modul" {
		t.Errorf("noma'lum modul = %q", got)
	}
}

// AI eksportida OS ATIGI BIR MARTA chiqishi kerak.
//
// `deviceWithCode` `errlog.DeviceLabel` ustiga quriladi, DeviceLabel esa
// yorliqning ichiga OS ni allaqachon qo'shadi. Ortidan yana "OS: …" qatorini
// yozsak, AI ga bir xil ma'lumot ikki marta boradi. Teskari xavf ham bor:
// takrorni olib tashlashda OS umuman yo'qolib qolmasligi kerak.
func TestDeviceLinesOSBirMarta(t *testing.T) {
	h := &Handler{Cfg: config.Config{AppEnv: "test"}}
	g := &models.ErrorGroup{}
	cases := map[string]models.ErrorDevice{
		"mobil to'liq": {
			Brand: "Xiaomi", Model: "Redmi Note 12", ModelCode: "2201117TG",
			OS: "Android", OSVersion: "14", APILevel: "34", AppVersion: "1.4.2", Build: "118",
		},
		"brauzer":         {Browser: "Chrome 128", Engine: "Blink", OS: "Windows", OSVersion: "11", Platform: "web"},
		"brauzer OS yo'q": {Browser: "Chrome 128", Engine: "Blink", Platform: "web"},
		"model yo'q":      {OS: "Android", OSVersion: "14", APILevel: "34"},
		"bo'sh":           {},
	}
	for name, d := range cases {
		lines := h.deviceLines(g, &models.ErrorSample{Device: d})
		os := strings.TrimSpace(d.OS + " " + d.OSVersion)
		if os != "" {
			n := 0
			for _, l := range lines {
				if strings.Contains(l, os) {
					n++
				}
			}
			switch {
			case n == 0:
				t.Errorf("%s: OS %q umuman yo'q: %q", name, os, lines)
			case n > 1:
				t.Errorf("%s: OS %q %d qatorda takrorlandi: %q", name, os, n, lines)
			}
		}
		// Ajratgich osilib qolmasin (join qo'riqchisining regressiya sinovi).
		for _, l := range lines {
			if strings.HasSuffix(l, " ·") || strings.HasSuffix(l, " /") ||
				strings.Contains(l, ": ·") || strings.Contains(l, ": /") {
				t.Errorf("%s: osilib qolgan ajratgich: %q", name, l)
			}
		}
	}
	// API darajasi qurilma qatoriga qo'shilishi kerak (Figma L).
	lines := h.deviceLines(g, &models.ErrorSample{Device: cases["mobil to'liq"]})
	var qur string
	for _, l := range lines {
		if strings.HasPrefix(l, "Qurilma: ") {
			qur = l
		}
	}
	if want := "Qurilma: Xiaomi Redmi Note 12 (2201117TG) · Android 14 (API 34)"; qur != want {
		t.Errorf("qurilma qatori = %q, kutilgan %q", qur, want)
	}
}
