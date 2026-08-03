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

// Defaults — platformaning YAGONA rasmiy turkumlari. Ilova har ishga tushganda
// (deploy'da ham) DB shu ro'yxatga moslashtiriladi:
//   - bu 3 turkum faol (isActive=true) qilib upsert qilinadi,
//   - ro'yxatda bo'lmagan boshqa har qanday eski turkum nofaol qilinadi.
//
// "Maxsus" — malaka talab qiladigan aralash ishlar: santexnika, elektrik,
// ustachilik va shunga o'xshash.
var Defaults = []DefaultCategory{
	{Name: "Tozalash", Slug: "tozalash", Icon: "🧹"},
	{Name: "Yuk tashish", Slug: "yuk-tashish", Icon: "🚚"},
	{Name: "Maxsus", Slug: "maxsus", Icon: "🔧"},
}

// EnsureDefaults DB'dagi turkumlarni Defaults ro'yxatiga moslashtiradi.
// Buzmaydigan (non-destructive) usul: eski turkumlar o'chirilmaydi, faqat
// nofaol qilinadi — shu bois ular arizalar/e'lonlarga zarar bermay, ro'yxatdan
// (List faqat isActive=true qaytaradi) va qidiruv/e'lon berish bo'limlaridan
// yo'qoladi. Har startup'da chaqirilgani uchun idempotent bo'lishi shart.
func EnsureDefaults(ctx context.Context, db *mongo.Database) error {
	col := db.Collection("categories")

	slugs := make([]string, 0, len(Defaults))
	for _, d := range Defaults {
		slugs = append(slugs, d.Slug)
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

	// Kanonik ro'yxatda bo'lmagan turkumlarni nofaol qilamiz.
	_, err := col.UpdateMany(ctx,
		bson.M{"slug": bson.M{"$nin": slugs}},
		bson.M{"$set": bson.M{"isActive": false}},
	)
	return err
}
