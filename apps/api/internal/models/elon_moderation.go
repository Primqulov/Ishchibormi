package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ElonOwnerSnapshot is captured once at publication. It is only returned by
// the administrator detail endpoint, never by the public listing API.
type ElonOwnerSnapshot struct {
	Name      string `bson:"name" json:"name"`
	Phone     string `bson:"phone" json:"phone"`
	AvatarURL string `bson:"avatarUrl" json:"avatarUrl"`
	Region    string `bson:"region" json:"region"`
	District  string `bson:"district" json:"district"`
	Complete  bool   `bson:"complete" json:"complete"`
}

// ElonModerationJob is written atomically with the listing change. Retries
// remove detached images and persist the audit/owner notification even if the
// original request disconnects. Each side effect uses the stable event ID.
type ElonModerationJob struct {
	ID            primitive.ObjectID `bson:"id"`
	AdminID       primitive.ObjectID `bson:"adminId"`
	Action        string             `bson:"action"`
	Kind          string             `bson:"kind"`
	FromStatus    string             `bson:"fromStatus"`
	Status        string             `bson:"status"`
	Detail        string             `bson:"detail"`
	Reason        string             `bson:"reason,omitempty"`
	NotifyOwner   bool               `bson:"notifyOwner"`
	Title         string             `bson:"title"`
	Images        []string           `bson:"images,omitempty"`
	CreatedAt     time.Time          `bson:"createdAt"`
	AuditDone     bool               `bson:"auditDone"`
	StorageDone   bool               `bson:"storageDone"`
	NotifyDone    bool               `bson:"notifyDone"`
	NextAttemptAt time.Time          `bson:"nextAttemptAt"`
	LeaseUntil    *time.Time         `bson:"leaseUntil,omitempty"`
}

// ElonPurgeEvent survives final deletion until its audit is durably recorded.
type ElonPurgeEvent struct {
	ID            primitive.ObjectID `bson:"_id"`
	ElonID        primitive.ObjectID `bson:"elonId"`
	AdminID       primitive.ObjectID `bson:"adminId"`
	CreatedAt     time.Time          `bson:"createdAt"`
	NextAttemptAt time.Time          `bson:"nextAttemptAt"`
}
