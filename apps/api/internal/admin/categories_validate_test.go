package admin

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/ishchibormi/backend/pkg/httpx"
)

// kod — xatodan `code` ni ajratadi; xato bo'lmasa bo'sh satr. Testlar HTTP
// matnini emas, aynan mijozga ketadigan kodni tekshiradi.
func kod(err error) string {
	if err == nil {
		return ""
	}
	var he *httpx.HTTPError
	if errors.As(err, &he) {
		return he.Code
	}
	return "not_http_error"
}

// Turkum nomi — serverdagi chegara. `maxLength` klientda bo'lgani bilan
// so'rov to'g'ridan-to'g'ri API'ga yuborilishi mumkin.
func TestCategoryNameChegara(t *testing.T) {
	for nom, tc := range map[string]struct {
		kirish string
		kutgan string
		natija string
	}{
		"bo'sh":              {"", "bad_request", ""},
		"faqat bo'sh joy":    {"   \t\n ", "bad_request", ""},
		"chetlari kesiladi":  {"  Tozalash  ", "", "Tozalash"},
		"aynan chegarada":    {strings.Repeat("a", catNameMax), "", strings.Repeat("a", catNameMax)},
		"bir belgi ortiq":    {strings.Repeat("a", catNameMax+1), "name_too_long", ""},
		"juda uzun":          {strings.Repeat("a", 100000), "name_too_long", ""},
		"kirillcha chegara":  {strings.Repeat("ў", catNameMax), "", strings.Repeat("ў", catNameMax)},
		"kirillcha ortiqcha": {strings.Repeat("ў", catNameMax+1), "name_too_long", ""},
	} {
		got, err := categoryName(tc.kirish)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if got != tc.natija {
			t.Errorf("%s: nom %q, kutilgan %q", nom, got, tc.natija)
		}
	}
}

// Kirillcha nom rune bo'yicha chegarada o'tishi kerak — bayt bo'yicha
// hisoblanganda 60 harfli o'zbekcha-kirillcha nom noto'g'ri rad etilardi.
func TestCategoryNameRuneBoyichaOlchanadi(t *testing.T) {
	nom := strings.Repeat("ў", catNameMax)
	if len(nom) <= catNameMax {
		t.Fatalf("test o'zi buzuq: %d bayt", len(nom))
	}
	if _, err := categoryName(nom); err != nil {
		t.Errorf("%d runeli nom rad etildi: %v", catNameMax, kod(err))
	}
}

func TestCategorySlug(t *testing.T) {
	for nom, tc := range map[string]struct {
		slug   string
		name   string
		kutgan string
		natija string
	}{
		"berilgan slug normallashadi": {"Yuk Tashish", "", "", "yuk-tashish"},
		"bo'sh slug nomdan yasaladi":  {"", "Yuk tashish", "", "yuk-tashish"},
		"chetlaridagi chiziq ketadi":  {"--maxsus--", "", "", "maxsus"},
		"lotin harflari yo'q":         {"", "Тозалаш", "bad_slug", ""},
		"ikkisi ham bo'sh":            {"", "", "bad_slug", ""},
		"faqat belgilar":              {"!!! ???", "", "bad_slug", ""},
		"aynan chegarada":             {strings.Repeat("a", catSlugMax), "", "", strings.Repeat("a", catSlugMax)},
		"bir belgi ortiq":             {strings.Repeat("a", catSlugMax+1), "", "slug_too_long", ""},
		"uzun nomdan yasalgani ham":   {"", strings.Repeat("a", catSlugMax+1), "slug_too_long", ""},
	} {
		got, err := categorySlug(tc.slug, tc.name)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if got != tc.natija {
			t.Errorf("%s: slug %q, kutilgan %q", nom, got, tc.natija)
		}
	}
}

// Ikonka — <img src> ga tushadigan qiymat. Faqat http(s) o'tishi shart:
// `javascript:` yoki `data:` havolasi panelda bajariladigan kontentga
// aylanardi.
func TestCategoryIconURL(t *testing.T) {
	yoq := ""
	bosh := "   "
	yaxshi := "  https://api.iconify.design/lucide/truck.svg  "
	uzun := "https://x.uz/" + strings.Repeat("a", catIconMax)
	for nom, tc := range map[string]struct {
		kirish *string
		kutgan string
		natija string
	}{
		"nil":         {nil, "icon_required", ""},
		"bo'sh satr":  {&yoq, "icon_required", ""},
		"bo'sh joy":   {&bosh, "icon_required", ""},
		"to'g'ri URL": {&yaxshi, "", "https://api.iconify.design/lucide/truck.svg"},
		"juda uzun":   {&uzun, "icon_too_long", ""},
	} {
		got, err := categoryIconURL(tc.kirish)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if got != tc.natija {
			t.Errorf("%s: ikonka %q, kutilgan %q", nom, got, tc.natija)
		}
	}

	for _, xavfli := range []string{
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		"file:///etc/passwd",
		"/uploads/icon.png",
		"//evil.example/icon.png",
		"ftp://example.com/i.png",
	} {
		v := xavfli
		if _, err := categoryIconURL(&v); kod(err) != "bad_icon_url" {
			t.Errorf("%q qabul qilindi (kod %q), kutilgan bad_icon_url", xavfli, kod(err))
		}
	}
}

// Proyeksiya bilan javob strukturasi bir-biriga qulflanadi.
//
// Asosiy maqsad — `createdBy`: turkumlar ro'yxatini har qanday admin
// (support ham) o'qiydi, xodimning ichki ID'si esa Figma 3.7 jadvalida
// chizilmagan. Kelajakda kimdir adminCategoryRow ga maydon qo'shsa yoki
// proyeksiyadan olib tashlasa, shu test darhol yoriladi.
func TestCatRowProjectionRowBilanBirXil(t *testing.T) {
	tur := reflect.TypeOf(adminCategoryRow{})
	strukturada := map[string]bool{}
	for i := 0; i < tur.NumField(); i++ {
		tag := tur.Field(i).Tag.Get("bson")
		if tag == "" || tag == "-" || tag == "_id" {
			continue // `_id` proyeksiyada har doim bor, uni yozish shart emas
		}
		strukturada[strings.Split(tag, ",")[0]] = true
	}
	for maydon := range strukturada {
		if _, ok := catRowProjection[maydon]; !ok {
			t.Errorf("adminCategoryRow.%s proyeksiyada yo'q — javobda bo'sh keladi", maydon)
		}
	}
	for maydon := range catRowProjection {
		if !strukturada[maydon] {
			t.Errorf("catRowProjection[%q] o'qiladi, lekin adminCategoryRow da yo'q", maydon)
		}
	}
	if _, ok := catRowProjection["createdBy"]; ok {
		t.Error("createdBy proyeksiyaga qaytib kelgan — xodim ID'si javobga oqib ketadi")
	}
}

// Audit izohi holatni ayta olishi kerak: «category_active» kodining o'zi
// yoqilganmi yoki o'chirilganmi ko'rsatmaydi.
func TestActiveLabel(t *testing.T) {
	if activeLabel(true) != "faol" || activeLabel(false) != "nofaol" {
		t.Errorf("activeLabel: %q / %q", activeLabel(true), activeLabel(false))
	}
}
