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

// TestEnsureDefaults tizim turkumlari BORLIGINI kafolatlashini, lekin
// mavjud yozuvlarning nomi va holatini bosib ketmasligini tekshiradi:
// superadmin panelda (Figma 3.7) tizim turkumini tahrirlashi va nofaol
// qilishi mumkin, deploy esa uning qarorini bekor qilmasligi kerak.
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
	// slug'ga to'g'ri keladigan, lekin superadmin tomonidan nofaol qilingan
	// va qayta nomlangan yozuv.
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

	// Barcha turkumlar slug bo'yicha.
	bySlug := map[string]bson.M{}
	cur, err := col.Find(ctx, bson.M{})
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	for cur.Next(ctx) {
		var d bson.M
		if err := cur.Decode(&d); err == nil {
			bySlug[fmt.Sprint(d["slug"])] = d
		}
	}
	cur.Close(ctx)

	// Uchta rasmiy turkum bazada bo'lishi va himoyalangan (o'chirib
	// bo'lmaydigan) deb belgilanishi shart.
	for _, want := range []string{"tozalash", "yuk-tashish", "maxsus"} {
		d, ok := bySlug[want]
		if !ok {
			t.Errorf("tizim turkumi %q bazada yo'q", want)
			continue
		}
		if d["isSystemDefault"] != true {
			t.Errorf("%q: isSystemDefault=%v, true bo'lishi kerak", want, d["isSystemDefault"])
		}
	}

	// Yo'qdan yaratilganlari — faol, kanonik nom va ikonka bilan.
	for slug, wantName := range map[string]string{"yuk-tashish": "Yuk tashish", "maxsus": "Maxsus"} {
		d, ok := bySlug[slug]
		if !ok {
			continue
		}
		if d["isActive"] != true {
			t.Errorf("%q yangi yaratildi, lekin isActive=%v", slug, d["isActive"])
		}
		if got := fmt.Sprint(d["name"]); got != wantName {
			t.Errorf("%q nomi = %q, kutilgan %q", slug, got, wantName)
		}
		if fmt.Sprint(d["icon"]) == "" || d["icon"] == nil {
			t.Errorf("%q ikonkasiz yaratildi", slug)
		}
	}

	// ENG MUHIMI: superadmin nofaol qilib, qayta nomlagan tizim turkumi
	// restartdan keyin ham SHUNDAY qolishi kerak. Aks holda 3.7a dagi
	// «nishonni bosib nofaol qilish» amali keyingi deployda jimgina bekor
	// bo'lardi.
	if d, ok := bySlug["tozalash"]; ok {
		if d["isActive"] != false {
			t.Errorf("tozalash isActive=%v — deploy superadminning qarorini bekor qildi", d["isActive"])
		}
		if got := fmt.Sprint(d["name"]); got != "Old Tozalash" {
			t.Errorf("tozalash nomi = %q — deploy paneldagi tahrirni bosib ketdi", got)
		}
		if got := fmt.Sprint(d["icon"]); got != "x" {
			t.Errorf("tozalash ikonkasi = %q — deploy paneldagi tahrirni bosib ketdi", got)
		}
		if fmt.Sprint(d["usageCount"]) != "5" {
			t.Errorf("tozalash usageCount = %v, 5 bo'lib qolishi kerak", d["usageCount"])
		}
	}

	// Admin turkumlari umuman tegilmaydi.
	for _, want := range []string{"ustachilik", "bogdorchilik", "qurilish"} {
		d, ok := bySlug[want]
		if !ok {
			t.Errorf("admin turkumi %q yo'qoldi", want)
			continue
		}
		if d["isActive"] != true {
			t.Errorf("admin turkumi %q restartdan keyin nofaol bo'lib qoldi", want)
		}
		if d["isSystemDefault"] == true {
			t.Errorf("admin turkumi %q tizim turkumiga aylanib qoldi", want)
		}
	}

	// Eski/admin turkumlar o'chirilmasligi va holati saqlanishi kerak.
	total, _ := col.CountDocuments(ctx, bson.M{})
	if total < 5 {
		t.Errorf("umumiy turkum soni = %d, eski yozuvlar o'chib ketmasligi kerak (>=5)", total)
	}
	var ust bson.M
	if err := col.FindOne(ctx, bson.M{"slug": "ustachilik"}).Decode(&ust); err != nil {
		t.Errorf("ustachilik yozuvi topilmadi (o'chib ketmasligi kerak): %v", err)
	} else if ust["isActive"] != true {
		t.Errorf("ustachilik isActive=%v, faol (true) bo'lib qolishi kerak", ust["isActive"])
	}
}
