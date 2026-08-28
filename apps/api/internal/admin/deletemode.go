package admin

import (
	"net/http"
	"strings"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
)

// Admin panelidagi o'chirish IKKI XIL bo'ladi va farqi tub.
//
// # NEGA IKKITA KERAK BO'LDI
//
// Ilgari bitta usul bor edi: yozuv `isDeleted` bilan belgilanardi va shu
// zahoti HAMMA joydan g'oyib bo'lardi — foydalanuvchilardan ham, admin
// panelining o'zidan ham (usersFilter/elonsFilter uni chiqarib tashlardi).
// Bazada esa qolaverardi.
//
// Uchta muammo kelib chiqardi:
//
//   - Admin nima o'chirganini keyin ko'ra olmasdi. Shikoyat kelsa yoki
//     xato o'chirilgan bo'lsa, tekshirish uchun hech narsa yo'q edi.
//   - "Bazadan ham o'chdimi?" degan savolga javob yo'q edi. Aslida yo'q —
//     lekin panelda ham ko'rinmagani uchun o'chgandek tuyulardi.
//   - Haqiqatan o'chirish uchun 90 kunlik retention oynasini kutish kerak
//     edi. Noqonuniy kontent uchun bu juda uzoq.
//
// # IKKI REJIM
//
//	hidden — foydalanuvchilardan butunlay yashiriladi: feed, ochiq profil,
//	         qidiruv, e'lon sahifasi — hech qayerda ko'rinmaydi. ADMIN
//	         PANELIDA esa ko'rinib turadi va bazada "o'chirilgan" belgisi
//	         bilan saqlanadi.
//	purge  — bazadan butunlay o'chiriladi. Adminga ham ko'rinmaydi, hech
//	         qayerda hech narsa qolmaydi. Fayllar ham o'chadi.
//
// # QAYTARIB BO'LMAYDI — ikkalasi ham
//
// `hidden` uchun ham "tiklash" tugmasi ATAYLAB yo'q va qo'shilmasligi kerak.
// Foydalanuvchi ma'lumoti bir marta ommadan olib tashlangach, uni keyinroq
// admin qarori bilan qaytadan ommaga chiqarish — o'sha odam kutmagan va
// roziligini bermagan narsa.
//
// Bu kodda ham ta'minlangan: `isDeleted` ni false ga qaytaradigan yo'l
// umuman yo'q. Hatto o'chirilgan raqam bilan qayta ro'yxatdan o'tilsa ham
// eski hujjat tiklanmaydi — auth.upsertUser filtrida `isDeleted: {$ne: true}`
// turibdi va upsert YANGI hujjat yaratadi.
const (
	deleteModeHidden = "hidden"
	deleteModePurge  = "purge"
)

// roleSuperadmin — httpx.RequireRole() bo'sh chaqirilganda faqat shu rol
// o'tadi; bu yerda esa tekshiruv handler ichida bo'lgani uchun nom kerak.
const roleSuperadmin = "superadmin"

// deleteMode — `?mode=` parametrini o'qiydi va ruxsatni tekshiradi.
//
// Standart qiymat ATAYLAB `hidden`: parametrsiz kelgan eski chaqiruv (yoki
// yangilanmagan klient) hech qachon ma'lumotni butunlay o'chirib yubormasin.
// Xavfsiz tomon — sukut bo'yicha tanlanadigan tomon.
func deleteMode(r *http.Request) (string, error) {
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mode"))) {
	case "", deleteModeHidden:
		return deleteModeHidden, nil

	case deleteModePurge:
		// FAQAT SUPERADMIN.
		//
		// O'chirish route'lari moderator guruhida turadi (cmd/api/main.go),
		// ya'ni moderator ham shu handlerga yetib keladi. Shuning uchun
		// tekshiruv route darajasida emas, aynan shu yerda: bitta yo'l ikki
		// xil vakolat talab qiladi.
		if httpx.AdminRole(r) != roleSuperadmin {
			return "", httpx.NewError(http.StatusForbidden, "forbidden",
				"only a superadmin can erase data from the database")
		}
		return deleteModePurge, nil

	default:
		return "", httpx.NewError(http.StatusBadRequest, "bad_mode",
			"mode must be 'hidden' or 'purge'")
	}
}

// applyDeletedFilter — admin ro'yxatlariga `?deleted=` shartini qo'yadi.
//
// Standart holat (parametr berilmagan): o'chirilganlar ham KO'RSATILADI.
// Aynan shu "hidden" rejimining ma'nosi — ma'lumot foydalanuvchilardan
// ketadi, lekin admin uni ko'rib turadi. Ilgari bu yerda qat'iy
// `{"isDeleted": {"$ne": true}}` turardi va aynan shu sabab o'chirilgan
// yozuv admin panelidan ham g'oyib bo'lardi.
//
//	deleted=hide — faqat faollari
//	deleted=only — faqat o'chirilganlari
func applyDeletedFilter(filter bson.M, q string) {
	switch strings.ToLower(strings.TrimSpace(q)) {
	case "only":
		filter["isDeleted"] = true
	case "hide":
		filter["isDeleted"] = bson.M{"$ne": true}
	}
}
