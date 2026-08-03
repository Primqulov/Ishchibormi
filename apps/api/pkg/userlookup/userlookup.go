// Package userlookup — foydalanuvchilarning joriy (jonli) ma'lumotlarini
// bitta so'rov bilan olish uchun yordamchi. Avatar kabi maydonlar e'lon/ariza
// hujjatlarida "snapshot" sifatida saqlangan bo'lsa-da, ro'yxatlarni qaytarishdan
// oldin shu paket orqali eng oxirgi qiymatga yangilanadi — shunda foydalanuvchi
// rasmini keyin o'zgartirsa ham hamma joyda darhol yangisi ko'rinadi.
package userlookup

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Avatars — berilgan user ID'lar uchun joriy avatarUrl'ni map bilan qaytaradi.
// N+1 so'rovsiz: bitta `$in` so'rovi ishlatiladi. Nol/takroriy ID'lar tashlab
// yuboriladi. Foydalanuvchi topilsa (rasmi bo'lmasa ham) map'da kalit bo'ladi —
// shu sabab chaqiruvchi `v, ok := m[id]` orqali "rasm o'chirilgan" holatni ham
// (bo'sh qiymat bilan ustiga yozib) to'g'ri aks ettira oladi.
func Avatars(ctx context.Context, users *mongo.Collection, ids []primitive.ObjectID) map[primitive.ObjectID]string {
	res := map[primitive.ObjectID]string{}
	uniq := make([]primitive.ObjectID, 0, len(ids))
	seen := map[primitive.ObjectID]bool{}
	for _, id := range ids {
		if id.IsZero() || seen[id] {
			continue
		}
		seen[id] = true
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return res
	}
	cur, err := users.Find(ctx, bson.M{"_id": bson.M{"$in": uniq}},
		options.Find().SetProjection(bson.M{"avatarUrl": 1}))
	if err != nil {
		return res
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var u struct {
			ID        primitive.ObjectID `bson:"_id"`
			AvatarURL string             `bson:"avatarUrl"`
		}
		if cur.Decode(&u) == nil {
			res[u.ID] = u.AvatarURL
		}
	}
	return res
}
