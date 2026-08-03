// Command resetadmin superadmin hisobining ADMIN_SEED_USER/ADMIN_SEED_PASS
// (.env) bilan mavjudligini kafolatlaydi. To'liq `seed` buyrug'idan farqli
// o'laroq hech qanday demo ma'lumot qo'shmaydi — faqat bitta admin hujjatini
// upsert qiladi, shuning uchun production'da ishlatish xavfsiz.
//
// Qачон kerak: admin login "invalid credentials" bersa — chunki `admins`
// kolleksiyasida hisob yo'q (masalan Atlas'ga ko'chgandan keyin) yoki eski hash
// turibdi (seed InsertOne ishlatadi va mavjud adminni HECH QACHON yangilamaydi).
//
// Ishga tushirish (EC2 serverda, backend konteyneri ichida — u yerda .env dagi
// MONGO_URI/ADMIN_SEED_* env sifatida mavjud):
//
//	docker compose exec backend /app/resetadmin
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/pkg/db"
	"github.com/ishchibormi/backend/pkg/envfile"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	envfile.Load()
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	mdb, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo ulanmadi: %v", err)
	}
	admins := mdb.Collection("admins")

	// Diagnostika: hozir qanday adminlar borligini ko'rsatamiz, shunda sabab
	// aniq bo'ladi (hisob yo'qmi, username boshqami, yoki isActive=false).
	cur, err := admins.Find(ctx, bson.M{})
	if err != nil {
		log.Fatalf("adminlarni o'qib bo'lmadi: %v", err)
	}
	var existing []struct {
		Username string `bson:"username"`
		Role     string `bson:"role"`
		IsActive bool   `bson:"isActive"`
	}
	if err := cur.All(ctx, &existing); err != nil {
		log.Fatalf("adminlarni dekod qilib bo'lmadi: %v", err)
	}
	fmt.Printf("MONGO_DB=%s | mavjud adminlar soni=%d\n", cfg.MongoDB, len(existing))
	for _, a := range existing {
		fmt.Printf("  - username=%q role=%s isActive=%v\n", a.Username, a.Role, a.IsActive)
	}

	// Seed adminni yangi hash bilan upsert qilamiz (parolni qayta o'rnatamiz).
	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminSeedPass), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("parolni hash qilib bo'lmadi: %v", err)
	}
	res, err := admins.UpdateOne(ctx,
		bson.M{"username": cfg.AdminSeedUser},
		bson.M{
			"$set": bson.M{
				"passwordHash": string(hash),
				"role":         "superadmin",
				"isActive":     true,
				// 2FA'ni ham tiklaymiz: yagona superadmin autentifikator qurilmasini
				// yo'qotib qo'lda kirolmay qolsa, shu buyruq lockout'dan chiqaradi.
				"totpEnabled": false,
			},
			"$unset":       bson.M{"totpSecret": ""},
			"$setOnInsert": bson.M{"createdAt": time.Now()},
		},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		log.Fatalf("adminni upsert qilib bo'lmadi: %v", err)
	}

	switch {
	case res.UpsertedCount > 0:
		fmt.Printf("YANGI admin yaratildi: username=%q\n", cfg.AdminSeedUser)
	case res.ModifiedCount > 0:
		fmt.Printf("Mavjud admin yangilandi (parol qayta o'rnatildi): username=%q\n", cfg.AdminSeedUser)
	default:
		fmt.Printf("Admin topildi, o'zgarish yo'q (hash allaqachon shu edi): username=%q\n", cfg.AdminSeedUser)
	}
	fmt.Println("resetadmin tugadi — endi ADMIN_SEED_PASS bilan kirib ko'ring.")
}
