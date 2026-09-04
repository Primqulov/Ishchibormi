package errlog

import (
	"bytes"
	"fmt"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/ishchibormi/backend/pkg/httpx"
)

// peekMax — javob tanasidan nusxa olinadigan eng ko'p bayt. Bizga faqat
// `{"error":{"code":"…"` bo'lagi kerak; qolgani (masalan CSV eksport oqimi)
// xotiraga ko'chirilmaydi.
const peekMax = 256

// capture — javob statusini va tananing boshini ushlab qoladigan o'ram.
type capture struct {
	http.ResponseWriter
	status int
	peek   bytes.Buffer
}

func (c *capture) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
	c.ResponseWriter.WriteHeader(code)
}

func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	if c.status >= 500 && c.peek.Len() < peekMax {
		n := peekMax - c.peek.Len()
		if n > len(b) {
			n = len(b)
		}
		c.peek.Write(b[:n])
	}
	return c.ResponseWriter.Write(b)
}

// Flush — ba'zi javoblar (eksport oqimi) uni ishlatadi; o'ram uni
// yashirib qo'ymasligi kerak.
func (c *capture) Flush() {
	if f, ok := c.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Middleware — 5xx javoblarni jurnalga yozadi.
//
// # NEGA FAQAT 5xx
//
// Figma 3.12.2 · G ning birinchi qoidasi: foydalanuvchi xatosi bu yerga
// tushmaydi. 4xx — aynan shu: 400 "telefon noto'g'ri", 401 "token eskirgan",
// 403 "ruxsat yo'q", 404 "topilmadi" — bularning hammasi dastur TO'G'RI
// ishlaganining belgisi. Ularni yozsak, sahifa kuniga o'n minglab
// "foydalanuvchi parolni xato terdi" qatori bilan to'lib, undagi bitta
// haqiqiy `db_unavailable` ko'rinmay qolardi.
//
// Panic bu yerdan o'tmaydi: u tashqaridagi httpx.Recover'da ushlanadi va
// PanicHook orqali yoziladi (Hook). Shu sababli ikki marta yozilmaydi.
func (r *Recorder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		c := &capture{ResponseWriter: w}
		start := time.Now()
		next.ServeHTTP(c, req)
		if c.status < 500 {
			return
		}
		r.Record(Event{
			Code:    codeFromBody(c.peek.Bytes()),
			Where:   req.Method + " " + Path(req.URL.Path),
			Message: messageFromBody(c.peek.Bytes()),
			Method:  req.Method,
			Path:    req.URL.Path,
			Status:  c.status,
			UserID:  actorID(req),
			IsAdmin: httpx.AdminID(req) != "",
			// Davomiylik — batafsil ko'rinishdagi "So'rov ma'lumotlari"
			// blokining eng foydali qatori: 4 800 ms lik 500 javob va
			// darhol qaytgan 500 javob butunlay boshqa nosozliklar.
			DurationMs: int(time.Since(start).Milliseconds()),
			RequestID:  middleware.GetReqID(req.Context()),
			Platform:   req.Header.Get("X-Client-Platform"),
			Device:     ParseDevice(req),
			Origin:     OriginServer,
		})
	})
}

// Hook — httpx.PanicHook uchun moslama.
func (r *Recorder) Hook(req *http.Request, rec any, stack []byte) {
	r.Record(Event{
		Code:    "panic",
		Where:   panicSite(stack),
		Message: "panic: " + Clip(sprint(rec), 200),
		Method:  req.Method,
		Path:    req.URL.Path,
		Status:  http.StatusInternalServerError,
		UserID:  actorID(req),
		IsAdmin: httpx.AdminID(req) != "",
		// Server panic'ining steki — loyihaning O'Z fayllari bilan
		// cheklangan. Butun stek saqlanmaydi: u kilobaytlab joy egallaydi
		// va ichida so'rov qiymatlari uchrashi mumkin (scrub.go).
		Stack:     projectFrames(stack),
		RequestID: middleware.GetReqID(req.Context()),
		Platform:  req.Header.Get("X-Client-Platform"),
		Device:    ParseDevice(req),
		Origin:    OriginServer,
	})
}

