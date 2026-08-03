package upload

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"

	xdraw "golang.org/x/image/draw"
)

// JPEG qayta kodlashda sifat darajasi. 82 — ko'z bilan deyarli farqi sezilmaydi,
// lekin fayl hajmi telefon kamerasidan kelgan asl JPEG'ga nisbatan sezilarli
// kichrayadi.
const jpegQuality = 82

// compressImage decodes a JPEG/PNG image, downscales it so that its longest side
// is at most maxDim (aspect ratio saqlanadi, faqat kichraytiradi — kattalashtirmaydi;
// yuqori sifatli CatmullRom resampling), va SHU formatda qayta kodlaydi. Bu fayl
// hajmini ko'zga ko'rinmas sifat yo'qotishi bilan kamaytiradi.
//
// JPEG/PNG bo'lmagan turlar (masalan webp) o'zgarishsiz qaytariladi. Dekod/kod
// xatosida yoki natija kattaroq chiqsa — asl baytlar qaytariladi, shunda rasm
// yuklash siqish tufayli hech qachon buzilmaydi/yiqilmaydi.
func compressImage(data []byte, contentType string, maxDim int) []byte {
	switch contentType {
	case "image/jpeg", "image/png":
		// davom etamiz
	default:
		return data
	}

	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if maxDim > 0 && (w > maxDim || h > maxDim) {
		nw, nh := scaledSize(w, h, maxDim)
		dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)
		img = dst
	}

	var out bytes.Buffer
	switch format {
	case "jpeg":
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return data
		}
	case "png":
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		if err := enc.Encode(&out, img); err != nil {
			return data
		}
	default:
		return data
	}

	// Siqilgan versiya asldan kichik bo'lsagina uni ishlatamiz (juda kichik yoki
	// allaqachon optimallashgan rasmlar uchun re-encode kattaroq chiqishi mumkin).
	if out.Len() >= len(data) {
		return data
	}
	return out.Bytes()
}

// scaledSize uzun tomonni maxDim ga tushirib, nisbatni saqlagan yangi o'lchamni
// qaytaradi (kamida 1px).
func scaledSize(w, h, maxDim int) (int, int) {
	if w >= h {
		nh := int(float64(h) * float64(maxDim) / float64(w))
		if nh < 1 {
			nh = 1
		}
		return maxDim, nh
	}
	nw := int(float64(w) * float64(maxDim) / float64(h))
	if nw < 1 {
		nw = 1
	}
	return nw, maxDim
}
