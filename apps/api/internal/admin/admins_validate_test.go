package admin

import (
	"strings"
	"testing"
)

/*
Kadr hisoblari — kirish tekshiruvlari (Figma 3.9 / 3.9a).

Bu testlar HTTP matnini emas, mijozga ketadigan XATO KODINI tekshiradi:
panel oynasi o'zbekcha xabarni aynan kod bo'yicha tanlaydi. `kod()`
yordamchisi categories_validate_test.go da.
*/

func TestAdminUsername(t *testing.T) {
	for nom, tc := range map[string]struct {
		kirish string
		kutgan string
		natija string
	}{
		"oddiy":                {"aziza", "", "aziza"},
		"katta harf pasayadi":  {"AZIZA", "", "aziza"},
		"chetlari kesiladi":    {"  aziza.k  ", "", "aziza.k"},
		"nuqta va tire":        {"aziza.k-01_x", "", "aziza.k-01_x"},
		"eng qisqa":            {"abc", "", "abc"},
		"qisqa":                {"ab", "bad_username", ""},
		"bo'sh":                {"", "bad_username", ""},
		"faqat bo'sh joy":      {"     ", "bad_username", ""},
		"aynan chegarada":      {strings.Repeat("a", adminUserMax), "", strings.Repeat("a", adminUserMax)},
		"bir belgi ortiq":      {strings.Repeat("a", adminUserMax+1), "bad_username", ""},
		"ichida bo'shliq":      {"aziza k", "bad_username", ""},
		"nuqta bilan tugaydi":  {"aziza.", "bad_username", ""},
		"tire bilan boshlanad": {"-aziza", "bad_username", ""},
		"kirillcha":            {"азиза", "bad_username", ""},
		"@ belgisi":            {"@aziza", "bad_username", ""},
		"slash":                {"aziza/admin", "bad_username", ""},
	} {
		got, err := adminUsername(tc.kirish)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if got != tc.natija {
			t.Errorf("%s: username %q, kutilgan %q", nom, got, tc.natija)
		}
	}
}

// Username `totp.URI` ichiga va audit jurnaliga tushadi. Query yoki yangi
// qator belgisi o'sha satrlarni buzardi, shuning uchun alohida tekshiramiz.
func TestAdminUsernameURIniBuzmaydi(t *testing.T) {
	for _, kirish := range []string{
		"aziza?issuer=Evil", "aziza&x=1", "aziza#frag", "aziza\nadmin",
		"aziza:admin", "aziza%2f", "aziza\tadmin", "a/../b",
	} {
		if _, err := adminUsername(kirish); kod(err) != "bad_username" {
			t.Errorf("%q qabul qilindi — otpauth URI va jurnal buzilishi mumkin", kirish)
		}
	}
}

func TestAdminName(t *testing.T) {
	for nom, tc := range map[string]struct {
		kirish string
		kutgan string
		natija string
	}{
		"bo'sh — ruxsat":     {"", "", ""},
		"chetlari kesiladi":  {"  Aziza Karimova  ", "", "Aziza Karimova"},
		"aynan chegarada":    {strings.Repeat("a", adminNameMax), "", strings.Repeat("a", adminNameMax)},
		"bir belgi ortiq":    {strings.Repeat("a", adminNameMax+1), "name_too_long", ""},
		"kirillcha chegara":  {strings.Repeat("ў", adminNameMax), "", strings.Repeat("ў", adminNameMax)},
		"kirillcha ortiqcha": {strings.Repeat("ў", adminNameMax+1), "name_too_long", ""},
	} {
		got, err := adminName(tc.kirish)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if got != tc.natija {
			t.Errorf("%s: ism %q, kutilgan %q", nom, got, tc.natija)
		}
	}
}

// Ism rune bo'yicha o'lchanadi: 100 harfli kirillcha ism 200 bayt bo'ladi
// va bayt bo'yicha hisoblanganda haqli ism rad etilardi.
func TestAdminNameRuneBoyichaOlchanadi(t *testing.T) {
	ism := strings.Repeat("ў", adminNameMax)
	if len(ism) <= adminNameMax {
		t.Fatalf("test o'zi buzuq: %d bayt", len(ism))
	}
	if _, err := adminName(ism); err != nil {
		t.Errorf("%d runeli ism rad etildi: %v", adminNameMax, kod(err))
	}
}

func TestAdminPassword(t *testing.T) {
	for nom, tc := range map[string]struct {
		kirish string
		kutgan string
	}{
		"bo'sh":            {"", "weak_password"},
		"qisqa":            {strings.Repeat("a", adminPassMin-1), "weak_password"},
		"aynan minimum":    {strings.Repeat("a", adminPassMin), ""},
		"aynan maksimum":   {strings.Repeat("a", adminPassMax), ""},
		"bir bayt ortiq":   {strings.Repeat("a", adminPassMax+1), "weak_password"},
		"bo'shliq saqlan.": {"  parol  1234  ", ""},
	} {
		got, err := adminPassword(tc.kirish)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		// Parol HECH QACHON kesilmaydi yoki tozalanmaydi: chetidagi
		// bo'shliq ham parolning bir qismi.
		if err == nil && got != tc.kirish {
			t.Errorf("%s: parol o'zgartirildi", nom)
		}
	}
}

// Yuqori chegara — aynan bcrypt chegarasi (72 BAYT). Kirillcha parol
// 36 harfda 72 baytga yetadi; undan uzunini qabul qilsak, oxiri jimgina
// tashlanib, admin o'zini himoyalangan deb o'ylab qolardi.
func TestAdminPasswordBaytBoyichaOlchanadi(t *testing.T) {
	// 36 harf × 2 bayt = 72 bayt — chegarada.
	chegara := strings.Repeat("ў", adminPassMax/2)
	if len(chegara) != adminPassMax {
		t.Fatalf("test o'zi buzuq: %d bayt", len(chegara))
	}
	if _, err := adminPassword(chegara); err != nil {
		t.Errorf("72 baytlik parol rad etildi: %v", kod(err))
	}
	if _, err := adminPassword(chegara + "ў"); kod(err) != "weak_password" {
		t.Error("74 baytlik parol qabul qilindi — bcrypt oxirini tashlab yuboradi")
	}
}

// Panel uchta rolni biladi; to'rtinchisi so'ralsa yozuv bo'lmasligi kerak.
func TestValidRoles(t *testing.T) {
	for _, r := range []string{"superadmin", "moderator", "support"} {
		if !validRoles[r] {
			t.Errorf("%q rol rad etildi", r)
		}
	}
	for _, r := range []string{"", "SUPERADMIN", "admin", "root", "owner", " support"} {
		if validRoles[r] {
			t.Errorf("%q rol qabul qilindi", r)
		}
	}
}
