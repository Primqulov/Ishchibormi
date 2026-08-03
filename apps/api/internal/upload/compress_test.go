package upload

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// gradient — siqiladigan realistik rasm (tekis o'tishlar).
func gradient(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), uint8((x + y) % 256), 255})
		}
	}
	return img
}

// noise — deterministik "shovqin" rasm (LCG). Yomon siqiladi, shuning uchun
// kichraytirish fayl hajmini aniq kamaytiradi (gradient bunga to'g'ri kelmaydi).
func noise(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var s uint32 = 0x12345678
	next := func() uint8 { s = s*1664525 + 1013904223; return uint8(s >> 24) }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{next(), next(), next(), 255})
		}
	}
	return img
}

func TestCompressImage_JPEGResizesAndShrinks(t *testing.T) {
	var in bytes.Buffer
	if err := jpeg.Encode(&in, gradient(3000, 2000), &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	out := compressImage(in.Bytes(), "image/jpeg", 1600)

	if len(out) >= in.Len() {
		t.Fatalf("kutilgan: kichraygan, olindi in=%d out=%d", in.Len(), len(out))
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("natijani dekod qilib bo'lmadi: %v", err)
	}
	// Uzun tomon (3000) 1600 ga tushishi, nisbat saqlanishi kerak (2000->~1066).
	if cfg.Width != 1600 {
		t.Fatalf("kutilgan kenglik 1600, olindi %d", cfg.Width)
	}
	if cfg.Height != 1066 {
		t.Fatalf("kutilgan balandlik ~1066, olindi %d", cfg.Height)
	}
}

func TestCompressImage_PNGResizes(t *testing.T) {
	var in bytes.Buffer
	if err := png.Encode(&in, noise(2400, 1200)); err != nil {
		t.Fatal(err)
	}
	out := compressImage(in.Bytes(), "image/png", 1600)
	if len(out) >= in.Len() {
		t.Fatalf("kutilgan: kichraygan, olindi in=%d out=%d", in.Len(), len(out))
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("natijani dekod qilib bo'lmadi: %v", err)
	}
	if format != "png" {
		t.Fatalf("format PNG bo'lib qolishi kerak, olindi %q", format)
	}
	if cfg.Width != 1600 {
		t.Fatalf("kutilgan kenglik 1600, olindi %d", cfg.Width)
	}
}

func TestCompressImage_SmallImageUntouchedOrSmaller(t *testing.T) {
	// maxDim'dan kichik rasm kattalashtirilmasligi kerak.
	var in bytes.Buffer
	if err := jpeg.Encode(&in, gradient(400, 300), &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	out := compressImage(in.Bytes(), "image/jpeg", 1600)
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 400 || cfg.Height != 300 {
		t.Fatalf("kichik rasm o'lchami o'zgarmasligi kerak, olindi %dx%d", cfg.Width, cfg.Height)
	}
}

func TestCompressImage_NonImagePassthrough(t *testing.T) {
	raw := []byte("RIFF....WEBPfake-bytes")
	out := compressImage(raw, "image/webp", 1600)
	if !bytes.Equal(out, raw) {
		t.Fatal("webp/boshqa turlar o'zgarishsiz qaytishi kerak")
	}
}
