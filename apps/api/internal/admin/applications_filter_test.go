package admin

import (
	"context"
	"net/url"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Arizalar filtri uchta qoidani bir vaqtda ushlab turishi kerak: oq ro'yxat,
// `stale` ni holat ustiga BOSMASLIK va namoyish (review) arizalarini chiqarib
// tashlash. Uchalasi ham xato bo'lganda so'rov yiqilmaydi — jimgina boshqa
// ma'lumot qaytaradi, shuning uchun tekshiruv haqiqiy Mongo ustida.
func appsFilterDB(t *testing.T) *mongo.Database {
	t.Helper()
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	if err := cli.Ping(ctx, nil); err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	db := cli.Database("ishchibormi_apps_filter_test")
	t.Cleanup(func() {
		_ = db.Drop(context.Background())
		_ = cli.Disconnect(context.Background())
	})
	return db
}

// ishchiA / ishchiB — seed qatorlarining egalari. `worker=` filtri ikki
// ishchini ajratishini tekshirish uchun ID lar oldindan ma'lum bo'lishi kerak.
var (
	ishchiA = primitive.NewObjectID()
	ishchiB = primitive.NewObjectID()
)

// seedApps to'ldiradigan qatorlar: har birining `elonTitle` si nomi bo'lib
// xizmat qiladi, natijani o'qish oson bo'lsin.
func seedApps(t *testing.T, apps *mongo.Collection) {
	t.Helper()
	ctx := context.Background()
	eski := time.Now().AddDate(0, 0, -10)
	yangi := time.Now().Add(-2 * time.Hour)
	docs := []any{
		bson.M{"_id": primitive.NewObjectID(), "elonTitle": "EskiKutish", "status": "pending",
			"appliedAt": eski, "workerId": ishchiA},
		bson.M{"_id": primitive.NewObjectID(), "elonTitle": "YangiKutish", "status": "pending",
			"appliedAt": yangi, "workerId": ishchiB},
		bson.M{"_id": primitive.NewObjectID(), "elonTitle": "Qabul", "status": "accepted",
			"appliedAt": eski, "workerId": ishchiA},
		bson.M{"_id": primitive.NewObjectID(), "elonTitle": "Bajarildi", "status": "completed",
			"appliedAt": eski, "workerId": ishchiB},
		// Do'kon tekshiruvi uchun namoyish arizasi — hech qaysi filtrda
		// ko'rinmasligi kerak.
		bson.M{"_id": primitive.NewObjectID(), "elonTitle": "Namoyish", "status": "pending",
			"appliedAt": eski, "isReviewData": true, "workerId": ishchiA},
	}
	if _, err := apps.InsertMany(ctx, docs); err != nil {
		t.Fatalf("seed: %v", err)
	}
}

func appTitles(t *testing.T, apps *mongo.Collection, q url.Values) []string {
	t.Helper()
	ctx := context.Background()
	cur, err := apps.Find(ctx, appsFilter(q), options.Find().SetSort(bson.D{{Key: "elonTitle", Value: 1}}))
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	defer cur.Close(ctx)
	out := []string{}
	for cur.Next(ctx) {
		var a struct {
			ElonTitle string `bson:"elonTitle"`
		}
		if err := cur.Decode(&a); err == nil {
			out = append(out, a.ElonTitle)
		}
	}
	return out
}

// Namoyish arizalari hech bir ro'yxatga (va CSV faylga) tushmaydi.
func TestAppsFilterHidesReviewData(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	got := appTitles(t, apps, url.Values{})
	want := []string{"Bajarildi", "EskiKutish", "Qabul", "YangiKutish"}
	if !equal(got, want) {
		t.Errorf("filtrsiz -> %v, want %v", got, want)
	}
}

// Begona `status` qiymati Mongo'ga tushmaydi: ro'yxat kengroq ko'rinadi,
// lekin "bunday ariza yo'q" degan yolg'on bo'sh javob qaytmaydi.
func TestAppsFilterIgnoresUnknownStatus(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	f := appsFilter(url.Values{"status": {"$ne"}})
	if _, bor := f["$and"]; bor {
		t.Errorf("noma'lum holat filtrga tushdi: %v", f)
	}
	got := appTitles(t, apps, url.Values{"status": {"pending; drop"}})
	want := []string{"Bajarildi", "EskiKutish", "Qabul", "YangiKutish"}
	if !equal(got, want) {
		t.Errorf("noma'lum holat -> %v, want %v", got, want)
	}

	got = appTitles(t, apps, url.Values{"status": {"pending"}})
	want = []string{"EskiKutish", "YangiKutish"}
	if !equal(got, want) {
		t.Errorf("status=pending -> %v, want %v", got, want)
	}
}

// `stale=1` faqat 3+ kundan beri kutayotganlarni qoldiradi.
func TestAppsFilterStaleKeepsOnlyOldPending(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	got := appTitles(t, apps, url.Values{"stale": {"1"}})
	want := []string{"EskiKutish"}
	if !equal(got, want) {
		t.Errorf("stale=1 -> %v, want %v", got, want)
	}
}

// `stale=1` holat filtrini BOSIB KETMAYDI: "Qabul qilingan + 3+ kun" so'rovi
// bo'sh natija berishi kerak, `pending` qatorlar emas.
func TestAppsFilterStaleDoesNotOverrideStatus(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	got := appTitles(t, apps, url.Values{"status": {"accepted"}, "stale": {"1"}})
	if len(got) != 0 {
		t.Errorf("status=accepted&stale=1 -> %v, want bo'sh", got)
	}
}

// `worker=<oid>` bitta ishchining arizalarini qoldiradi — batafsil sahifadagi
// «Barchasini ko'rish» havolasi shu filtr ustida ishlaydi.
func TestAppsFilterWorkerScopesToOneWorker(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	got := appTitles(t, apps, url.Values{"worker": {ishchiA.Hex()}})
	// "Namoyish" ham ishchiA ga tegishli, lekin `appsBase()` uni chiqarib
	// tashlaydi: yangi filtr namoyish arizalarini ochib yubormasligi kerak.
	want := []string{"EskiKutish", "Qabul"}
	if !equal(got, want) {
		t.Errorf("worker=A -> %v, want %v", got, want)
	}

	// Boshqa filtr bilan birga ishlaydi (ikkisi ham `$and` ichida).
	got = appTitles(t, apps, url.Values{"worker": {ishchiA.Hex()}, "status": {"accepted"}})
	if want = []string{"Qabul"}; !equal(got, want) {
		t.Errorf("worker=A&status=accepted -> %v, want %v", got, want)
	}
}

// Buzuq `worker` qiymati Mongo filtriga XOM holda tushmaydi: `ObjectIDFromHex`
// dan o'tmagan qiymat butunlay tashlab yuboriladi.
func TestAppsFilterIgnoresBadWorker(t *testing.T) {
	apps := appsFilterDB(t).Collection("applications")
	seedApps(t, apps)

	for _, xom := range []string{"", "begona", `{"$ne":null}`, ishchiA.Hex() + "00"} {
		f := appsFilter(url.Values{"worker": {xom}})
		if _, bor := f["$and"]; bor {
			t.Errorf("worker=%q filtrga tushdi: %v", xom, f)
		}
		got := appTitles(t, apps, url.Values{"worker": {xom}})
		want := []string{"Bajarildi", "EskiKutish", "Qabul", "YangiKutish"}
		if !equal(got, want) {
			t.Errorf("worker=%q -> %v, want %v", xom, got, want)
		}
	}
}

// Audit izohi qaysi ishchi eksport qilinganini yozadi — CSV bitta odamning
// barcha telefon raqamlarini faylga chiqaradi.
func TestAppsScopeRecordsWorker(t *testing.T) {
	got := appsScope(url.Values{"worker": {ishchiA.Hex()}, "status": {"pending"}})
	want := "holat=pending ishchi=" + ishchiA.Hex()
	if got != want {
		t.Errorf("appsScope -> %q, want %q", got, want)
	}
	if got := appsScope(url.Values{"worker": {"begona"}}); got != "filtrsiz" {
		t.Errorf("buzuq worker -> %q, want %q", got, "filtrsiz")
	}
}

// CSV `holat` ustuni o'zbekcha yorliq yozadi; noma'lum kod esa yo'qolmaydi.
func TestAppStatusTextUsesUzbekLabels(t *testing.T) {
	cases := map[string]string{
		"pending":   "Kutilmoqda",
		"accepted":  "Qabul qilingan",
		"rejected":  "Rad etilgan",
		"cancelled": "Bekor qilingan",
		"completed": "Bajarilgan",
		"begona":    "begona",
		"":          "",
	}
	for kod, want := range cases {
		if got := appStatusText(kod); got != want {
			t.Errorf("appStatusText(%q) = %q, want %q", kod, got, want)
		}
	}
}
