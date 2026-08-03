package account

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func quietLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// seedDeleted inserts a soft-deleted user whose deletedAt is ageDays in the
// past, along with one record in every collection that holds personal data.
// Storage is nil throughout — DeleteByURL no-ops on a nil service, so these
// tests cover the database half without needing S3 or a temp dir.
func seedDeleted(t *testing.T, db *mongo.Database, ageDays int) (primitive.ObjectID, primitive.ObjectID) {
	t.Helper()
	ctx := context.Background()
	uid := primitive.NewObjectID()
	elonID := primitive.NewObjectID()
	deletedAt := time.Now().AddDate(0, 0, -ageDays)

	must := func(what string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed %s: %v", what, err)
		}
	}
	_, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": uid, "firstName": "Deleted", "lastName": "User", "bio": "hello",
		"isDeleted": true, "deletedAt": deletedAt,
		"deletedPhone": "+998900000009", "deletedTelegramId": int64(555),
	})
	must("user", err)
	_, err = db.Collection("elons").InsertOne(ctx, bson.M{
		"_id": elonID, "ownerId": uid, "title": "Gone", "isDeleted": true,
	})
	must("elon", err)
	_, err = db.Collection("applications").InsertMany(ctx, []any{
		bson.M{"workerId": uid, "employerId": primitive.NewObjectID(), "workerPhone": "+998900000009"},
		bson.M{"employerId": uid, "workerId": primitive.NewObjectID()},
	})
	must("applications", err)
	_, err = db.Collection("notifications").InsertOne(ctx, bson.M{"userId": uid, "title": "hi"})
	must("notification", err)
	_, err = db.Collection("feedback").InsertOne(ctx, bson.M{"userId": uid, "message": "m", "userPhone": "+998900000009"})
	must("feedback", err)
	_, err = db.Collection("reports").InsertMany(ctx, []any{
		bson.M{"reporterId": uid, "reason": "spam"},
		bson.M{"reporterId": primitive.NewObjectID(), "targetType": "user", "targetId": uid, "reason": "abuse"},
		bson.M{"reporterId": primitive.NewObjectID(), "targetType": "elon", "targetId": elonID, "reason": "fake"},
	})
	must("reports", err)
	_, err = db.Collection("delete_codes").InsertOne(ctx, bson.M{"userId": uid, "code": "x"})
	must("delete_code", err)
	_, err = db.Collection("otp_codes").InsertOne(ctx, bson.M{"phone": "+998900000009", "code": "1234"})
	must("otp", err)
	return uid, elonID
}

// countAll reports how many documents anywhere still reference the user.
func countAll(t *testing.T, db *mongo.Database, uid, elonID primitive.ObjectID) map[string]int64 {
	t.Helper()
	ctx := context.Background()
	got := map[string]int64{}
	check := func(name string, filter bson.M) {
		n, err := db.Collection(name).CountDocuments(ctx, filter)
		if err != nil {
			t.Fatalf("count %s: %v", name, err)
		}
		got[name] = n
	}
	check("users", bson.M{"_id": uid})
	check("elons", bson.M{"ownerId": uid})
	check("applications", bson.M{"$or": []bson.M{{"workerId": uid}, {"employerId": uid}}})
	check("notifications", bson.M{"userId": uid})
	check("feedback", bson.M{"userId": uid})
	check("reports", bson.M{"$or": []bson.M{
		{"reporterId": uid},
		{"targetType": "user", "targetId": uid},
		{"targetType": "elon", "targetId": elonID},
	}})
	check("delete_codes", bson.M{"userId": uid})
	check("otp_codes", bson.M{"phone": "+998900000009"})
	return got
}

// An account past its retention window must leave nothing behind anywhere.
func TestPurgeErasesExpiredAccountEverywhere(t *testing.T) {
	db := testDB(t)
	uid, elonID := seedDeleted(t, db, 91)

	p := NewPurger(db, nil, DefaultRetentionDays, quietLog())
	if n := p.PurgeDue(context.Background()); n != 1 {
		t.Fatalf("purged %d accounts, want 1", n)
	}

	for coll, n := range countAll(t, db, uid, elonID) {
		if n != 0 {
			t.Errorf("%s: %d document(s) survived the purge, want 0", coll, n)
		}
	}
}

