package moderation

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const AuditActionBan = "moderation_ban"

// Pending state belongs to the strike record and is never sent to clients.
// Retaining the previous known snapshot also lets a failed history write be
// retried after enforcement has already replaced the user's current fields.
type pendingBan struct {
	UserID   primitive.ObjectID `bson:"userId"`
	At       time.Time          `bson:"at"`
	Until    time.Time          `bson:"until"`
	Reason   string             `bson:"reason"`
	Previous *banSnapshot       `bson:"previous,omitempty"`
	Retained []retainedBan      `bson:"retained,omitempty"`
}

type banSnapshot struct {
	At     time.Time  `bson:"at"`
	Until  *time.Time `bson:"until,omitempty"`
	Reason string     `bson:"reason"`
}

type retainedBan struct {
	UserID   primitive.ObjectID `bson:"userId"`
	Snapshot banSnapshot        `bson:"snapshot"`
}

func (p *pendingBan) snapshots() []retainedBan {
	if p == nil {
		return nil
	}
	out := append([]retainedBan{}, p.Retained...)
	if p.Previous != nil {
		out = append(out, retainedBan{UserID: p.UserID, Snapshot: *p.Previous})
	}
	return append(out, retainedBan{UserID: p.UserID, Snapshot: banSnapshot{
		At: p.At, Until: &p.Until, Reason: p.Reason,
	}})
}

// History-only recovery: it never updates users, listings, or a ban deadline.
// In particular, the target is the id saved with the claim, not whoever owns
// the strike record's phone number when recovery happens.
func (s *StrikeStore) flushPendingBanHistory(ctx context.Context, pending *pendingBan) error {
	var writeErrors []error
	for _, saved := range pending.snapshots() {
		if saved.UserID.IsZero() || saved.Snapshot.At.IsZero() ||
			(saved.Snapshot.Until != nil && saved.Snapshot.Until.IsZero()) {
			writeErrors = append(writeErrors, errors.New("moderation: pending ban identity or start missing"))
			continue
		}
		if err := RecordBanHistory(ctx, s.audit, saved.Snapshot.user(saved.UserID)); err != nil {
			writeErrors = append(writeErrors, err)
		}
	}
	return errors.Join(writeErrors...)
}

func knownBanSnapshot(u *models.User) *banSnapshot {
	if u == nil || u.BlockSource != BlockSourceModeration ||
		u.BlockedAt == nil || u.BlockedAt.IsZero() {
		return nil
	}
	return &banSnapshot{At: *u.BlockedAt, Until: u.ModerationBannedUntil, Reason: u.BlockReason}
}

func (b *banSnapshot) user(id primitive.ObjectID) *models.User {
	if b == nil {
		return nil
	}
	return &models.User{
		ID: id, BlockSource: BlockSourceModeration, BlockedAt: &b.At,
		BlockReason: b.Reason, ModerationBannedUntil: b.Until,
	}
}

// RecordBanHistory retains a known automatic ban before its current fields
// are replaced or cleared. Old bans with no recorded start are not invented.
// The existing audit collection remains the source of account status history.
func RecordBanHistory(ctx context.Context, audit *mongo.Collection, u *models.User) error {
	if audit == nil || u == nil || u.ID.IsZero() ||
		u.BlockSource != BlockSourceModeration || u.BlockedAt == nil || u.BlockedAt.IsZero() {
		return nil
	}

	// Mongo dates have millisecond precision. A stable id makes retries and
	// concurrent preservation of the same snapshot idempotent without a
	// new index or a migration.
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%d", AuditActionBan, u.ID.Hex(), u.BlockedAt.UnixMilli())))
	var id primitive.ObjectID
	copy(id[:], digest[:len(id)])
	_, err := audit.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$setOnInsert": models.AdminAudit{
		ID: id, Action: AuditActionBan, Target: u.ID.Hex(), Detail: u.BlockReason,
		CreatedAt: *u.BlockedAt, Until: u.ModerationBannedUntil,
	}}, options.Update().SetUpsert(true))
	if mongo.IsDuplicateKeyError(err) {
		return nil
	}
	return err
}
