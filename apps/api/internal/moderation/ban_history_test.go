package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestAutomaticBanHistorySurvivesLift(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 1, 24*time.Hour)
	uid := seedUser(t, db, "+998901115501")
	if _, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH"); err != nil {
		t.Fatal(err)
	}
	var before models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&before); err != nil {
		t.Fatal(err)
	}
	if err := store.LiftBanByUser(ctx, uid); err != nil {
		t.Fatal(err)
	}
	var after models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&after); err != nil {
		t.Fatal(err)
	}
	if after.ModerationBannedUntil != nil || after.BlockedAt != nil || after.BlockReason != "" {
		t.Fatalf("current ban fields were not cleared: %+v", after)
	}
	var audit models.AdminAudit
	filter := bson.M{"action": AuditActionBan, "target": uid.Hex()}
	if err := store.audit.FindOne(ctx, filter).Decode(&audit); err != nil {
		t.Fatal(err)
	}
	if before.BlockedAt == nil || !audit.CreatedAt.Equal(*before.BlockedAt) ||
		audit.Detail != before.BlockReason || audit.Until == nil ||
		!audit.Until.Equal(*before.ModerationBannedUntil) {
		t.Fatalf("original reason/start/deadline were not retained: %+v", audit)
	}
	if n, err := store.audit.CountDocuments(ctx, filter); err != nil || n != 1 {
		t.Fatalf("ban was duplicated while lifting: count=%d error=%v", n, err)
	}
}

func TestRecordBanHistoryIsIdempotent(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901115502")
	at := time.Date(2026, 3, 1, 9, 0, 0, 123456789, time.UTC)
	until := at.Add(24 * time.Hour)
	u := models.User{
		ID: uid, BlockSource: BlockSourceModeration, BlockedAt: &at,
		BlockReason: "Nomaqbul e'lon matni", ModerationBannedUntil: &until,
	}
	audit := db.Collection("admin_audit")
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < cap(errs); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- RecordBanHistory(ctx, audit, &u)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	// Reading the same snapshot from Mongo truncates sub-millisecond data.
	at = at.Truncate(time.Millisecond)
	if err := RecordBanHistory(ctx, audit, &u); err != nil {
		t.Fatal(err)
	}
	if n, err := audit.CountDocuments(ctx, bson.M{"target": uid.Hex()}); err != nil || n != 1 {
		t.Fatalf("repeated preservation created %d records: %v", n, err)
	}
}

func TestRecordBanHistoryDoesNotInventUnknownLegacyStart(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	uid := seedUser(t, db, "+998901115503")
	until := time.Now().Add(time.Hour)
	u := models.User{
		ID: uid, BlockSource: BlockSourceModeration, ModerationBannedUntil: &until,
	}
	audit := db.Collection("admin_audit")
	if err := RecordBanHistory(ctx, audit, &u); err != nil {
		t.Fatal(err)
	}
	if n, err := audit.CountDocuments(ctx, bson.M{"target": uid.Hex()}); err != nil || n != 0 {
		t.Fatalf("unknown start produced a historical event: %d, %v", n, err)
	}
}

func TestConcurrentStrikesRecordOneAutomaticBan(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 1, 24*time.Hour)
	const phone = "+998901115504"
	uid := seedUser(t, db, phone)
	// Start from an existing strike record so this test exercises the ban
	// claim, independently of the production phone index's upsert behavior.
	if _, err := store.col.InsertOne(ctx, bson.M{"phone": phone, "strikes": 0}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < cap(errs); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	filter := bson.M{"action": AuditActionBan, "target": uid.Hex()}
	if n, err := store.audit.CountDocuments(ctx, filter); err != nil || n != 1 {
		t.Fatalf("concurrent strikes created %d bans: %v", n, err)
	}
	var u models.User
	var ban models.AdminAudit
	var strikes StrikeRecord
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if err := store.audit.FindOne(ctx, filter).Decode(&ban); err != nil {
		t.Fatal(err)
	}
	if err := store.col.FindOne(ctx, bson.M{"phone": phone}).Decode(&strikes); err != nil {
		t.Fatal(err)
	}
	if u.ModerationBannedUntil == nil || ban.Until == nil || strikes.BannedUntil == nil ||
		!u.ModerationBannedUntil.Equal(*ban.Until) || !ban.Until.Equal(*strikes.BannedUntil) {
		t.Fatal("user, strike record and history disagree on the deadline")
	}
}

