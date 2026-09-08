package account

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestPurgeIncludesAvatarUploadMetadataAndPendingOldFiles(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid, _ := seedDeleted(t, db, 100)
	s, err := storage.NewLocal(t.TempDir(), "https://assets.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	file, err := s.Upload(ctx, "avatars/"+uid.Hex(), "old.jpg", "image/jpeg", bytes.NewBufferString("old bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Collection("avatar_uploads").InsertOne(ctx, models.AvatarUpload{ID: file.URL, UserID: uid}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Collection("users").UpdateOne(ctx, bson.M{"_id": uid}, bson.M{"$set": bson.M{"avatarDeletionJobs": []models.AvatarDeletionJob{{ID: primitive.NewObjectID(), URL: file.URL, AuditDone: true, CreatedAt: time.Now()}}}}); err != nil {
		t.Fatal(err)
	}
	p := NewPurger(db, s, 90, quietLog())
	if n := p.PurgeDue(ctx); n != 1 {
		t.Fatalf("purged %d", n)
	}
	if _, err := s.Download(ctx, file.Key, 1<<20); err == nil {
		t.Error("old avatar left behind")
	}
	if n, err := db.Collection("avatar_uploads").CountDocuments(ctx, bson.M{"userId": uid}); err != nil || n != 0 {
		t.Fatalf("metadata remains: n=%d err=%v", n, err)
	}
}
