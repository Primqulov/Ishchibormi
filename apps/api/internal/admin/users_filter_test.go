package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
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

// Old clients may still send verified. List rows, totals and CSV must include
// every verification state while continuing to respect the remaining filters.
func TestUsersListAndExportIgnoreVerificationFilter(t *testing.T) {
	db := filterDB(t)
	h := &Handler{Users: db.Collection("users"), AuditCol: db.Collection("admin_audit")}
	now := time.Now()
	rows := []bson.M{
		{"isPhoneVerified": true},
		{"isPhoneVerified": false},
		{}, // Older account with no verification field.
		{"firstName": "Bobur"},
		{"region": "Buxoro"},
		{"lastPlatform": "ios"},
		{"isBlocked": true},
		{"moderationBannedUntil": now.Add(24 * time.Hour)},
		{"isDeleted": true},
	}
	docs := make([]any, len(rows))
	wantIDs := make([]string, 0, 3)
	for i, fields := range rows {
		id := primitive.NewObjectID()
		doc := bson.M{
			"_id": id, "firstName": "Anvar", "region": "Toshkent sh.",
			"lastPlatform": "android", "createdAt": now.Add(-time.Duration(i) * time.Minute),
		}
		for key, value := range fields {
			doc[key] = value
		}
		docs[i] = doc
		if i < 3 {
			wantIDs = append(wantIDs, id.Hex())
		}
	}
	if _, err := h.Users.InsertMany(context.Background(), docs); err != nil {
		t.Fatalf("seed: %v", err)
	}

	for _, verified := range []string{"", "1", "0"} {
		t.Run("verified="+verified, func(t *testing.T) {
			q := url.Values{
				"q": {"Anvar"}, "region": {"Toshkent sh."}, "platform": {"android"},
				"blocked": {"0"}, "deleted": {"hide"},
			}
			if verified != "" {
				q.Set("verified", verified)
			}
			list := httptest.NewRecorder()
			h.ListUsers(list, httptest.NewRequest(http.MethodGet, "/api/admin/users?"+q.Encode(), nil))
			if list.Code != http.StatusOK {
				t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
			}
			var page struct {
				Items []struct {
					ID string `json:"id"`
				} `json:"items"`
				Total int `json:"total"`
			}
			if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil {
				t.Fatalf("decode list: %v", err)
			}
			gotIDs := make([]string, 0, len(page.Items))
			for _, user := range page.Items {
				gotIDs = append(gotIDs, user.ID)
			}
			if !equal(gotIDs, wantIDs) || page.Total != len(wantIDs) {
				t.Errorf("list = %v, total = %d; want %v, total = %d", gotIDs, page.Total, wantIDs, len(wantIDs))
			}

			export := httptest.NewRecorder()
			h.ExportUsers(export, httptest.NewRequest(http.MethodGet, "/api/admin/export/users.csv?"+q.Encode(), nil))
			if export.Code != http.StatusOK {
				t.Fatalf("export status = %d, body = %s", export.Code, export.Body.String())
			}
			reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(export.Body.String(), "\uFEFF")))
			reader.Comma = ';'
			records, err := reader.ReadAll()
			if err != nil {
				t.Fatalf("decode CSV: %v", err)
			}
			gotIDs = make([]string, 0, len(records)-1)
			for _, record := range records[1:] {
				gotIDs = append(gotIDs, record[0])
			}
			if !equal(gotIDs, wantIDs) {
				t.Errorf("CSV = %v, want %v", gotIDs, wantIDs)
			}
		})
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