func TestAuditFailureStillEnforcesBanAndRetriesOriginalClaim(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 1, 24*time.Hour)
	uid := seedUser(t, db, "+998901115505")
	oldUntil := time.Now().Add(-24 * time.Hour).Truncate(time.Millisecond)
	oldAt := oldUntil.Add(-7 * 24 * time.Hour)
	if _, err := store.users.UpdateOne(ctx, bson.M{"_id": uid}, bson.M{"$set": bson.M{
		"blockSource": BlockSourceModeration, "blockReason": "Old known ban",
		"blockedAt": oldAt, "moderationBannedUntil": oldUntil,
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.elons.InsertOne(ctx, bson.M{"ownerId": uid, "ownerBlocked": false}); err != nil {
		t.Fatal(err)
	}
	// Reject only audit writes, leaving both enforcement collections healthy.
	// The first rejected write is preservation of the previous legacy ban.
	if err := db.CreateCollection(ctx, "admin_audit", options.CreateCollection().SetValidator(
		bson.M{"action": bson.M{"$ne": AuditActionBan}},
	)); err != nil {
		t.Fatal(err)
	}
	first, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH")
	if err == nil || first == nil || !first.Banned(time.Now()) || first.PendingBan == nil {
		t.Fatalf("expected a claimed, retryable ban despite audit error: rec=%+v error=%v", first, err)
	}
	var blocked models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&blocked); err != nil {
		t.Fatal(err)
	}
	if blocked.ModerationBannedUntil == nil || !blocked.ModerationBannedUntil.Equal(*first.BannedUntil) ||
		blocked.BlockedAt == nil || !blocked.BlockedAt.Equal(first.PendingBan.At) ||
		blocked.BlockReason != AutoBanReason(1) {
		t.Fatalf("audit failure bypassed user enforcement: %+v", blocked)
	}
	var listing struct {
		OwnerBlocked bool `bson:"ownerBlocked"`
	}
	if err := store.elons.FindOne(ctx, bson.M{"ownerId": uid}).Decode(&listing); err != nil {
		t.Fatal(err)
	}
	if !listing.OwnerBlocked {
		t.Fatal("audit failure left the user's listing public")
	}
	encoded, err := json.Marshal(first)
	if err != nil || bytes.Contains(encoded, []byte("pendingBan")) || bytes.Contains(encoded, []byte("Old known ban")) {
		t.Fatalf("private retry metadata reached the response: %s (%v)", encoded, err)
	}
	if err := db.RunCommand(ctx, bson.D{
		{Key: "collMod", Value: "admin_audit"}, {Key: "validator", Value: bson.M{}},
	}).Err(); err != nil {
		t.Fatal(err)
	}
	second, err := store.RecordByUser(ctx, uid, KindAvatar, "SEXUAL=HIGH")
	if err != nil {
		t.Fatal(err)
	}
	if second.PendingBan != nil || second.BannedUntil == nil || !second.BannedUntil.Equal(*first.BannedUntil) {
		t.Fatalf("retry extended or left the claim pending: %+v", second)
	}
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&blocked); err != nil {
		t.Fatal(err)
	}
	if blocked.BlockedAt == nil || !blocked.BlockedAt.Equal(first.PendingBan.At) || blocked.BlockReason != AutoBanReason(1) {
		t.Fatalf("retry changed the original start/reason: %+v", blocked)
	}
	var saved StrikeRecord
	if err := store.col.FindOne(ctx, bson.M{"_id": first.ID}).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.PendingBan != nil {
		t.Fatal("successful retry did not clear persisted pending state")
	}
	filter := bson.M{"action": AuditActionBan, "target": uid.Hex()}
	if n, err := store.audit.CountDocuments(ctx, filter); err != nil || n != 2 {
		t.Fatalf("retry must retain the old and new ban exactly once: %d, %v", n, err)
	}
	var old, current models.AdminAudit
	if err := store.audit.FindOne(ctx, bson.M{"target": uid.Hex(), "createdAt": oldAt}).Decode(&old); err != nil {
		t.Fatal(err)
	}
	if old.Detail != "Old known ban" || old.Until == nil || !old.Until.Equal(oldUntil) {
		t.Fatalf("legacy snapshot was lost when enforcement replaced it: %+v", old)
	}
	if err := store.audit.FindOne(ctx, bson.M{"target": uid.Hex(), "createdAt": first.PendingBan.At}).Decode(&current); err != nil {
		t.Fatal(err)
	}
	if current.Detail != AutoBanReason(1) || current.Until == nil || !current.Until.Equal(*first.BannedUntil) {
		t.Fatalf("retry changed the recorded reason/deadline: %+v", current)
	}
}

func TestExpiredPendingBanIsClearedWithoutReapplication(t *testing.T) {
	db := strikeDB(t)
	ctx := context.Background()
	store := NewStrikeStore(db, 3, 24*time.Hour)
	const phone = "+998901115506"
	uid := seedUser(t, db, phone)
	until := time.Now().Add(-time.Hour).Truncate(time.Millisecond)
	at := until.Add(-24 * time.Hour)
	if _, err := store.col.InsertOne(ctx, StrikeRecord{
		Phone: phone, Strikes: 3, BannedUntil: &until,
		PendingBan: &pendingBan{UserID: uid, At: at, Until: until, Reason: AutoBanReason(3)},
	}); err != nil {
		t.Fatal(err)
	}
	if _, banned, err := store.BanByPhone(ctx, phone); err != nil || banned {
		t.Fatalf("expired claim blocked login: banned=%v error=%v", banned, err)
	}
	rec, err := store.RecordByUser(ctx, uid, KindElon, "HATE=HIGH")
	if err != nil {
		t.Fatal(err)
	}
	if rec.Strikes != 1 || rec.BannedUntil != nil || rec.PendingBan != nil {
		t.Fatalf("expired retry state became a fresh punishment: %+v", rec)
	}
	var user models.User
	if err := store.users.FindOne(ctx, bson.M{"_id": uid}).Decode(&user); err != nil {
		t.Fatal(err)
	}
	if user.ModerationBannedUntil != nil || user.BlockedAt != nil {
		t.Fatalf("expired claim was applied to the user: %+v", user)
	}
}
