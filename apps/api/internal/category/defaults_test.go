package category

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// TestEnsureDefaults, eski/ortiqcha turkumlar bo'lgan DB'da EnsureDefaults
// aynan 3 faol turkum qoldirishini va qolganlarini nofaol qilishini tekshiradi.
// Mongo kerak (default: localhost:27017). Ulanib bo'lmasa test o'tkazib yuboriladi.
func TestEnsureDefaults(t *testing.T) {
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	if err := cli.Ping(ctx, nil); err != nil {
		t.Skipf("mongo ping failed: %v", err)
	}
	defer cli.Disconnect(ctx)

	dbName := fmt.Sprintf("ib_ensure_test_%d", time.Now().UnixNano())
	db := cli.Database(dbName)
	defer db.Drop(ctx)
	col := db.Collection("categories")

	// Eski holatni simulyatsiya qilamiz: ortiqcha faol turkumlar + kanonik
	// slug'ga to'g'ri keladigan, lekin nofaol va eski nomli yozuv.
	stale := []any{
		bson.M{"name": "Old Tozalash", "slug": "tozalash", "icon": "x", "isActive": false, "usageCount": 5},
		bson.M{"name": "Ustachilik", "slug": "ustachilik", "icon": "🛠️", "isActive": true, "usageCount": 9},
		bson.M{"name": "Bog'dorchilik", "slug": "bogdorchilik", "icon": "🌳", "isActive": true, "usageCount": 3},
		bson.M{"name": "Qurilish", "slug": "qurilish", "icon": "🏗️", "isActive": true, "usageCount": 7},
	}
	if _, err := col.InsertMany(ctx, stale); err != nil {
		t.Fatalf("seed stale: %v", err)
	}

	// Ikki marta ishga tushiramiz — idempotent bo'lishi shart.
	for i := 0; i < 2; i++ {
		if err := EnsureDefaults(ctx, db); err != nil {
			t.Fatalf("EnsureDefaults run %d: %v", i, err)
		}
	}

	// Faol turkumlar (List handler aynan shu filtrni ishlatadi).
	activeSlugs := map[string]bson.M{}
	cur, err := col.Find(ctx, bson.M{"isActive": true})
	if err != nil {
		t.Fatalf("find active: %v", err)
	}
	for cur.Next(ctx) {
		var d bson.M
		if err := cur.Decode(&d); err == nil {
			activeSlugs[fmt.Sprint(d["slug"])] = d
		}
	}
	cur.Close(ctx)

	if len(activeSlugs) != 3 {
		t.Fatalf("faol turkumlar soni = %d, kutilgan 3; slug'lar: %v", len(activeSlugs), keys(activeSlugs))
	}
	for _, want := range []string{"tozalash", "yuk-tashish", "maxsus"} {
		d, ok := activeSlugs[want]
		if !ok {
			t.Errorf("faol turkumda %q yo'q", want)
			continue
		}
		if d["isSystemDefault"] != true {
			t.Errorf("%q: isSystemDefault=false, true bo'lishi kerak", want)
		}
	}

	// Kanonik slug qayta faollashtirilib, nomi yangilanganini tekshiramiz.
	if d, ok := activeSlugs["tozalash"]; ok && fmt.Sprint(d["name"]) != "Tozalash" {
		t.Errorf("tozalash nomi = %q, kutilgan \"Tozalash\"", d["name"])
	}

	// Eski turkumlar o'chirilmagan, faqat nofaol bo'lishi kerak.
	total, _ := col.CountDocuments(ctx, bson.M{})
	if total < 5 {
		t.Errorf("umumiy turkum soni = %d, eski yozuvlar o'chib ketmasligi kerak (>=5)", total)
	}
	var ust bson.M
	if err := col.FindOne(ctx, bson.M{"slug": "ustachilik"}).Decode(&ust); err != nil {
		t.Errorf("ustachilik yozuvi topilmadi (o'chib ketmasligi kerak): %v", err)
	} else if ust["isActive"] != false {
		t.Errorf("ustachilik isActive=%v, nofaol (false) bo'lishi kerak", ust["isActive"])
	}
}

func keys(m map[string]bson.M) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