// projectFrames — stek izidan faqat SHU loyihaning kadrlarini oladi.
// Go va kutubxona kadrlari tashlanadi: ular har bir panic'da bir xil va
// diagnostikaga hech narsa qo'shmaydi, hajmni esa o'nlab marta oshiradi.
func projectFrames(stack []byte) []string {
	var out []string
	for _, ln := range strings.Split(string(stack), "\n") {
		ln = strings.TrimSpace(ln)
		i := strings.Index(ln, "ishchibormi/backend/")
		if i < 0 {
			continue
		}
		ln = ln[i+len("ishchibormi/backend/"):]
		if j := strings.Index(ln, " "); j > 0 {
			ln = ln[:j]
		}
		if !strings.Contains(ln, ".go:") {
			continue
		}
		out = append(out, "#"+itoa(int64(len(out)))+" "+ln)
		if len(out) >= maxStackLines {
			break
		}
	}
	return out
}

// BackgroundPanic — fon goroutine'lari uchun (`go func(){ defer
// errlog.BackgroundPanic(rec, "broadcast.send") }`). HTTP panic'dan farqli
// o'laroq buni hech kim ushlamaydi: u butun jarayonni o'ldiradi, shuning
// uchun katalogda ham alohida va Kritik.
func (r *Recorder) BackgroundPanic(rec any, where string) {
	r.Record(Event{
		Code:    "background_panic",
		Where:   where,
		Message: "panic: " + Clip(sprint(rec), 200) + " · " + panicSite(debug.Stack()),
		Origin:  OriginServer,
	})
}

// codeFromBody — javob tanasidagi `{"error":{"code":"…"}}` dan kodni oladi.
// Katalogda bo'lmasa `internal`: begona satr guruh kaliti bo'lib
// qololmaydi (aks holda handler ixtiyoriy matn yozib, jurnalda cheksiz
// ko'p guruh yasay olardi).
func codeFromBody(b []byte) string {
	if c := jsonField(b, `"code":`); c != "" {
		if _, ok := Catalog[c]; ok {
			return c
		}
	}
	return "internal"
}

// messageFromBody — xabar. Handler yozgan matn bo'lgani uchun Text() dan
// o'tkaziladi (recorder buni yana bir bor takrorlaydi — zarari yo'q).
func messageFromBody(b []byte) string {
	return Text(jsonField(b, `"message":`))
}

// jsonField — kichik, ajratmasiz izlovchi. To'liq JSON parser emas:
// bizda faqat javobning birinchi 256 bayti bor va u kesilgan bo'lishi
// mumkin, ya'ni har qanday parser xato qaytarardi.
func jsonField(b []byte, key string) string {
	i := bytes.Index(b, []byte(key))
	if i < 0 {
		return ""
	}
	rest := b[i+len(key):]
	j := bytes.IndexByte(rest, '"')
	if j < 0 {
		return ""
	}
	rest = rest[j+1:]
	k := bytes.IndexByte(rest, '"')
	if k < 0 {
		return string(rest)
	}
	return string(rest[:k])
}

// panicSite — stek izidan loyihaning O'Z faylini topadi. Butun stekni
// saqlamaymiz: u kilobaytlab joy egallaydi va ichida so'rov qiymatlari
// uchrashi mumkin. Fayl + qator fingerprint uchun yetarli
// (Figma · G: "bir xil kod + fayl + qator").
func panicSite(stack []byte) string {
	for _, ln := range strings.Split(string(stack), "\n") {
		ln = strings.TrimSpace(ln)
		if !strings.Contains(ln, "ishchibormi/backend/") {
			continue
		}
		if i := strings.Index(ln, "ishchibormi/backend/"); i >= 0 {
			ln = ln[i+len("ishchibormi/backend/"):]
		}
		// "internal/admin/users.go:120 +0x1a4" → "internal/admin/users.go:120"
		if i := strings.Index(ln, " "); i > 0 {
			ln = ln[:i]
		}
		if strings.Contains(ln, ".go:") && !strings.Contains(ln, "pkg/httpx/middleware.go") {
			return Clip(ln, MaxWhere)
		}
	}
	return "noma'lum"
}

// actorID — so'rov egasining ID'si (foydalanuvchi yoki admin). Xom holda
// hech qayerga saqlanmaydi: recorder uni tuzlangan hash'ga aylantiradi.
//
// Avval quti (httpx.Actor) — u tashqi middleware'dan ham ko'rinadi; keyin
// odatdagi kontekst qiymatlari, agar chaqiruv auth'dan KEYIN bo'lsa.
func actorID(r *http.Request) string {
	if id := httpx.Actor(r); id != "" {
		return id
	}
	if id := httpx.UserID(r); id != "" {
		return id
	}
	return httpx.AdminID(r)
}

func sprint(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case error:
		return t.Error()
	default:
		return fmt.Sprintf("%v", t)
	}
}
