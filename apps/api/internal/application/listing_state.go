package application

import (
	"context"
	"errors"
	"time"

	"github.com/ishchibormi/backend/internal/elon"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// An owner closes the listing before its durable candidate cleanup runs. An
// accepted row left during that interval must not become completed history.
func (h *Handler) checkCompletionListing(ctx context.Context, id primitive.ObjectID) error {
	err := h.Elons.FindOne(ctx, bson.M{
		"_id": id, "isDeleted": bson.M{"$ne": true}, "status": bson.M{"$ne": "cancelled"},
	}).Err()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return httpx.NewError(409, "listing_closed", "Ish yopilgan. Uni yakunlangan deb tasdiqlab bo'lmaydi.")
	}
	return err
}

// Acceptance/cancellation must not resurrect a listing which the owner closed
// after the application's slot reservation was read.
func filledListingFilter(id primitive.ObjectID) bson.M {
	return bson.M{
		"_id": id, "status": "recruiting", "isDeleted": bson.M{"$ne": true},
		"$expr": bson.M{"$gte": bson.A{"$acceptedCount", "$workersNeeded"}},
	}
}

func reopenedListingFilter(id primitive.ObjectID) bson.M {
	return bson.M{
		"_id": id, "status": "filled", "isDeleted": bson.M{"$ne": true},
		"$expr": bson.M{"$lt": bson.A{"$acceptedCount", "$workersNeeded"}},
	}
}

// Owner closure commits on the listing before sweeping its applications. An
// Apply already in flight may insert after that sweep: its post-write check
// closes that last window without requiring a replica-set transaction.
func (h *Handler) recheckAppliedListing(ctx context.Context, a *models.Application) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	reconciler := elon.Handler{Col: h.Elons, Applications: h.Apps, Notify: h.Notify}
	return reconciler.RecheckApplication(ctx, a)
}
