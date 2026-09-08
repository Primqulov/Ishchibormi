package moderation

import (
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestAdminLiftFlushesFailedHistoryWithoutAnotherStrike(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 1, 24*time.Hour)
	uid := seedUser(t, db, "+998901115507")
	oldUntil := time.Now().Add(-24 * time.Hour).Truncate(time.Millisecond)
	oldAt := oldUntil.Add(-7 * 24 * time.Hour)
	if _, err := store.users.UpdateOne(ctx, bson.M{"_id": uid}, bson.M{"$set": bson.M{
		"blockSource": BlockSourceModeration, "blockReason": "Previous known ban",
		"blockedAt": oldAt, "moderationBannedUntil": oldUntil,
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.elons.InsertOne(ctx, bson.M{"ownerId": uid, "ownerBlocked": false}); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateCollection(ctx, "admin_audit", options.CreateCollection().SetValidator(
		bson.M{"action": bson.M{"$ne": AuditActionBan}},
	)); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH")
	if err == nil || claimed == nil || claimed.PendingBan == nil {
		t.Fatalf("audit failure did not retain snapshots: %+v %v", claimed, err)
	}
	if err := db.RunCommand(ctx, bson.D{
		{Key: "collMod", Value: "admin_audit"}, {Key: "validator", Value: bson.M{}},
	}).Err(); err != nil {
		t.Fatal(err)
	}
	// Blocked users cannot submit another strike. Both admin routes call
	// this lift, which must flush snapshots before deleting their only copy.
	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if n, err := store.col.CountDocuments(ctx, bson.M{"_id": claimed.ID}); err != nil || n != 0 {
		t.Fatalf("lift did not clear the strike record: %d %v", n, err)
	}
	if n, err := store.audit.CountDocuments(ctx, bson.M{"target": uid.Hex()}); err != nil || n != 2 {
		t.Fatalf("lift lost or duplicated a pending snapshot: %d %v", n, err)
	}
	var old, current models.AdminAudit
	if err := store.audit.FindOne(ctx, bson.M{"target": uid.Hex(), "createdAt": oldAt}).Decode(&old); err != nil {
		t.Fatal(err)
	}
	if old.Detail != "Previous known ban" || old.Until == nil || !old.Until.Equal(oldUntil) {
		t.Fatalf("legacy snapshot changed: %+v", old)
	}
	if err := store.audit.FindOne(ctx, bson.M{"target": uid.Hex(), "createdAt": claimed.PendingBan.At}).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.Detail != claimed.PendingBan.Reason || current.Until == nil || !current.Until.Equal(*claimed.BannedUntil) {
		t.Fatalf("claimed ban snapshot changed: %+v", current)
	}
	var user models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&user); err != nil {
		t.Fatal(err)
	}
	if user.ModerationBannedUntil != nil || user.BlockedAt != nil {
		t.Fatal("history recovery replayed enforcement during lift")
	}
	if n, err := store.elons.CountDocuments(ctx, bson.M{"ownerId": uid, "ownerBlocked": true}); err != nil || n != 0 {
		t.Fatalf("history recovery reblocked listings: %d %v", n, err)
	}
}

func TestExpiryRetainsFailedHistoryAndFlushesToOriginalUser(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 1, 24*time.Hour)
	const phone = "+998901115508"
	originalID := primitive.NewObjectID()
	newID := seedUser(t, db, phone)
	until := time.Now().Add(-time.Hour).Truncate(time.Millisecond)
	at := until.Add(-24 * time.Hour)
	previousUntil := at.Add(-24 * time.Hour)
	pending := pendingBan{
		UserID: originalID, At: at, Until: until, Reason: "Original account ban",
		Previous: &banSnapshot{At: previousUntil.Add(-24 * time.Hour), Until: &previousUntil, Reason: "Earlier ban"},
	}
	if _, err := store.col.InsertOne(ctx, StrikeRecord{
		Phone: phone, Strikes: 3, BannedUntil: &until, PendingBan: &pending,
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateCollection(ctx, "admin_audit", options.CreateCollection().SetValidator(
		bson.M{"action": bson.M{"$ne": AuditActionBan}},
	)); err != nil {
		t.Fatal(err)
	}
	if _, banned, err := store.BanByPhone(ctx, phone); err != nil || banned {
		t.Fatalf("history failure kept an expired ban active: %v %v", banned, err)
	}
	var retained StrikeRecord
	if err := store.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&retained); err != nil {
		t.Fatal(err)
	}
	if retained.BannedUntil != nil || retained.Strikes != 0 || retained.PendingBan == nil ||
		retained.PendingBan.UserID != originalID || !retained.PendingBan.Until.Equal(until) {
		t.Fatalf("expiry lost history or kept enforcement active: %+v", retained)
	}
	if err := db.RunCommand(ctx, bson.D{
		{Key: "collMod", Value: "admin_audit"}, {Key: "validator", Value: bson.M{}},
	}).Err(); err != nil {
		t.Fatal(err)
	}
	if _, banned, err := store.BanByPhone(ctx, phone); err != nil || banned {
		t.Fatalf("history recovery replayed the expired ban: %v %v", banned, err)
	}
	// Decode into a fresh value: omitted BSON fields must not retain the
	// previous in-memory struct's pointer.
	retained = StrikeRecord{}
	if err := store.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&retained); err != nil {
		t.Fatal(err)
	}
	if retained.PendingBan != nil || retained.BannedUntil != nil {
		t.Fatal("successful history-only recovery did not clear pending metadata")
	}
	if n, err := store.audit.CountDocuments(ctx, bson.M{"target": originalID.Hex()}); err != nil || n != 2 {
		t.Fatalf("old events lost their original target: %d %v", n, err)
	}
	if n, err := store.audit.CountDocuments(ctx, bson.M{"target": newID.Hex()}); err != nil || n != 0 {
		t.Fatalf("old phone history was attributed to the new account: %d %v", n, err)
	}
	var original models.AdminAudit
	if err := store.audit.FindOne(ctx, bson.M{"target": originalID.Hex(), "createdAt": at}).Decode(&original); err != nil {
		t.Fatal(err)
	}
	if original.Until == nil || !original.Until.Equal(until) || original.Detail != pending.Reason {
		t.Fatalf("expiry changed the original deadline/reason: %+v", original)
	}
	var user models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": newID}).Decode(&user); err != nil {
		t.Fatal(err)
	}
	if user.ModerationBannedUntil != nil || user.BlockedAt != nil {
		t.Fatal("history recovery applied the old account's ban to the new user")
	}
}
