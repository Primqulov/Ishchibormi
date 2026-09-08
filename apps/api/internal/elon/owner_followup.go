package elon

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const ownerFollowupTimeout = 10 * time.Second

var errOwnerFollowupPending = errors.New("owner follow-up is pending")

// Jobs live in the same application document as their state/term update. A
// crash between that update and notification persistence cannot lose the event.
type ownerNotificationJob struct {
	Notification models.Notification `bson:"notification"`
	ReviewActor  bool                `bson:"reviewActor"`
}

type ownerCandidate struct {
	models.Application `bson:",inline"`
	Jobs               map[string]ownerNotificationJob `bson:"ownerNotificationJobs"`
}

func ownerEventID(kind string, e models.Elon, a models.Application) primitive.ObjectID {
	sum := sha256.Sum256([]byte(fmt.Sprintf("owner/%s/%s/%s/%d/%d", kind,
		e.ID.Hex(), a.ID.Hex(), e.OwnerRevision, a.AppliedAt.UnixMilli())))
	var id primitive.ObjectID
	copy(id[:], sum[:12])
	return id
}

func ownerJob(ctx context.Context, e models.Elon, a models.Application, kind, title, body string) ownerNotificationJob {
	at := e.UpdatedAt
	related := &models.RelatedEntity{Type: "elon", ID: e.ID}
	if kind == "application_cancelled" && e.CancelledAt != nil {
		at = *e.CancelledAt
	}
	if kind == "application_cancelled" {
		related = &models.RelatedEntity{Type: "application", ID: a.ID}
	}
	return ownerNotificationJob{
		Notification: models.Notification{
			ID: ownerEventID(kind, e, a), UserID: a.WorkerID, Type: kind,
			Title: title, Body: body, CreatedAt: at,
			RelatedEntity: related,
		},
		ReviewActor: httpx.IsReviewActor(ctx) || e.IsReviewData,
	}
}

func putOwnerJob(set bson.M, job ownerNotificationJob) {
	set["ownerNotificationJobs."+job.Notification.ID.Hex()] = job
}

func (h *Handler) cancelOwnerCandidate(ctx context.Context, e models.Elon, a models.Application) error {
	reason := e.CancelReason
	if reason == "" {
		reason = "E'lon ariza qabul qilishni to'xtatdi"
	}
	at := e.CancelledAt
	if at == nil {
		now := time.Now()
		at = &now
	}
	set := bson.M{
		"status": "cancelled", "cancelledBy": "employer", "cancelReason": reason, "decidedAt": at,
	}
	putOwnerJob(set, ownerJob(ctx, e, a, "application_cancelled", "Ish bekor qilindi", e.Title+" — sabab: "+reason))
	f := liveCandidateFilter(e.ID)
	f["_id"] = a.ID
	_, err := h.Applications.UpdateOne(ctx, f, bson.M{"$set": set})
	return err
}

// Compare the application's last effective terms to the winning listing, not
// two adjacent owner edits. A title-only save must still notify a candidate
// whose salary/category/schedule/address snapshot has not caught up with an
// earlier save. Legacy applications only notify for schedule/address changes
// after the stored revision, not merely because their snapshot is absent.
func applicationTermsChanged(a models.Application, e models.Elon) bool {
	categoryChanged := a.ElonCategoryName != e.CategoryName
	if !a.ElonCategoryID.IsZero() {
		categoryChanged = a.ElonCategoryID != e.CategoryID
	}
	workChanged := e.OwnerWorkDetailsRevision > a.ElonOwnerRevision
	if a.ElonWorkDetails != nil {
		workChanged = *a.ElonWorkDetails != *e.WorkDetails()
	}
	return categoryChanged || a.Amount != e.PerWorkerAmount || a.IsNegotiable != (e.PricingType == "negotiable") || workChanged
}

