package db

import (
	"context"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// BackfillElonOwnerAvatars — mavjud e'lonlarga `ownerAvatarUrl` maydonini
// egasining (user) joriy avataridan to'ldiradi. Yangi e'lonlar bu maydonni
// yaratilishda oladi; bu funksiya esa eski e'lonlar uchun bir martalik.
//
// Bir martalik migratsiya sifatida ro'yxatga olingan (migrations.go) — muvaffaqiyatdan
// keyin schema_migrations' da qayd etilib, boshqa boot'larda ishga tushmaydi.
// O'zi ham idempotent: faqat maydoni hali mavjud bo'lmagan e'lonlarga ta'sir
// qiladi ($exists:false), shuning uchun qayta ishga tushsa ham xavfsiz.
func BackfillElonOwnerAvatars(ctx context.Context, db *mongo.Database) error {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"ownerAvatarUrl": bson.M{"$exists": false}}}},
		{{Key: "$lookup", Value: bson.M{
			"from":         "users",
			"localField":   "ownerId",
			"foreignField": "_id",
			"as":           "_owner",
		}}},
		{{Key: "$set", Value: bson.M{
			"ownerAvatarUrl": bson.M{"$ifNull": bson.A{
				bson.M{"$arrayElemAt": bson.A{"$_owner.avatarUrl", 0}}, "",
			}},
		}}},
		{{Key: "$unset", Value: "_owner"}},
		{{Key: "$merge", Value: bson.M{
			"into":           "elons",
			"whenMatched":    "merge",
			"whenNotMatched": "discard",
		}}},
	}
	cur, err := db.Collection("elons").Aggregate(ctx, pipeline)
	if err != nil {
		return err
	}
	return cur.Close(ctx)
}
