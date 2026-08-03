package application

import (
	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// This file holds the PURE decision rules of the application state machine —
// the slot math, role checks and completion/cancel guards that are otherwise
// easy to get subtly wrong and impossible to unit-test when buried inside
// Mongo-coupled handlers. The handlers (handler.go) delegate to these so the
// rules can be exercised in isolation (transitions_test.go).

// slotsRemaining returns the number of still-open worker slots on an elon,
// clamped at 0 — an over-filled elon reports 0, never a negative count.
func slotsRemaining(workersNeeded, acceptedCount int) int {
	r := workersNeeded - acceptedCount
	if r < 0 {
		return 0
	}
	return r
}

// hasEnoughSlots reports whether an application for `people` workers still fits
// in the elon. workersNeeded <= 0 means "unbounded" (no cap) and always fits.
func hasEnoughSlots(workersNeeded, acceptedCount, people int) bool {
	if workersNeeded <= 0 {
		return true
	}
	return people <= slotsRemaining(workersNeeded, acceptedCount)
}

// peopleOf normalizes an application's PeopleCount to at least 1: a (group)
// application always counts as one worker even if the field was left 0.
func peopleOf(a models.Application) int {
	if a.PeopleCount < 1 {
		return 1
	}
	return a.PeopleCount
}

// actorRole classifies a user against an application: "worker", "employer", or
// "" when the user is neither party (and thus not authorized to act on it).
func actorRole(a models.Application, uid primitive.ObjectID) string {
	switch uid {
	case a.WorkerID:
		return "worker"
	case a.EmployerID:
		return "employer"
	default:
		return ""
	}
}

// otherParty returns the counterparty of `uid` in an application: the employer
// when the caller is the worker, otherwise the worker.
func otherParty(a models.Application, uid primitive.ObjectID) primitive.ObjectID {
	if uid == a.EmployerID {
		return a.WorkerID
	}
	return a.EmployerID
}

// canCancel reports whether an application in the given status may be cancelled.
// Only live applications — still pending or already accepted — can be cancelled;
// terminal states (rejected/cancelled/completed) cannot.
func canCancel(status string) bool {
	return status == "pending" || status == "accepted"
}

// bothConfirmed reports whether both parties have confirmed completion, the
// condition that flips an accepted application to "completed".
func bothConfirmed(a models.Application) bool {
	return a.EmployerConfirmedDone && a.WorkerConfirmedDone
}
