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
// tushganda ular faol holatda upsert qilinadi. Admin yaratgan boshqa turkumlar
// ataylab o'zgartirilmaydi: aks holda har deploy ularni nofaol qilib qo'yardi.
//
// "Maxsus" — malaka talab qiladigan aralash ishlar: santexnika, elektrik,
// ustachilik va shunga o'xshash.
var Defaults = []DefaultCategory{
	{Name: "Tozalash", Slug: "tozalash", Icon: "https://api.iconify.design/lucide/spray-can.svg?color=%230038d8"},
	{Name: "Yuk tashish", Slug: "yuk-tashish", Icon: "https://api.iconify.design/lucide/truck.svg?color=%230038d8"},
	{Name: "Maxsus", Slug: "maxsus", Icon: "https://api.iconify.design/lucide/wrench.svg?color=%230038d8"},
}

// EnsureDefaults DB'dagi turkumlarni Defaults ro'yxatiga moslashtiradi.
// Buzmaydigan (non-destructive) usul: eski turkumlar o'chirilmaydi, faqat
// nofaol qilinadi — shu bois ular arizalar/e'lonlarga zarar bermay, ro'yxatdan
// (List faqat isActive=true qaytaradi) va qidiruv/e'lon berish bo'limlaridan
// yo'qoladi. Har startup'da chaqirilgani uchun idempotent bo'lishi shart.
func EnsureDefaults(ctx context.Context, db *mongo.Database) error {
	col := db.Collection("categories")

	for _, d := range Defaults {
		_, err := col.UpdateOne(ctx,
			bson.M{"slug": d.Slug},
			bson.M{
				"$set": bson.M{
					"name":            d.Name,
					"icon":            d.Icon,
					"isSystemDefault": true,
					"isActive":        true,
				},
				"$setOnInsert": bson.M{
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
