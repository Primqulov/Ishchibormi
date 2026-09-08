// Package elonpurge persists completion audits across final document removal.
package elonpurge

import (
	"context"
	"errors"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const Collection = "admin_elon_purge_events"

// Queue must succeed before final deletion. It cannot trigger deletion itself.
func Queue(ctx context.Context, db *mongo.Database, event models.ElonPurgeEvent) error {
	_, err := db.Collection(Collection).UpdateOne(ctx, bson.M{"_id": event.ID}, bson.M{"$setOnInsert": event}, options.Update().SetUpsert(true))
	return err
}

// Finish records success only after the target is actually gone. On an audit
// failure the durable event remains for the worker to retry with the same ID.
func Finish(ctx context.Context, db *mongo.Database, audit *mongo.Collection, event models.ElonPurgeEvent) bool {
	err := db.Collection("elons").FindOne(ctx, bson.M{"_id": event.ElonID}, options.FindOne().SetProjection(bson.M{"_id": 1})).Err()
	if !errors.Is(err, mongo.ErrNoDocuments) || audit == nil {
		return false
	}
	_, err = audit.UpdateOne(ctx, bson.M{"_id": event.ID}, bson.M{"$setOnInsert": models.AdminAudit{
		ID: event.ID, AdminID: event.AdminID, Action: "elon_delete", Kind: "purged", Target: event.ElonID.Hex(),
		Detail: "purge — bazadan butunlay o'chirildi (qaytarib bo'lmaydi)", CreatedAt: event.CreatedAt,
	}}, options.Update().SetUpsert(true))
	if err != nil {
		return false
	}
	_, _ = db.Collection(Collection).DeleteOne(ctx, bson.M{"_id": event.ID})
	return true
}

func Retry(ctx context.Context, db *mongo.Database, audit *mongo.Collection) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	col := db.Collection(Collection)
	cur, err := col.Find(ctx, bson.M{"nextAttemptAt": bson.M{"$lte": time.Now()}}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "nextAttemptAt", Value: 1}}))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var event models.ElonPurgeEvent
		if cur.Decode(&event) == nil && !Finish(ctx, db, audit, event) {
			_, _ = col.UpdateOne(ctx, bson.M{"_id": event.ID}, bson.M{"$set": bson.M{"nextAttemptAt": time.Now().Add(time.Minute)}})
		}
	}
}
