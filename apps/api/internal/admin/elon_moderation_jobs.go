package admin

import (
	"context"
	"log/slog"
	"time"

	"github.com/ishchibormi/backend/internal/elonimages"
	"github.com/ishchibormi/backend/internal/elonpurge"
	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var elonStatusLabels = map[string]string{
	"recruiting": "yig'ilmoqda", "filled": "to'ldi", "in_progress": "jarayonda",
	"completed": "yakunlandi", "cancelled": "bekor qilingan", "hidden": "yashirilgan", "draft": "qoralama",
}

func (h *Handler) processElonModeration(ctx context.Context, id, ownerID primitive.ObjectID, job models.ElonModerationJob) models.ElonModerationJob {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	now := time.Now().UTC()
	claim, err := h.Elons.UpdateOne(ctx, bson.M{"_id": id, "adminModerationJobs": bson.M{"$elemMatch": bson.M{
		"id": job.ID, "$or": []bson.M{{"leaseUntil": nil}, {"leaseUntil": bson.M{"$lte": now}}},
	}}}, bson.M{"$set": bson.M{"adminModerationJobs.$.leaseUntil": now.Add(time.Minute)}})
	if err != nil || claim.ModifiedCount == 0 {
		return job
	}
	if !job.AuditDone && h.AuditCol != nil {
		_, err := h.AuditCol.UpdateOne(ctx, bson.M{"_id": job.ID}, bson.M{"$setOnInsert": models.AdminAudit{
			ID: job.ID, AdminID: job.AdminID, Action: job.Action, Target: id.Hex(), Detail: job.Detail,
			Kind: job.Kind, FromStatus: job.FromStatus, Status: job.Status, Reason: job.Reason,
			NotifyOwner: &job.NotifyOwner, CreatedAt: job.CreatedAt,
		}}, options.Update().SetUpsert(true))
		job.AuditDone = err == nil
	}
	if !job.NotifyDone && h.Notify != nil {
		err := h.Notify.PushOnce(ctx, models.Notification{
			ID: job.ID, UserID: ownerID, Type: "system", Title: "E'lon holati o'zgardi",
			Body:          "«" + job.Title + "» e'loningiz holati «" + elonStatusLabels[job.Status] + "» ga o'zgartirildi. Sabab: " + job.Reason,
			RelatedEntity: &models.RelatedEntity{Type: "elon", ID: id}, SentByAdminID: job.AdminID, CreatedAt: job.CreatedAt,
		})
		job.NotifyDone = err == nil
	}
	if !job.StorageDone && h.Storage != nil {
		job.StorageDone = true
		for _, rawURL := range job.Images {
			if err := elonimages.Delete(ctx, h.Elons.Database(), h.Storage, id, ownerID, rawURL, job.CreatedAt); err != nil {
				job.StorageDone = false
			}
		}
	}
	if job.AuditDone && job.NotifyDone && job.StorageDone {
		_, err = h.Elons.UpdateOne(ctx, bson.M{"_id": id, "adminModerationJobs.id": job.ID}, bson.M{
			"$pull": bson.M{"adminModerationJobs": bson.M{"id": job.ID}},
		})
	} else {
		_, err = h.Elons.UpdateOne(ctx, bson.M{"_id": id, "adminModerationJobs.id": job.ID}, bson.M{
			"$set": bson.M{"adminModerationJobs.$.auditDone": job.AuditDone, "adminModerationJobs.$.notifyDone": job.NotifyDone,
				"adminModerationJobs.$.storageDone": job.StorageDone, "adminModerationJobs.$.nextAttemptAt": now.Add(time.Minute)},
			"$unset": bson.M{"adminModerationJobs.$.leaseUntil": ""},
		})
		slog.Warn("listing moderation awaiting retry", "elon", id.Hex(), "event", job.ID.Hex(),
			"audit", job.AuditDone, "storage", job.StorageDone, "notification", job.NotifyDone)
	}
	if err != nil {
		slog.Error("listing moderation progress not saved", "event", job.ID.Hex(), "err", err)
	}
	return job
}

func (h *Handler) RunElonModerationWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		h.retryElonModeration(ctx)
		elonpurge.Retry(ctx, h.Elons.Database(), h.AuditCol)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) retryElonModeration(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cur, err := h.Elons.Find(ctx, bson.M{"adminModerationJobs.nextAttemptAt": bson.M{"$lte": time.Now()}},
		options.Find().SetLimit(100).SetSort(bson.D{{Key: "adminModerationJobs.nextAttemptAt", Value: 1}}).
			SetProjection(bson.M{"ownerId": 1, "adminModerationJobs": 1}))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var e models.Elon
		if cur.Decode(&e) != nil {
			continue
		}
		for _, job := range e.ModerationJobs {
			if !job.NextAttemptAt.After(time.Now()) {
				h.processElonModeration(ctx, e.ID, e.OwnerID, job)
			}
		}
	}
}
