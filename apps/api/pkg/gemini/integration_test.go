package gemini

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
	"time"
)

// Integration test — HAQIQIY Gemini API'ga chiqadi va kvota sarflaydi.
//
// Ataylab o'chirilgan: `go test ./...` uni o'tkazib yuboradi, ya'ni CI va
// oddiy ishlash tarmoqqa bog'liq bo'lmaydi. Yoqish uchun:
//
//	GEMINI_INTEGRATION_TEST=1 GEMINI_API_KEY=<kalit> go test ./pkg/gemini/ -run Integration -v
//
// Kalit .env dan avtomatik o'qilmaydi — buni ataylab qo'lda berish kerak.
func requireLive(t *testing.T) *Client {
	t.Helper()
	if os.Getenv("GEMINI_INTEGRATION_TEST") == "" {
		t.Skip("GEMINI_INTEGRATION_TEST o'rnatilmagan — jonli test o'tkazib yuborildi")
	}
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		t.Skip("GEMINI_API_KEY berilmagan")
	}
	return New(key, "", os.Getenv("GEMINI_MODEL"), 30*time.Second)
}

func TestIntegrationLiveText(t *testing.T) {
	c := requireLive(t)
	ctx := context.Background()

	safe, err := c.Classify(ctx, Input{Text: "Ofis tozalash uchun 2 nafar ishchi kerak. Kunlik 150000 so'm."})
	if err != nil {
		t.Fatalf("toza matn: %v", err)
	}
	t.Logf("toza matn ratings: %v blockReason=%q", safe.Ratings, safe.BlockReason)
	if ProbAtLeast(safe.Ratings["HARM_CATEGORY_SEXUALLY_EXPLICIT"], ProbMedium) {
		t.Errorf("oddiy e'lon seksual deb belgilandi: %v", safe.Ratings)
	}

	bad, err := c.Classify(ctx, Input{Text: "Escort service wanted, explicit sexual acts for money, must perform on camera."})
	if err != nil {
		t.Fatalf("nomaqbul matn: %v", err)
	}
	t.Logf("nomaqbul matn ratings: %v blockReason=%q", bad.Ratings, bad.BlockReason)
	if bad.BlockReason == "" && !ProbAtLeast(bad.Ratings["HARM_CATEGORY_SEXUALLY_EXPLICIT"], ProbMedium) {
		t.Errorf("seksual matn aniqlanmadi: %v", bad.Ratings)
	}
}

func TestIntegrationLiveImage(t *testing.T) {
	c := requireLive(t)

	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for x := 0; x < 64; x++ {
		for y := 0; y < 64; y++ {
			img.Set(x, y, color.RGBA{R: 60, G: 140, B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png: %v", err)
	}

	v, err := c.Classify(context.Background(), Input{ImageMIME: "image/png", Image: buf.Bytes()})
	if err != nil {
		t.Fatalf("rasm: %v", err)
	}
	t.Logf("xavfsiz rasm ratings: %v blockReason=%q", v.Ratings, v.BlockReason)
	if v.BlockReason != "" {
		t.Errorf("oddiy ko'k kvadrat bloklandi: %q", v.BlockReason)
	}
	if len(v.Ratings) == 0 {
		t.Error("Ratings bo'sh — rasm baholanmadi")
	}
}
