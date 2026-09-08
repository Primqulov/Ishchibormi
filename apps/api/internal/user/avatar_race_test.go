package user

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestAvatarWriteRejectsValidationSnapshotAfterDeletionJobDisappears(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	uri := os.Getenv("MONGO_TEST_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	if err = cli.Ping(ctx, nil); err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	db := cli.Database("ishchibormi_avatar_race_" + primitive.NewObjectID().Hex())
	t.Cleanup(func() { _ = db.Drop(context.Background()); _ = cli.Disconnect(context.Background()) })
	uid, jobID := primitive.NewObjectID(), primitive.NewObjectID()
	url := "https://cdn.example/avatars/" + uid.Hex() + "/old.png"
	users := db.Collection("users")
	if _, err := users.InsertOne(ctx, bson.M{"_id": uid, "avatarUrl": nil, "avatarRevision": int64(4), "avatarDeletionJobs": []bson.M{{"id": jobID, "url": url}}}); err != nil {
		t.Fatal(err)
	}
	// PATCH /me validates the upload while cleanup has not yet tombstoned it.
	var before models.User
	if err := users.FindOne(ctx, bson.M{"_id": uid}).Decode(&before); err != nil {
		t.Fatal(err)
	}
	// Cleanup completes while that request is paused before its conditional write.
	if _, err := db.Collection("avatar_uploads").InsertOne(ctx, bson.M{"_id": url, "deletedAt": time.Now()}); err != nil {
		t.Fatal(err)
	}
	if _, err := users.UpdateOne(ctx, bson.M{"_id": uid}, bson.M{"$pull": bson.M{"avatarDeletionJobs": bson.M{"id": jobID}}, "$inc": bson.M{"avatarRevision": 1}}); err != nil {
		t.Fatal(err)
	}
	res, err := users.UpdateOne(ctx, avatarWriteFilter(uid, before, url), bson.M{"$set": bson.M{"avatarUrl": url}})
	if err != nil {
		t.Fatal(err)
	}
	if res.MatchedCount != 0 {
		t.Fatal("stale request reattached a deleted avatar after its job fence disappeared")
	}
}
