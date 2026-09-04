package errlog

import (
	"strings"
	"testing"
)

// Xatolik matni tashqi xizmatdan, mijozdan yoki so'rovning o'zidan keladi.
// U 180 kun saqlanadi va moderatorga ochiq — ya'ni bu yerdan o'tgan har
// qanday shaxsiy ma'lumot jimgina omborga aylanadi. Test aynan shuni
// tekshiradi: sir, telefon, IP va pochta chiqib ketmasin.
func TestTextMasksSecrets(t *testing.T) {
	cases := []struct {
		name, in string
		gone     []string // matnda QOLMASLIGI kerak
	}{
		{"telefon", "otp yuborilmadi: +998901234567", []string{"901234567", "0123456"}},
		{"telefon bo'shliq bilan", "raqam: +998 90 123 45 67", []string{"1234567", "234 45"}},
		{"ipv4", "dial tcp 192.168.14.32:27017 refused", []string{"14.32", "168.14"}},
		{"ipv6", "dial fe80::1ff:fe23:4567:890a failed", []string{"fe23", "4567"}},
		{"bearer", "Authorization: Bearer abc.def.ghi123456", []string{"abc.def.ghi123456"}},
		{"jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiIxIn0.sig123 rad etildi", []string{"eyJhbGciOiJIUzI1NiJ9"}},
		{"kalitli", "so'rov: ?token=s3cr3tvalue&x=1", []string{"s3cr3tvalue"}},
		{"parol", "password: hunter2hunter2", []string{"hunter2hunter2"}},
		{"pochta", "user ali.valiyev@example.com topilmadi", []string{"ali.valiyev@", "li.valiyev"}},
		{"uzun hex", "hash 9f8e7d6c5b4a39281706f5e4d3c2b1a0ff112233 mos emas", []string{"9f8e7d6c5b4a39281706f5e4d3c2b1a0ff112233"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := Text(c.in)
			for _, g := range c.gone {
				if strings.Contains(out, g) {
					t.Errorf("niqoblanmadi: %q hali ham %q ichida", g, out)
				}
			}
		})
	}
}

// Niqoblash diagnostikani butunlay o'ldirmasligi kerak: xatolikning O'ZI
// (kod, fayl, sabab) o'qiladigan bo'lib qolishi shart, aks holda jurnalning
// ma'nosi yo'q.
func TestTextKeepsDiagnostics(t *testing.T) {
	out := Text("mongo: server selection error on 10.0.0.5:27017 (topology closed)")
	for _, want := range []string{"mongo", "server selection error", "topology closed"} {
		if !strings.Contains(out, want) {
			t.Errorf("%q yo'qoldi: %q", want, out)
		}
	}
	// Versiya raqami telefon emas.
	if got := Text("1.4.3 versiyada tuzatildi"); !strings.Contains(got, "1.4.3") {
		t.Errorf("versiya niqoblanib ketdi: %q", got)
	}
	// Status kodi ham.
	if got := Text("status 500, urinish 3"); !strings.Contains(got, "500") {
		t.Errorf("status niqoblanib ketdi: %q", got)
	}
}

// Boshqaruv belgilari jurnal qatorini buzadi va terminalda ANSI
// ketma-ketligi bo'lib "chiziladi".
func TestTextStripsControlChars(t *testing.T) {
	out := Text("xato\x1b[31mQIZIL\x00\nikkinchi qator")
	if strings.ContainsAny(out, "\x00\x1b\n") {
		t.Errorf("boshqaruv belgisi qoldi: %q", out)
	}
}

func TestTextClips(t *testing.T) {
	out := Text(strings.Repeat("a", MaxMessage*3))
	if len(out) > MaxMessage+4 {
		t.Errorf("uzunlik cheklanmadi: %d", len(out))
	}
}

// So'rov satri — eng "og'ir" joy: OTP peek tokeni, qidiruv matni va telefon
// raqami aynan shu yerda bo'ladi (httpx.AccessLog ham shu sababdan
// RequestURI emas, URL.Path yozadi).
func TestPathDropsQueryAndIDs(t *testing.T) {
	cases := map[string]string{
		"/api/elons?token=abc&phone=998901234567":   "/api/elons",
		"/api/elons/652f1a2b3c4d5e6f70819293":       "/api/elons/:id",
		"/api/elons/652f1a2b3c4d5e6f70819293/apply": "/api/elons/:id/apply",
		"/api/users/1234567/block":                  "/api/users/:id/block",
		"/api/admin/errors#frag":                    "/api/admin/errors",
	}
	for in, want := range cases {
		if got := Path(in); got != want {
			t.Errorf("Path(%q) = %q, kutilgan %q", in, got, want)
		}
	}
}

// Fingerprint — guruhlash kaliti. Bir xil kirish bir xil natija berishi
// (aks holda har hodisa yangi guruh yasardi) va turli kirish turlicha
// bo'lishi shart (aks holda hamma xatolik bitta qatorga qo'shilardi).
func TestFingerprintStableAndDistinct(t *testing.T) {
	a := Fingerprint("internal", "elon.Create", "/api/elons")
	if a != Fingerprint("internal", "elon.Create", "/api/elons") {
		t.Error("fingerprint barqaror emas")
	}
	if a == Fingerprint("internal", "elon.Update", "/api/elons") {
		t.Error("turli `where` bir xil fingerprint berdi")
	}
	if a == Fingerprint("internal", "elon.Create", "/api/users") {
		t.Error("turli yo'l bir xil fingerprint berdi")
	}
	if Ref(a) != Ref(a) || len(Ref(a)) != 10 {
		t.Errorf("Ref shakli noto'g'ri: %q", Ref(a))
	}
}
