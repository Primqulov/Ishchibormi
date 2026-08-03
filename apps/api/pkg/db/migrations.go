package db

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// migration is a one-time, ordered data/schema change.
//
// Unlike EnsureIndexes (idempotent, safe to run on every boot) or
// category.EnsureDefaults (a business reconciliation that intentionally runs
// each deploy), a migration runs EXACTLY ONCE: after it succeeds its ID is
// recorded in the schema_migrations collection and skipped on every subsequent
// boot. This keeps boot time flat as data grows — a backfill that scans the
// whole collection no longer re-executes forever.
type migration struct {
	ID  string
	Run func(ctx context.Context, db *mongo.Database) error
}

// migrations is the ordered registry. Append new entries at the end; never
// renumber or reorder existing ones — the ID is the applied-marker key.
var migrations = []migration{
	{ID: "0001_backfill_elon_owner_avatars", Run: BackfillElonOwnerAvatars},
}

// RunMigrations applies every not-yet-applied migration in order and records
// each success in schema_migrations. A migration that ERRORS is not recorded,
// so it is retried on the next boot. Already-applied migrations are skipped
// with a single cheap _id lookup.
func RunMigrations(ctx context.Context, db *mongo.Database) error {
	col := db.Collection("schema_migrations")
	for _, m := range migrations {
		n, err := col.CountDocuments(ctx, bson.M{"_id": m.ID})
		if err != nil {
			return err
		}
		if n > 0 {
			continue // already applied
		}
		if err := m.Run(ctx, db); err != nil {
			return err
		}
		if _, err := col.InsertOne(ctx, bson.M{"_id": m.ID, "appliedAt": time.Now()}); err != nil {
			return err
		}
	}
	return nil
}
