package elon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func rejectingNotifications(t *testing.T, db *mongo.Database) *mongo.Collection {
	t.Helper()
	// A real write failure after the application update, without shutting down
	// Mongo or touching anything outside this test's isolated database.
	if err := db.CreateCollection(context.Background(), "reject_notifications",
		options.CreateCollection().SetValidator(bson.M{"neverPresent": bson.M{"$exists": true}})); err != nil {
		t.Fatal(err)
	}
	return db.Collection("reject_notifications")
}

func TestOwnerCancellationRetriesAfterNotificationWriteFailure(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 0)
	a := ownerSeedCandidate(t, h, e, "pending")
	done := ownerSeedCandidate(t, h, e, "completed")
	workingNotifications := h.Notify.Col
	h.Notify.Col = rejectingNotifications(t, db)
	w := httptest.NewRecorder()
	h.Delete(w, ownerRequest(http.MethodDelete, e, e.OwnerID, nil))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "owner_cleanup_pending") {
		t.Fatalf("unfinished cleanup claimed success: %d %s", w.Code, w.Body.String())
	}
	var closed models.Elon
	if err := h.Col.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&closed); err != nil {
		t.Fatal(err)
	}
	if closed.Status != "cancelled" || !closed.OwnerFollowupPending || closed.CancelReason == "" {
		t.Fatalf("committed cancellation was not queued: %+v", closed)
	}
	var queued ownerCandidate
	if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&queued); err != nil {
		t.Fatal(err)
	}
	if queued.Status != "cancelled" || len(queued.Jobs) != 1 || p.calls != 0 {
		t.Fatalf("notification was lost after candidate transition: %+v pushes=%d", queued, p.calls)
	}
	// No second HTTP request: the background worker repairs the committed close.
	h.Notify.Col = workingNotifications
	h.retryOwnerActions(context.Background())
	closed = models.Elon{}
	if err := h.Col.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&closed); err != nil {
		t.Fatal(err)
	}
	if closed.OwnerFollowupPending || p.calls != 1 {
		t.Fatalf("retry did not finish: pending=%v pushes=%d", closed.OwnerFollowupPending, p.calls)
	}
	if n, err := workingNotifications.CountDocuments(context.Background(), bson.M{"userId": a.WorkerID}); err != nil || n != 1 {
		t.Fatalf("notification count=%d err=%v", n, err)
	}
	var notice models.Notification
	if err := workingNotifications.FindOne(context.Background(), bson.M{"userId": a.WorkerID}).Decode(&notice); err != nil ||
		notice.RelatedEntity == nil || notice.RelatedEntity.Type != "application" || notice.RelatedEntity.ID != a.ID {
		t.Fatalf("cancellation notification lost its application target: %+v %v", notice, err)
	}
	var history models.Application
	if err := h.Applications.FindOne(context.Background(), bson.M{"_id": done.ID}).Decode(&history); err != nil || history.Status != "completed" {
		t.Fatalf("completed history changed: %+v %v", history, err)
	}
	h.retryOwnerActions(context.Background())
	h.Delete(httptest.NewRecorder(), ownerRequest(http.MethodDelete, e, e.OwnerID, nil))
	if p.calls != 1 {
		t.Fatalf("recovery duplicated push: %d", p.calls)
	}
}

func TestOwnerCancellationFinishesAfterRequestDisconnect(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 0)
	for i := 0; i < 3; i++ {
		ownerSeedCandidate(t, h, e, "pending")
	}
	r := ownerRequest(http.MethodDelete, e, e.OwnerID, nil)
	ctx, disconnect := context.WithCancel(r.Context())
	defer disconnect()
	p.onPush = disconnect // client disconnects after the first candidate
	w := httptest.NewRecorder()
	h.Delete(w, r.WithContext(ctx))
	if w.Code != 200 || ctx.Err() == nil || p.calls != 3 {
		t.Fatalf("disconnect interrupted committed cleanup: code=%d err=%v pushes=%d", w.Code, ctx.Err(), p.calls)
	}
	if n, err := h.Applications.CountDocuments(context.Background(), liveCandidateFilter(e.ID)); err != nil || n != 0 {
		t.Fatalf("live candidates left after disconnect: count=%d err=%v", n, err)
	}
}

