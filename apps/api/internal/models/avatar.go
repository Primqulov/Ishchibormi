package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// AvatarMetadata describes the exact stored upload. Unknown fields are omitted
// for legacy files; an unchecked image is never reported as moderation-clean.
type AvatarMetadata struct {
	URL                  string     `bson:"url" json:"url"`
	Width                int        `bson:"width,omitempty" json:"width,omitempty"`
	Height               int        `bson:"height,omitempty" json:"height,omitempty"`
	SizeBytes            int64      `bson:"sizeBytes,omitempty" json:"sizeBytes,omitempty"`
	ContentType          string     `bson:"contentType,omitempty" json:"contentType,omitempty"`
	UploadedAt           *time.Time `bson:"uploadedAt,omitempty" json:"uploadedAt,omitempty"`
	ModerationStatus     string     `bson:"moderationStatus" json:"moderationStatus"`
	ModerationReason     string     `bson:"moderationReason,omitempty" json:"moderationReason,omitempty"`
	ModerationReasonCode string     `bson:"moderationReasonCode,omitempty" json:"moderationReasonCode,omitempty"`
}

// AvatarUpload uses the immutable generated URL as its document ID. The
// deletion tombstone prevents a client from reattaching a moderated-away file.
type AvatarUpload struct {
	ID        string             `bson:"_id"`
	UserID    primitive.ObjectID `bson:"userId"`
	Metadata  AvatarMetadata     `bson:"metadata"`
	DeletedAt *time.Time         `bson:"deletedAt,omitempty"`
}

// AvatarDeletionJob is written atomically with avatarUrl=null on the user.
// Storage, audit and notification retries therefore survive a process crash.
// It is private server state and must never be serialised in a user response.
type AvatarDeletionJob struct {
	ID            primitive.ObjectID `bson:"id"`
	AdminID       primitive.ObjectID `bson:"adminId"`
	URL           string             `bson:"url"`
	Reason        string             `bson:"reason"`
	Comment       string             `bson:"comment,omitempty"`
	CreatedAt     time.Time          `bson:"createdAt"`
	StorageDone   bool               `bson:"storageDone"`
	StorageStatus string             `bson:"storageStatus,omitempty"`
	AuditDone     bool               `bson:"auditDone"`
	PushDone      bool               `bson:"pushDone"`
	LeaseUntil    *time.Time         `bson:"leaseUntil,omitempty"`
	NextAttemptAt *time.Time         `bson:"nextAttemptAt,omitempty"`
}