func (h *Handler) updateOwnerCandidate(ctx context.Context, e models.Elon, a models.Application) error {
	if a.ElonOwnerRevision > e.OwnerRevision {
		return nil
	}
	set := bson.M{
		"elonTitle": e.Title, "elonCategoryName": e.CategoryName, "elonCategoryId": e.CategoryID,
		"elonRegion": e.Region, "elonDistrict": e.District,
		"amount": e.PerWorkerAmount, "isNegotiable": e.PricingType == "negotiable",
		"elonOwnerRevision": e.OwnerRevision,
		"elonWorkDetails":   e.WorkDetails(),
	}
	if applicationTermsChanged(a, e) {
		putOwnerJob(set, ownerJob(ctx, e, a, "elon_updated", "Ish shartlari o'zgardi",
			e.Title+" — ish haqi, ish turi, sana yoki manzil o'zgartirildi. Yangilangan e'lonni tekshiring."))
	}
	f := liveCandidateFilter(e.ID)
	f["_id"] = a.ID
	// A second worker that read the same old terms must not create a second
	// event or overwrite a newer snapshot after losing this conditional write.
	f["$expr"] = bson.M{"$eq": bson.A{bson.M{"$ifNull": bson.A{"$elonOwnerRevision", 0}}, a.ElonOwnerRevision}}
	_, err := h.Applications.UpdateOne(ctx, f, bson.M{"$set": set})
	return err
}

func (h *Handler) syncOwnerCandidates(ctx context.Context, e models.Elon) error {
	cur, err := h.Applications.Find(ctx, liveCandidateFilter(e.ID))
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Application
		if err := cur.Decode(&a); err != nil {
			return err
		}
		if err := h.updateOwnerCandidate(ctx, e, a); err != nil {
			return err
		}
	}
	return cur.Err()
}

func (h *Handler) flushOwnerCandidateNotifications(ctx context.Context, id primitive.ObjectID) error {
	// Immediate requests and the retry worker can overlap, including across API
	// instances. A short application lease serializes PushOnce transport calls;
	// stable IDs still make a retry after a crash idempotent in the inbox.
	token := primitive.NewObjectID()
	now := time.Now()
	var a ownerCandidate
	err := h.Applications.FindOneAndUpdate(ctx, bson.M{
		"_id": id, "ownerNotificationJobs": bson.M{"$exists": true},
		"$or": bson.A{
			bson.M{"ownerNotificationLeaseUntil": bson.M{"$exists": false}},
			bson.M{"ownerNotificationLeaseUntil": bson.M{"$lte": now}},
		},
	}, bson.M{"$set": bson.M{
		"ownerNotificationLeaseUntil": now.Add(2 * ownerFollowupTimeout), "ownerNotificationLease": token,
	}}, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&a)
	if errors.Is(err, mongo.ErrNoDocuments) {
		n, countErr := h.Applications.CountDocuments(ctx,
			bson.M{"_id": id, "ownerNotificationJobs": bson.M{"$exists": true}}, options.Count().SetLimit(1))
		if countErr != nil {
			return countErr
		}
		if n > 0 {
			return errOwnerFollowupPending
		}
		return nil
	}
	if err != nil {
		return err
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		_, _ = h.Applications.UpdateOne(releaseCtx, bson.M{"_id": id, "ownerNotificationLease": token},
			bson.M{"$unset": bson.M{"ownerNotificationLeaseUntil": "", "ownerNotificationLease": ""}})
	}()
	jobs := make([]ownerNotificationJob, 0, len(a.Jobs))
	for _, job := range a.Jobs {
		jobs = append(jobs, job)
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Notification.CreatedAt.Before(jobs[j].Notification.CreatedAt) })
	for _, job := range jobs {
		jobCtx := context.WithValue(ctx, httpx.CtxReviewActor, job.ReviewActor)
		if err := h.Notify.PushOnce(jobCtx, job.Notification); err != nil {
			return err
		}
		if _, err := h.Applications.UpdateOne(ctx, bson.M{"_id": id, "ownerNotificationLease": token},
			bson.M{"$unset": bson.M{"ownerNotificationJobs." + job.Notification.ID.Hex(): ""}}); err != nil {
			return err
		}
	}
	// Do not erase jobs a newer owner revision appended during delivery.
	_, err = h.Applications.UpdateOne(ctx, bson.M{"_id": id, "ownerNotificationJobs": bson.M{}},
		bson.M{"$unset": bson.M{"ownerNotificationJobs": ""}})
	return err
}

func (h *Handler) finishOwnerFollowupDetached(ctx context.Context, id primitive.ObjectID) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), ownerFollowupTimeout)
	defer cancel()
	return h.finishOwnerFollowup(ctx, id)
}