func TestOwnerTitleSaveCarriesMissedSalaryNotification(t *testing.T) {
	db := ownerTestDB(t)
	h, original, p := ownerTestHandler(t, db, "recruiting", 0)
	a := ownerSeedCandidate(t, h, original, "pending")
	// Both saves commit before either follow-up runs: revision 1 changes salary,
	// revision 2 only changes title. The candidate still has revision 0 terms.
	beforeTitle := original
	beforeTitle.PerWorkerAmount = 200
	beforeTitle.PriceAmount = 600
	beforeTitle.OwnerRevision = 1
	winning := beforeTitle
	winning.Title = "Yangi sarlavha"
	winning.OwnerRevision = 2
	winning.OwnerFollowupVersion = 2
	winning.OwnerFollowupPending = true
	winning.UpdatedAt = time.Now()
	if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": original.ID}, winning); err != nil {
		t.Fatal(err)
	}
	h.notifyCandidateChanges(context.Background(), beforeTitle, winning)
	var updated models.Application
	if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Amount != 200 || updated.ElonTitle != winning.Title || updated.ElonOwnerRevision != 2 || p.calls != 1 {
		t.Fatalf("title save lost prior salary change: %+v pushes=%d", updated, p.calls)
	}
	// The slower revision 1 follow-up must neither revert terms nor notify twice.
	h.notifyCandidateChanges(context.Background(), original, beforeTitle)
	h.retryOwnerActions(context.Background())
	if p.calls != 1 {
		t.Fatalf("stale follow-up duplicated notification: %d", p.calls)
	}
}

func TestOwnerSalaryJobSurvivesLaterTitleSaveAndRetry(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 0)
	a := ownerSeedCandidate(t, h, e, "accepted")
	workingNotifications := h.Notify.Col
	h.Notify.Col = rejectingNotifications(t, db)
	e.OwnerRevision = 1
	e.OwnerFollowupVersion = 1
	e.OwnerFollowupPending = true
	e.PerWorkerAmount = 200
	if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": e.ID}, e); err != nil {
		t.Fatal(err)
	}
	if err := h.finishOwnerFollowup(context.Background(), e.ID); err == nil {
		t.Fatal("notification write failure went unnoticed")
	}
	// The candidate's amount is already 200, but the pending salary job must not
	// be removed just because the next edit changes only title.
	e.OwnerRevision++
	e.OwnerFollowupVersion++
	e.Title = "Yangilangan sarlavha"
	if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": e.ID}, e); err != nil {
		t.Fatal(err)
	}
	h.Notify.Col = workingNotifications
	h.retryOwnerActions(context.Background())
	if n, err := workingNotifications.CountDocuments(context.Background(), bson.M{"userId": a.WorkerID}); err != nil || n != 1 || p.calls != 1 {
		t.Fatalf("salary job was lost/duplicated: count=%d pushes=%d err=%v", n, p.calls, err)
	}
}

func TestOwnerWorkerRepairsLateApplyAfterFailedPostWriteRead(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "cancelled", 0)
	a := ownerSeedCandidate(t, h, e, "pending")
	if _, err := h.Applications.UpdateOne(context.Background(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"listingRecheckPending": true}}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := h.RecheckApplication(ctx, &a); err == nil {
		t.Fatal("cancelled post-write read unexpectedly succeeded")
	}
	h.retryOwnerActions(context.Background())
	var repaired models.Application
	if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&repaired); err != nil {
		t.Fatal(err)
	}
	if repaired.Status != "cancelled" || repaired.ListingRecheckPending || p.calls != 1 {
		t.Fatalf("late Apply was left pending: %+v pushes=%d", repaired, p.calls)
	}
	h.retryOwnerActions(context.Background())
	if p.calls != 1 {
		t.Fatalf("late Apply retry duplicated cancellation: %d", p.calls)
	}
}

func TestOwnerRecheckPreservesAnApplicationAlreadyAccepted(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "filled", 1)
	a := ownerSeedCandidate(t, h, e, "accepted")
	if _, err := h.Applications.UpdateOne(context.Background(), bson.M{"_id": a.ID},
		bson.M{"$set": bson.M{"listingRecheckPending": true}}); err != nil {
		t.Fatal(err)
	}
	a.Status = "pending" // Apply still holds its original just-inserted copy.
	if err := h.RecheckApplication(context.Background(), &a); err != nil {
		t.Fatalf("accepted Apply was rejected by its post-write check: %v", err)
	}
	if a.Status != "accepted" || p.calls != 0 {
		t.Fatalf("accepted candidate was spuriously cancelled: %+v pushes=%d", a, p.calls)
	}
}
