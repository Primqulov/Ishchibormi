package account

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func TestPurgeElonStorageFailureRetainsLiveImageAndCascadeUntilRetry(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	dir := t.TempDir()
	s, err := storage.NewLocal(dir, "https://assets.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	uid, id, appID := primitive.NewObjectID(), primitive.NewObjectID(), primitive.NewObjectID()
	f, err := s.Upload(ctx, "elons/"+uid.Hex(), "photo.png", "image/png", bytes.NewBufferString("photo"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Collection("elons").InsertOne(ctx, models.Elon{ID: id, OwnerID: uid, Images: []string{f.URL}, IsDeleted: true})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = db.Collection("applications").InsertOne(ctx, models.Application{ID: appID, ElonID: id})
	_, _ = db.Collection("notifications").InsertOne(ctx, models.Notification{ID: primitive.NewObjectID(), RelatedEntity: &models.RelatedEntity{Type: "application", ID: appID}})
	// A nonempty directory at the object path deterministically makes local
	// storage deletion fail on Windows and Unix, without a production service.
	path := filepath.Join(dir, filepath.FromSlash(f.Key))
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(path, "locked")
	if err := os.WriteFile(child, []byte("hold"), 0600); err != nil {
		t.Fatal(err)
	}
	p := NewPurger(db, s, 90, quietLog())
	if err := p.PurgeElonNow(ctx, id); err == nil {
		t.Fatal("storage failure falsely reported success")
	}
	for _, collection := range []string{"elons", "applications", "notifications"} {
		if n, _ := db.Collection(collection).CountDocuments(ctx, bson.M{}); n != 1 {
			t.Errorf("failure lost %s retry data: %d", collection, n)
		}
	}
	if err := os.Remove(child); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("photo"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := p.PurgeElonNow(ctx, id); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if _, err := s.Download(ctx, f.Key, 1024); err == nil {
		t.Error("retry retained photo")
	}
	for _, collection := range []string{"elons", "applications", "notifications"} {
		if n, _ := db.Collection(collection).CountDocuments(ctx, bson.M{}); n != 0 {
			t.Errorf("retry left %s: %d", collection, n)
		}
	}
}

func TestPurgeElonNotificationFailureKeepsApplicationIDsForRetry(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id, appID := primitive.NewObjectID(), primitive.NewObjectID()
	_, err := db.Collection("elons").InsertOne(ctx, models.Elon{ID: id, IsDeleted: true})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = db.Collection("applications").InsertOne(ctx, models.Application{ID: appID, ElonID: id})
	_, _ = db.Collection("notifications").InsertOne(ctx, models.Notification{ID: primitive.NewObjectID(), RelatedEntity: &models.RelatedEntity{Type: "application", ID: appID}})
	// Mongo views are read-only: this simulates a real failed notification
	// delete without failpoints or changes to any other database connection.
	if err := db.CreateView(ctx, "readonly_notifications", "notifications", mongo.Pipeline{}); err != nil {
		t.Fatal(err)
	}
	p := NewPurger(db, nil, 90, quietLog())
	p.notifs = db.Collection("readonly_notifications")
	if err := p.PurgeElonNow(ctx, id); err == nil {
		t.Fatal("notification failure falsely reported success")
	}
	if n, _ := db.Collection("applications").CountDocuments(ctx, bson.M{"_id": appID}); n != 1 {
		t.Error("application IDs vanished before notification cleanup")
	}
	p.notifs = db.Collection("notifications")
	if err := p.PurgeElonNow(ctx, id); err != nil {
		t.Fatal(err)
	}
	for _, collection := range []string{"elons", "applications", "notifications"} {
		if n, _ := db.Collection(collection).CountDocuments(ctx, bson.M{}); n != 0 {
			t.Errorf("retry left %s: %d", collection, n)
		}
	}
}

func TestAccountPurgeRemovesImagesSharedByItsOwnListings(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	s, err := storage.NewLocal(t.TempDir(), "https://assets.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	uid := primitive.NewObjectID()
	f, err := s.Upload(ctx, "elons/"+uid.Hex(), "shared.png", "image/png", bytes.NewBufferString("shared"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Collection("users").InsertOne(ctx, models.User{ID: uid, IsDeleted: true})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		_, err := db.Collection("elons").InsertOne(ctx, models.Elon{ID: primitive.NewObjectID(), OwnerID: uid, Images: []string{f.URL}})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := NewPurger(db, s, 90, quietLog()).PurgeUserNow(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Download(ctx, f.Key, 1024); err == nil {
		t.Error("account purge orphaned a shared listing file")
	}
}
