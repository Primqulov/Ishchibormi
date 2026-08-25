package category

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// TestListActiveCounts — `/api/categories` dagi son HOZIR feedda ko'rinadigan
// e'lonlarni sanashini tekshiradi: vaqti o'tgan, yakunlangan, o'chirilgan,
// egasi bloklangan va demo e'lonlar hisobga kirmaydi. Shuningdek ro'yxat faol
// e'lonlar soni bo'yicha kamayish tartibida kelishini tekshiradi.
//
// Mongo kerak (default: localhost:27017). Ulanib bo'lmasa test o'tkazib
// yuboriladi — bo'sh checkout'da ham `go test ./...` yashil qoladi.
func TestListActiveCounts(t *testing.T) {
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
		t.Skipf("mongo unavailable: %v", err)
	}
	db := cli.Database("ishchibormi_cat_count_test")
	t.Cleanup(func() {
		_ = db.Drop(context.Background())
		_ = cli.Disconnect(context.Background())
	})

	uz := time.FixedZone("UZT", 5*3600)
	day := func(offset int) string {
		return time.Now().In(uz).AddDate(0, 0, offset).Format("2006-01-02")
	}
	// -3 kun: soat qanchada test ishlamasin, 6 soatlik grace'dan aniq tashqarida.
	past, today, tomorrow := day(-3), day(0), day(1)

	catA := primitive.NewObjectID() // 2 ta faol
	catB := primitive.NewObjectID() // 1 ta faol + har xil faol emaslar
	catC := primitive.NewObjectID() // faqat vaqti o'tganlar → 0

	if _, err := db.Collection("categories").InsertMany(ctx, []any{
		bson.M{"_id": catA, "name": "Alfa", "slug": "alfa", "isActive": true, "usageCount": 40},
		bson.M{"_id": catB, "name": "Beta", "slug": "beta", "isActive": true, "usageCount": 99},
		bson.M{"_id": catC, "name": "Chala", "slug": "chala", "isActive": true, "usageCount": 70},
		bson.M{"_id": primitive.NewObjectID(), "name": "Yashirin", "slug": "yashirin", "isActive": false, "usageCount": 5},
	}); err != nil {
		t.Fatalf("seed categories: %v", err)
	}

	elon := func(cat primitive.ObjectID, startDate string, extra bson.M) bson.M {
		d := bson.M{"categoryId": cat, "status": "recruiting", "startDate": startDate}
		for k, v := range extra {
			d[k] = v
		}
		return d
	}
	if _, err := db.Collection("elons").InsertMany(ctx, []any{
		// Alfa — ikkalasi ham faol.
		elon(catA, today, nil),
		elon(catA, tomorrow, nil),
		// Beta — bittasi faol, qolganlari sanalmasligi kerak.
		elon(catB, today, nil),
		elon(catB, past, nil),                               // vaqti o'tgan
		elon(catB, tomorrow, bson.M{"status": "completed"}), // yakunlangan
		elon(catB, tomorrow, bson.M{"status": "filled"}),    // o'rinlar to'lgan
		elon(catB, tomorrow, bson.M{"status": "cancelled"}), // bekor qilingan
		elon(catB, tomorrow, bson.M{"isDeleted": true}),     // o'chirilgan
		elon(catB, tomorrow, bson.M{"ownerBlocked": true}),  // egasi bloklangan
		elon(catB, tomorrow, bson.M{"isReviewData": true}),  // Play demo
		// Chala — faqat vaqti o'tganlar.
		elon(catC, past, nil),
		elon(catC, past, nil),
	}); err != nil {
		t.Fatalf("seed elons: %v", err)
	}

	h := NewHandler(db)
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api/categories", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	var got []models.Category
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (body: %s)", err, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3 (faol bo'lmagan turkum chiqmasligi kerak): %+v", len(got), got)
	}

	// Tartib: faol e'lonlar soni bo'yicha kamayish (usageCount emas — aks holda
	// Beta 99 bilan birinchi bo'lardi).
	wantOrder := []struct {
		name   string
		active int
	}{{"Alfa", 2}, {"Beta", 1}, {"Chala", 0}}
	for i, w := range wantOrder {
		if got[i].Name != w.name {
			t.Fatalf("got[%d].Name = %q, want %q (tartib activeCount bo'yicha bo'lishi kerak): %+v", i, got[i].Name, w.name, got)
		}
		if got[i].ActiveCount != w.active {
			t.Errorf("%s activeCount = %d, want %d", w.name, got[i].ActiveCount, w.active)
		}
		// Eski klientlar uchun usageCount ham faol son bilan almashtiriladi.
		if got[i].UsageCount != w.active {
			t.Errorf("%s usageCount = %d, want %d (ommaviy javobda activeCount bilan bir xil)", w.name, got[i].UsageCount, w.active)
		}
	}
}
