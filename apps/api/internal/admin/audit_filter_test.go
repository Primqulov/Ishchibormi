package admin

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Amal kodi filtri tashqaridan keladi. Haqiqiy kodlar o'tishi, boshqa hamma
// narsa — bo'sh joy, `$` operatorlari, uzun satrlar — rad etilishi kerak.
func TestActionCodeRe(t *testing.T) {
	ok := []string{
		"login_success", "login_failed", "login_throttled", "logout",
		"session_idle_expired", "2fa_enable", "2fa_disable", "2fa_throttled",
		"category_icon_upload", "user_unblock", "moderation_ban_lift",
		"export_applications",
		"avatar.download", "avatar.delete",
	}
	for _, v := range ok {
		if !actionCodeRe.MatchString(v) {
			t.Errorf("haqiqiy amal kodi rad etildi: %q", v)
		}
	}

	bad := []string{
		"",                        // bo'sh — chaqiruvchi filtrsiz so'ramoqchi
		"login success",           // bo'sh joy
		"$ne",                     // operatorga o'xshash
		"{\"$gt\":\"\"}",          // JSON hujjat
		"Login_Success",           // katta harf
		"login-success",           // chiziqcha
		"login_success\n",         // yangi qator
		"../../etc/passwd",        // yo'l
		strings.Repeat("a", 65),   // chegaradan uzun
		strings.Repeat("a", 1024), // ochiqdan-ochiq axlat
	}
	for _, v := range bad {
		if actionCodeRe.MatchString(v) {
			t.Errorf("noto'g'ri qiymat qabul qilindi: %q", v)
		}
	}
}

// Frontend nishonlarni (badge) o'z katalogidan chizadi. Katalog backend
// yozadigan kodlarning HAMMASINI qamrashi shart: qamralmagan kod ekranda
// "noma'lum amal" bo'lib chiqadi va — muhimi — filtr ro'yxatida umuman
// ko'rinmaydi, ya'ni `login_throttled` kabi hujum signalini tanlab bo'lmaydi.
// Shu sababli bu test manba kodidagi h.audit/h.auditRaw chaqiruvlaridan
// kodlarni yig'ib, ularni sahifaning katalogi bilan solishtiradi.
func TestAuditActionCatalogCoversEveryWrittenAction(t *testing.T) {
	written := map[string]bool{}
	callRe := regexp.MustCompile(`h\.audit(?:Raw)?\((?:[^,]+,){1,2}\s*"([a-z0-9_]+)"`)

	err := filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") ||
			strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range callRe.FindAllStringSubmatch(string(src), -1) {
			written[m[1]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(written) < 20 {
		t.Fatalf("manbadan atigi %d ta amal kodi topildi — regexp buzilgan ko'rinadi", len(written))
	}

	page := filepath.Join("..", "..", "..", "web", "app", "admin", "audit", "page.tsx")
	src, err := os.ReadFile(page)
	if err != nil {
		t.Skipf("audit sahifasi o'qilmadi (%v) — Go paketi yolg'iz tekshirilmoqda", err)
	}
	catalog := string(src)
	for code := range written {
		// Katalog kalitlari: `login_success: {` yoki `"2fa_enable": {`.
		if !strings.Contains(catalog, code+":") && !strings.Contains(catalog, `"`+code+`"`) {
			t.Errorf("audit sahifasi katalogida %q yo'q — filtrda tanlab bo'lmaydi", code)
		}
	}
}
