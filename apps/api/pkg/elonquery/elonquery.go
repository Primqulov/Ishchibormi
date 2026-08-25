// Package elonquery — e'lon hozir "faol" (ya'ni ommaviy ro'yxatlarda
// ko'rinadigan) ekanini aniqlaydigan umumiy MongoDB filtri.
//
// Bu mantiq ilgari faqat `internal/elon` ichida edi, shu sabab kategoriya
// sanoqlari undan foydalana olmasdi: `elon` paketi `category` paketini import
// qiladi, teskarisi import halqasini hosil qilardi. Filtr shu yerga
// ko'chirildi — feed, sitemap, xarita va kategoriya sanoqlari bitta manbadan
// o'qiydi va hech qachon bir-biridan farq qilmaydi.
package elonquery

import (
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

// FeedExpiryGrace — e'lon belgilangan boshlanish vaqtidan shuncha o'tgach
// ommaviy feeddan chiqib ketadi (ish odatda shu oraliqda boshlanib bo'ladi).
const FeedExpiryGrace = 6 * time.Hour

// OpenStatus — ommaviy ro'yxatlarda ko'rinadigan yagona holat. Ish o'rinlari
// to'lgan (filled), bajarilgan yoki bekor qilingan e'lonlar chiqmaydi.
const OpenStatus = "recruiting"

// ActiveFilter — hozir ishchilarga ko'rinib turgan e'lonlar filtri:
// o'chirilmagan, egasi bloklanmagan, hali `recruiting` va vaqti o'tmagan.
//
// includeReviewData=true bo'lsa Google Play demo hisobining e'lonlari ham
// qo'shiladi (reviewer o'z e'lonini feedda ko'rishi kerak); aks holda ular
// chiqarib tashlanadi.
func ActiveFilter(now time.Time, includeReviewData bool) bson.M {
	f := bson.M{
		"isDeleted":    bson.M{"$ne": true},
		"ownerBlocked": bson.M{"$ne": true},
		"status":       OpenStatus,
		// Vaqti o'tgan e'lonlar yashiriladi: belgilangan boshlanish vaqtidan
		// (kun + soat) FeedExpiryGrace dan ko'p o'tgan bo'lsa — ko'rinmaydi
		// (kechagi/eski e'lonlar va bugun bo'lib o'tganlari ham).
		"$expr": NotExpiredExpr(now, FeedExpiryGrace),
	}
	if !includeReviewData {
		// $ne true — maydon umuman yo'q bo'lgan (ya'ni barcha real) yozuvlarni
		// ham qamrab oladi.
		f["isReviewData"] = bson.M{"$ne": true}
	}
	return f
}

// NotExpiredExpr — e'lonni faqat boshlanish vaqti `grace` dan ko'p o'tmagan
// bo'lsa qoldiradigan MongoDB `$expr` qaytaradi.
//
// `startDate` har xil klientlarda har xil saqlanadi: to'liq ISO sana-vaqt
// (Flutter ilovasi) yoki faqat sana (web/seed). Shuning uchun kun startDate dan,
// soat esa — startDate ichidan (to'liq bo'lsa), bo'lmasa workTimeFrom dan,
// u ham bo'lmasa kun oxiri (23:59) deb olinadi. Naive (mintaqasiz) vaqtlar
// Asia/Tashkent bo'yicha talqin qilinadi. Bo'sh yoki noto'g'ri sanalar uzoq
// kelajak deb hisoblanadi — eski e'lonlar tasodifan yo'qolib qolmasligi uchun.
func NotExpiredExpr(now time.Time, grace time.Duration) bson.M {
	startStr := bson.M{"$ifNull": bson.A{"$startDate", ""}}
	workFrom := bson.M{"$ifNull": bson.A{"$workTimeFrom", ""}}
	datePart := bson.M{"$substrBytes": bson.A{startStr, 0, 10}}
	timePart := bson.M{"$cond": bson.A{
		// startDate to'liq sana-vaqt bo'lsa ("...T14:30...") — soatni shundan olamiz.
		bson.M{"$gt": bson.A{bson.M{"$strLenBytes": startStr}, 10}},
		bson.M{"$substrBytes": bson.A{startStr, 11, 5}},
		// aks holda workTimeFrom, u ham bo'lmasa — kun oxiri.
		bson.M{"$cond": bson.A{
			bson.M{"$gt": bson.A{bson.M{"$strLenBytes": workFrom}, 0}},
			workFrom,
			"23:59",
		}},
	}}
	farFuture := now.AddDate(100, 0, 0)
	startInstant := bson.M{"$dateFromString": bson.M{
		"dateString": bson.M{"$concat": bson.A{datePart, "T", timePart}},
		"format":     "%Y-%m-%dT%H:%M",
		"timezone":   "Asia/Tashkent",
		"onError":    farFuture,
		"onNull":     farFuture,
	}}
	return bson.M{"$gte": bson.A{startInstant, now.Add(-grace)}}
}
