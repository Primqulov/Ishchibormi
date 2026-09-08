// Package elonimages coordinates attachment and moderation of listing files.
package elonimages

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const Collection = "elon_image_assets"

// Reserve runs before a new photo reference is attached. A file belongs to
// one listing; immutable ownership and removal tombstones close the window
// between a cleanup worker's reference check and a concurrent owner save.
func Reserve(ctx context.Context, db *mongo.Database, s *storage.Service, id, ownerID primitive.ObjectID, urls []string) error {
	for _, raw := range urls {
		if !listingKey(s, raw, ownerID) {
			return httpx.NewError(400, "bad_image", "e'lon uchun yuklangan rasmni tanlang")
		}
		pending, err := db.Collection("elons").CountDocuments(ctx, bson.M{"adminModerationJobs.images": raw})
		if err != nil {
			return err
		}
		if pending > 0 {
			return unavailable()
		}
		n, err := db.Collection("elons").CountDocuments(ctx, bson.M{"_id": bson.M{"$ne": id}, "images": raw})
		if err != nil {
			return err
		}
		if n > 0 {
			return unavailable()
		}
		_, err = db.Collection(Collection).UpdateOne(ctx, bson.M{
			"_id": raw, "ownerId": ownerID, "elonId": id, "removedAt": bson.M{"$exists": false},
		}, bson.M{"$setOnInsert": bson.M{"ownerId": ownerID, "elonId": id, "createdAt": time.Now().UTC()}}, options.Update().SetUpsert(true))
		if mongo.IsDuplicateKeyError(err) {
			return unavailable()
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func unavailable() error {
	return httpx.NewError(409, "image_unavailable", "rasm olib tashlangan yoki boshqa e'longa tegishli; yangi rasm yuklang")
}

func listingKey(s *storage.Service, raw string, ownerID primitive.ObjectID) bool {
	if s == nil || ownerID.IsZero() {
		return false
	}
	key := s.KeyFromURL(raw)
	return strings.HasPrefix(key, "elons/") && s.KeyBelongsToUser(key, ownerID.Hex())
}

// Delete first fences new attachments, then removes an owned, unshared file.
// Legacy external/avatar/cross-owner/shared references are only detached.
// Storage failures are returned so the caller keeps its durable retry source.
func Delete(ctx context.Context, db *mongo.Database, s *storage.Service, id, ownerID primitive.ObjectID, raw string, at time.Time) error {
	return remove(ctx, db, s, id, ownerID, raw, at, false)
}

// DeleteForOwner is used only when all this account's listings are being
// erased together, so sharing between those listings must not orphan a file.
func DeleteForOwner(ctx context.Context, db *mongo.Database, s *storage.Service, ownerID primitive.ObjectID, raw string, at time.Time) error {
	return remove(ctx, db, s, primitive.NilObjectID, ownerID, raw, at, true)
}

func remove(ctx context.Context, db *mongo.Database, s *storage.Service, id, ownerID primitive.ObjectID, raw string, at time.Time, wholeOwner bool) error {
	if raw == "" {
		return nil
	}
	if s == nil {
		return errors.New("listing image cleanup unavailable")
	}
	if !listingKey(s, raw, ownerID) {
		return nil
	}
	asset := bson.M{"_id": raw, "ownerId": ownerID}
	references := bson.M{"images": raw}
	if wholeOwner {
		references["ownerId"] = bson.M{"$ne": ownerID}
	} else {
		asset["elonId"] = id
		references["_id"] = bson.M{"$ne": id}
	}
	_, err := db.Collection(Collection).UpdateOne(ctx, asset, bson.M{
		"$set": bson.M{"removedAt": at}, "$setOnInsert": bson.M{"ownerId": ownerID, "elonId": id, "createdAt": at},
	}, options.Update().SetUpsert(true))
	// A different listing reserved the file before cleanup. It owns it now.
	if mongo.IsDuplicateKeyError(err) {
		return nil
	}
	if err != nil {
		return err
	}
	n, err := db.Collection("elons").CountDocuments(ctx, references)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return s.Delete(ctx, s.KeyFromURL(raw))
}