func (h *Handler) finishOwnerFollowup(ctx context.Context, id primitive.ObjectID) error {
	var e models.Elon
	if err := h.Col.FindOne(ctx, bson.M{"_id": id}).Decode(&e); err != nil {
		return err
	}
	if !e.OwnerFollowupPending {
		return nil
	}
	if e.Status == "cancelled" {
		if err := h.cancelOwnerCandidates(ctx, e); err != nil {
			return err
		}
	} else if ownerEditable(e.Status) || e.Status == "in_progress" {
		if err := h.syncOwnerCandidates(ctx, e); err != nil {
			return err
		}
	}
	cur, err := h.Applications.Find(ctx, bson.M{"elonId": id, "ownerNotificationJobs": bson.M{"$exists": true}})
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Application
		if err := cur.Decode(&a); err != nil {
			return err
		}
		if err := h.flushOwnerCandidateNotifications(ctx, a.ID); err != nil {
			return err
		}
	}
	if err := cur.Err(); err != nil {
		return err
	}
	remaining := bson.M{"elonId": id, "ownerNotificationJobs": bson.M{"$exists": true}}
	if e.Status == "cancelled" {
		remaining = bson.M{"elonId": id, "$or": bson.A{
			bson.M{"status": bson.M{"$in": []string{"pending", "accepted"}}},
			bson.M{"ownerNotificationJobs": bson.M{"$exists": true}},
		}}
	}
	n, err := h.Applications.CountDocuments(ctx, remaining, options.Count().SetLimit(1))
	if err != nil {
		return err
	}
	if n > 0 {
		return errOwnerFollowupPending
	}
	_, err = h.Col.UpdateOne(ctx, bson.M{"_id": id, "ownerFollowupVersion": e.OwnerFollowupVersion},
		bson.M{"$unset": bson.M{"ownerFollowupPending": ""}})
	return err
}

// RecheckApplication reconciles an Apply that crossed an owner edit/close. Its
// pending marker is inserted with the application, so even a failed post-write
// read is retried after restart instead of leaving an orphan pending card.
func (h *Handler) RecheckApplication(ctx context.Context, a *models.Application) error {
	// The owner may already have accepted this application before Apply's
	// response. Use its current state so a newly filled listing cannot turn
	// that accepted application into a cancellation with a stale pending copy.
	var current models.Application
	if err := h.Applications.FindOne(ctx, bson.M{"_id": a.ID}).Decode(&current); err != nil {
		return err
	}
	*a = current
	var e models.Elon
	err := h.Col.FindOne(ctx, bson.M{"_id": a.ElonID}).Decode(&e)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return err
	}
	accepted := a.Status == "accepted" && (e.Status == "filled" || e.Status == "in_progress" || e.Status == "confirmed")
	open := err == nil && !e.IsDeleted && !e.OwnerBlocked && (e.Status == "recruiting" || accepted)
	if open {
		if err := h.updateOwnerCandidate(ctx, e, *a); err != nil {
			return err
		}
	} else {
		e.ID = a.ElonID
		if err := h.cancelOwnerCandidate(ctx, e, *a); err != nil {
			return err
		}
	}
	if err := h.flushOwnerCandidateNotifications(ctx, a.ID); err != nil {
		return err
	}
	if _, err := h.Applications.UpdateOne(ctx, bson.M{"_id": a.ID, "ownerNotificationJobs": bson.M{"$exists": false}},
		bson.M{"$unset": bson.M{"listingRecheckPending": ""}}); err != nil {
		return err
	}
	if err := h.Applications.FindOne(ctx, bson.M{"_id": a.ID}).Decode(a); err != nil {
		return err
	}
	if !open || a.Status == "cancelled" {
		return httpx.NewError(409, "not_recruiting", "Bu e'lon hozir ariza qabul qilmayapti.")
	}
	return nil
}

// A small, indexed sweep retries durable work independently of client requests.
// Both startup and each 30-second tick have a bounded 20-second database budget.
func (h *Handler) RunOwnerActionWorker(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		h.retryOwnerActions(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) retryOwnerActions(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	cur, err := h.Col.Find(ctx, bson.M{"ownerFollowupPending": true}, options.Find().SetLimit(25))
	if err == nil {
		for cur.Next(ctx) {
			var e models.Elon
			if cur.Decode(&e) == nil {
				if err := h.finishOwnerFollowup(ctx, e.ID); err != nil {
					slog.Warn("owner follow-up retry pending", "elon", e.ID.Hex(), "err", err)
				}
			}
		}
		_ = cur.Close(ctx)
	}
	cur, err = h.Applications.Find(ctx, bson.M{"listingRecheckPending": true}, options.Find().SetLimit(25))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Application
		if cur.Decode(&a) == nil {
			// A not_recruiting business response is expected after successfully
			// cancelling a late Apply; the durable marker has already been cleared.
			_ = h.RecheckApplication(ctx, &a)
		}
	}
}
