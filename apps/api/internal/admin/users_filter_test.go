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

// Blok filtri ikkita maydonga qaraydi (`isBlocked` va muddatli
// `moderationBannedUntil`) va qidiruv bilan bir vaqtda ishlashi kerak — ikkalasi
// ham `$or` ishlatadi. Shuning uchun tekshiruv haqiqiy Mongo ustida: bu yerda
// xato bo'lsa, so'rov jimgina noto'g'ri javob qaytaradi, yiqilmaydi.
func filterDB(t *testing.T) *mongo.Database {
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
	db := cli.Database("ishchibormi_users_filter_test")
	t.Cleanup(func() {
		_ = db.Drop(context.Background())
		_ = cli.Disconnect(context.Background())
	})
	return db
}

func TestUsersFilterTreatsBothBlocksAsOne(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	users := db.Collection("users")

	past := time.Now().Add(-24 * time.Hour)
	future := time.Now().Add(365 * 24 * time.Hour)
	seed := []bson.M{
		{"_id": primitive.NewObjectID(), "firstName": "Faol", "isBlocked": false},
		{"_id": primitive.NewObjectID(), "firstName": "QoldaBlok", "isBlocked": true},
		// Nomaqbul kontent uchun avtomatik bloklangan: `isBlocked` false, lekin
		// ilovaga kira olmaydi. Ilgari bu odam "Faol" ro'yxatida chiqardi.
		{"_id": primitive.NewObjectID(), "firstName": "AvtoBlok", "isBlocked": false,
			"moderationBannedUntil": future},
		// Muddati o'tgan blok — blok emas.
		{"_id": primitive.NewObjectID(), "firstName": "EskiBlok", "isBlocked": false,
			"moderationBannedUntil": past},
	}
	docs := make([]any, len(seed))
	for i, d := range seed {
		docs[i] = d
	}
	if _, err := users.InsertMany(ctx, docs); err != nil {
		t.Fatalf("seed: %v", err)
	}

	names := func(q url.Values) []string {
		cur, err := users.Find(ctx, usersFilter(q), options.Find().SetSort(bson.D{{Key: "firstName", Value: 1}}))
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		defer cur.Close(ctx)
		out := []string{}
		for cur.Next(ctx) {
			var u struct {
				FirstName string `bson:"firstName"`
			}
			if err := cur.Decode(&u); err == nil {
				out = append(out, u.FirstName)
			}
		}
		return out
	}

	got := names(url.Values{"blocked": {"1"}})
	want := []string{"AvtoBlok", "QoldaBlok"}
	if !equal(got, want) {
		t.Errorf("blocked=1 -> %v, want %v", got, want)
	}

	got = names(url.Values{"blocked": {"0"}})
	want = []string{"EskiBlok", "Faol"}
	if !equal(got, want) {
		t.Errorf("blocked=0 -> %v, want %v", got, want)
	}
}

// Qidiruv `$or` ishlatadi, blok filtri ham — biri ikkinchisini bosib
// ketmasligi kerak.
func TestUsersFilterCombinesSearchAndBlocked(t *testing.T) {
	db := filterDB(t)
	ctx := context.Background()
	users := db.Collection("users")

	future := time.Now().Add(365 * 24 * time.Hour)
	if _, err := users.InsertMany(ctx, []any{
		bson.M{"_id": primitive.NewObjectID(), "firstName": "Anvar", "phone": "+998901112200",
			"moderationBannedUntil": future},
		bson.M{"_id": primitive.NewObjectID(), "firstName": "Anvar", "phone": "+998901112201"},
		bson.M{"_id": primitive.NewObjectID(), "firstName": "Bobur", "phone": "+998901112202", "isBlocked": true},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	f := usersFilter(url.Values{"q": {"Anvar"}, "blocked": {"1"}})
	cur, err := users.Find(ctx, f)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	defer cur.Close(ctx)
	var found []string
	for cur.Next(ctx) {
		var u struct {
			Phone string `bson:"phone"`
		}
		if err := cur.Decode(&u); err == nil {
			found = append(found, u.Phone)
		}
	}
	if len(found) != 1 || found[0] != "+998901112200" {
		t.Errorf("qidiruv + blok filtri = %v, want [+998901112200]", found)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
