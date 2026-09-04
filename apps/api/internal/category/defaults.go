package category

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// DefaultCategory — platformada mavjud bo'ladigan turkum.
type DefaultCategory struct {
	Name string
	Slug string
	Icon string
}

// Defaults — platformaning boshlang'ich rasmiy turkumlari. Ilova har ishga
// tushganda ular BORLIGI tekshiriladi (yo'q bo'lsa — faol holatda
// yaratiladi); mavjudlarining nomi, ikonkasi va holati tegilmaydi —
// EnsureDefaults izohiga qarang. Admin yaratgan turkumlar bu ro'yxatga
// umuman kirmaydi.
//
// "Maxsus" — malaka talab qiladigan aralash ishlar: santexnika, elektrik,
// ustachilik va shunga o'xshash.
var Defaults = []DefaultCategory{
	{Name: "Tozalash", Slug: "tozalash", Icon: "https://api.iconify.design/lucide/spray-can.svg?color=%230038d8"},
	{Name: "Yuk tashish", Slug: "yuk-tashish", Icon: "https://api.iconify.design/lucide/truck.svg?color=%230038d8"},
	{Name: "Maxsus", Slug: "maxsus", Icon: "https://api.iconify.design/lucide/wrench.svg?color=%230038d8"},
}

// EnsureDefaults rasmiy turkumlar bazada BORLIGINI kafolatlaydi. Buzmaydigan
// (non-destructive) usul: eski turkumlar o'chirilmaydi, admin yaratganlari
// esa umuman tegilmaydi. Har startup'da chaqilgani uchun idempotent.
//
// # NEGA NOM/IKONKA/HOLAT — $setOnInsert
//
// Admin panelida (Figma 3.7) superadmin tizim turkumini tahrirlashi va
// nishonni bosib NOFAOL qilishi mumkin — 3.7a shu amalni ataylab
// ko'rsatgan, o'chirish esa taqiqlangan («deactivate it instead»).
// Bu maydonlar `$set` da turganda har deploy nomni ham, ikonkani ham
// pastdagi ro'yxatga qaytarardi va nofaol qilingan turkumni qaytadan
// yoqardi: superadminning qarori jimgina bekor bo'lardi.
//
// Buning narxi bor va u ataylab qabul qilingan: bu yerdagi `Name`/`Icon`
// keyinchalik o'zgarsa, MAVJUD hujjatlar yangilanmaydi (faqat yangi
// bazalarga tushadi). Rasmiy turkumning nomini almashtirish deployda emas,
// panelda — audit jurnaliga yozilib — bajarilishi to'g'ri.
//
// `isSystemDefault` esa `$set` da qoladi: bu maydon paydo bo'lishidan oldin
// yaratilgan hujjatlar ham himoyalangan bo'lishi kerak.
func EnsureDefaults(ctx context.Context, db *mongo.Database) error {
	col := db.Collection("categories")

	for _, d := range Defaults {
		_, err := col.UpdateOne(ctx,
			bson.M{"slug": d.Slug},
			bson.M{
				"$set": bson.M{
					"isSystemDefault": true,
				},
				"$setOnInsert": bson.M{
					"name":       d.Name,
					"icon":       d.Icon,
					"isActive":   true,
					"usageCount": 0,
					"createdAt":  time.Now(),
				},
			},
			options.Update().SetUpsert(true),
		)
		if err != nil {
			return err
		}
	}
	return nil
}
