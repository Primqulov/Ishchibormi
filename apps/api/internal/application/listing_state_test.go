package application

import (
	"context"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestOwnerClosureWinsAgainstLateApplicationAndSlotChanges(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://127.0.0.1:27017"))
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		cancel()
		_ = client.Disconnect(context.Background())
		t.Skipf("local Mongo unavailable: %v", err)
	}
	cancel()
	db := client.Database("ib_listing_state_test_" + primitive.NewObjectID().Hex())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Drop(ctx)
		_ = client.Disconnect(ctx)
	})
	h := &Handler{Elons: db.Collection("elons"), Apps: db.Collection("applications")}
	e := models.Elon{
		ID: primitive.NewObjectID(), OwnerID: primitive.NewObjectID(), Status: "cancelled",
		CancelReason: "Material yetib kelmadi", WorkersNeeded: 2, AcceptedCount: 2,
	}
	ctx = context.Background()
	if _, err := h.Elons.InsertOne(ctx, e); err != nil {
		t.Fatal(err)
	}
	// The owner has already closed the listing and finished scanning candidates;
	// an Apply whose original read saw recruiting now inserts its pending row.
	a := models.Application{
		ID: primitive.NewObjectID(), ElonID: e.ID, EmployerID: e.OwnerID,
		WorkerID: primitive.NewObjectID(), Status: "pending",
	}
	if _, err := h.Apps.InsertOne(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := h.recheckAppliedListing(ctx, &a); err == nil {
		t.Fatal("late Apply succeeded after the owner closed the listing")
	}
	var got models.Application
	if err := h.Apps.FindOne(ctx, bson.M{"_id": a.ID}).Decode(&got); err != nil {
		t.Fatal("late application history was removed", err)
	}
	if got.Status != "cancelled" || got.CancelReason != e.CancelReason || got.CancelledBy != "employer" {
		t.Fatalf("late application stayed open: %+v", got)
	}
	// A stale acceptance must not change cancelled -> filled, and a stale
	// worker cancellation must not change cancelled -> recruiting.
	for _, f := range []bson.M{filledListingFilter(e.ID), reopenedListingFilter(e.ID)} {
		res, err := h.Elons.UpdateOne(ctx, f, bson.M{"$set": bson.M{"status": "recruiting"}})
		if err != nil || res.MatchedCount != 0 {
			t.Fatalf("stale application operation reopened archived work: %v %+v", err, res)
		}
	}
}