// The archived identity is the whole point of the grace period, so prove it is
// gone too — not just the login-facing phone/telegramId fields.
func TestPurgeRemovesArchivedIdentity(t *testing.T) {
	db := testDB(t)
	seedDeleted(t, db, 91)

	NewPurger(db, nil, DefaultRetentionDays, quietLog()).PurgeDue(context.Background())

	n, err := db.Collection("users").CountDocuments(context.Background(),
		bson.M{"$or": []bson.M{
			{"deletedPhone": "+998900000009"},
			{"deletedTelegramId": int64(555)},
		}})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("archived identity survived in %d document(s), want 0", n)
	}
}

// Inside the window nothing may be touched — a user who deleted by mistake can
// still be helped by support, and an early purge would be unrecoverable.
func TestPurgeSparesAccountsInsideWindow(t *testing.T) {
	db := testDB(t)
	uid, elonID := seedDeleted(t, db, 30)

	p := NewPurger(db, nil, DefaultRetentionDays, quietLog())
	if n := p.PurgeDue(context.Background()); n != 0 {
		t.Fatalf("purged %d accounts, want 0", n)
	}

	for coll, n := range countAll(t, db, uid, elonID) {
		if n == 0 {
			t.Errorf("%s: records erased before the retention window closed", coll)
		}
	}
}

// Notifications belonging to the counterparty must not be left pointing at
// applications that no longer exist.
func TestPurgeRemovesDanglingNotificationLinks(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid, _ := seedDeleted(t, db, 91)

	// The employer's copy of "a worker applied", deep-linking to the application.
	var app struct {
		ID primitive.ObjectID `bson:"_id"`
	}
	if err := db.Collection("applications").FindOne(ctx,
		bson.M{"workerId": uid}).Decode(&app); err != nil {
		t.Fatalf("find seeded application: %v", err)
	}
	otherUser := primitive.NewObjectID()
	if _, err := db.Collection("notifications").InsertOne(ctx, bson.M{
		"userId": otherUser, "type": "new_application", "title": "Yangi ariza",
		"relatedEntity": bson.M{"type": "application", "id": app.ID},
	}); err != nil {
		t.Fatalf("seed notification: %v", err)
	}

	NewPurger(db, nil, DefaultRetentionDays, quietLog()).PurgeDue(ctx)

	n, err := db.Collection("notifications").CountDocuments(ctx,
		bson.M{"relatedEntity.id": app.ID})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("%d notification(s) still deep-link to a purged application", n)
	}
}

// Live accounts must be invisible to the sweeper regardless of age.
func TestPurgeIgnoresActiveAccounts(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := primitive.NewObjectID()
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": uid, "phone": "+998900000010", "isDeleted": false,
		"createdAt": time.Now().AddDate(-3, 0, 0),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if n := NewPurger(db, nil, DefaultRetentionDays, quietLog()).PurgeDue(ctx); n != 0 {
		t.Fatalf("purged %d active accounts, want 0", n)
	}
	n, _ := db.Collection("users").CountDocuments(ctx, bson.M{"_id": uid})
	if n != 1 {
		t.Error("an active account was erased")
	}
}

// A misconfigured ACCOUNT_RETENTION_DAYS must never disable deletion or, worse,
// erase accounts the instant they are soft-deleted.
func TestRetentionDaysFallsBackToDefault(t *testing.T) {
	for _, days := range []int{0, -1} {
		p := NewPurger(nil2DB(t), nil, days, quietLog())
		if got := p.RetentionDays(); got != DefaultRetentionDays {
			t.Errorf("retentionDays(%d) = %d, want %d", days, got, DefaultRetentionDays)
		}
	}
}

// nil2DB returns a database handle usable for constructor-only assertions; it
// never issues a query, so no server is required.
func nil2DB(t *testing.T) *mongo.Database {
	t.Helper()
	cl, err := mongo.NewClient()
	if err != nil {
		t.Fatalf("mongo client: %v", err)
	}
	return cl.Database("unused")
}
