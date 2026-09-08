package application

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func completionTestHandler(t *testing.T) (*Handler, models.Elon, models.Application) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI("mongodb://127.0.0.1:27017"))
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		t.Skipf("local Mongo unavailable: %v", err)
	}
	db := client.Database("ib_completion_owner_test_" + primitive.NewObjectID().Hex())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Drop(ctx)
		_ = client.Disconnect(ctx)
	})
	h := NewHandler(db, notification.New(db))
	e := models.Elon{
		ID: primitive.NewObjectID(), OwnerID: primitive.NewObjectID(), Status: "filled",
		StartDate: "2026-01-01", WorkTimeFrom: "09:00", AcceptedCount: 1, WorkersNeeded: 1,
	}
	a := models.Application{
		ID: primitive.NewObjectID(), ElonID: e.ID, EmployerID: e.OwnerID,
		WorkerID: primitive.NewObjectID(), Status: "accepted", EmployerConfirmedDone: true,
	}
	if _, err := h.Elons.InsertOne(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Apps.InsertOne(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Users.InsertMany(context.Background(), []any{
		models.User{ID: a.WorkerID}, models.User{ID: a.EmployerID},
	}); err != nil {
		t.Fatal(err)
	}
	return h, e, a
}

func completionRequest(a models.Application) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/applications/"+a.ID.Hex()+"/confirm-done", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", a.ID.Hex())
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, httpx.CtxUserID, a.WorkerID.Hex())
	return r.WithContext(ctx)
}

func assertCompletionEffects(t *testing.T, h *Handler, a models.Application, completed bool) {
	t.Helper()
	ctx := context.Background()
	var got models.Application
	if err := h.Apps.FindOne(ctx, bson.M{"_id": a.ID}).Decode(&got); err != nil {
		t.Fatal(err)
	}
	wantStatus, wantCount, wantNotifications := "accepted", 0, int64(0)
	if completed {
		wantStatus, wantCount, wantNotifications = "completed", 1, 2
	}
	if got.Status != wantStatus || (!completed && (got.CompletedAt != nil || got.WorkerConfirmedDone)) {
		t.Fatalf("unexpected application completion: %+v", got)
	}
	for _, id := range []primitive.ObjectID{a.WorkerID, a.EmployerID} {
		var u models.User
		if err := h.Users.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
			t.Fatal(err)
		}
		if u.CompletedJobsCount != wantCount {
			t.Fatalf("completedJobsCount=%d, want %d", u.CompletedJobsCount, wantCount)
		}
	}
	if n, err := h.Notify.Col.CountDocuments(ctx, bson.M{}); err != nil || n != wantNotifications {
		t.Fatalf("notifications=%d, want %d, err=%v", n, wantNotifications, err)
	}
}

func TestOwnerClosedListingCannotCompleteWhileCleanupPending(t *testing.T) {
	for _, action := range []string{"confirm", "auto"} {
		for _, closure := range []string{"cancelled", "deleted", "missing"} {
			t.Run(action+"/"+closure, func(t *testing.T) {
				h, e, a := completionTestHandler(t)
				ctx := context.Background()
				// The accepted application and scheduler snapshot predate closure;
				// its durable cancellation cleanup has not yet reached this row.
				set := bson.M{"status": "cancelled", "ownerFollowupPending": true}
				if closure == "deleted" {
					set = bson.M{"isDeleted": true}
				}
				var err error
				if closure == "missing" {
					_, err = h.Elons.DeleteOne(ctx, bson.M{"_id": e.ID})
				} else {
					_, err = h.Elons.UpdateOne(ctx, bson.M{"_id": e.ID}, bson.M{"$set": set})
				}
				if err != nil {
					t.Fatal(err)
				}
				if action == "confirm" {
					w := httptest.NewRecorder()
					h.ConfirmDone(w, completionRequest(a))
					if w.Code != 409 || !strings.Contains(w.Body.String(), "listing_closed") {
						t.Fatalf("closed listing confirmation: %d %s", w.Code, w.Body.String())
					}
				} else {
					// Directly exercise the write boundary with a stale accepted row.
					h.completeAuto(ctx, a, time.Now())
				}
				assertCompletionEffects(t, h, a, false)
			})
		}
	}
}

func TestOwnerOpenListingStillCompletes(t *testing.T) {
	for _, action := range []string{"confirm", "auto"} {
		t.Run(action, func(t *testing.T) {
			h, _, a := completionTestHandler(t)
			if action == "confirm" {
				w := httptest.NewRecorder()
				h.ConfirmDone(w, completionRequest(a))
				if w.Code != 200 || !strings.Contains(w.Body.String(), "completed") {
					t.Fatalf("open listing confirmation: %d %s", w.Code, w.Body.String())
				}
			} else {
				h.completeAuto(context.Background(), a, time.Now())
			}
			assertCompletionEffects(t, h, a, true)
		})
	}
}

func TestAutoCompleteReadyRejectsOwnerClosedListing(t *testing.T) {
	for _, e := range []models.Elon{
		{Status: "cancelled", StartDate: "2026-01-01", OwnerFollowupPending: true},
		{Status: "filled", StartDate: "2026-01-01", IsDeleted: true},
	} {
		if autoCompleteReady(e, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) {
			t.Fatalf("closed listing became ready for completion: %+v", e)
		}
	}
}
