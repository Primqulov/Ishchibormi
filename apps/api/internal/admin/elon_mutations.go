package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/elonpurge"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func (h *Handler) moderationElon(r *http.Request) (models.Elon, error) {
	var e models.Elon
	if !elonAdminAllowed(r) {
		return e, httpx.NewError(403, "forbidden", "bu amal uchun ruxsat yo'q")
	}
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		return e, httpx.NewError(400, "bad_id", "bad id")
	}
	err = h.Elons.FindOne(r.Context(), bson.M{"_id": id}).Decode(&e)
	if errors.Is(err, mongo.ErrNoDocuments) {
		err = httpx.NewError(404, "not_found", "elon not found")
	}
	return e, err
}

// PATCH /admin/elons/{id}/status. Recruiting from hidden is an explicit
// restore of the remembered status; the five other choices require a reason.
func (h *Handler) SetElonStatus(w http.ResponseWriter, r *http.Request) {
	if !elonAdminAllowed(r) {
		httpx.Err(w, httpx.NewError(403, "forbidden", "bu amal uchun ruxsat yo'q"))
		return
	}
	var req elonStatusRequest
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	prev, err := h.moderationElon(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if err := req.validate(prev); err != nil {
		httpx.Err(w, err)
		return
	}
	status, detail := elonStatusUpdate(prev, req.Status)
	if status == prev.Status && !(status == "hidden" && len(prev.Images) > 0) {
		httpx.JSON(w, 200, map[string]any{"ok": true, "status": status, "unchanged": true})
		return
	}
	now := elonModerationTime(prev)
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	kind, _ := elonActionFrom("elon_status", detail)
	notifyOwner := kind == elonActionStatus && (req.NotifyOwner == nil || *req.NotifyOwner) && !prev.OwnerID.IsZero()
	job := models.ElonModerationJob{
		ID: primitive.NewObjectID(), AdminID: adminID, Action: "elon_status", Kind: kind,
		FromStatus: prev.Status, Status: status, Detail: detail, Reason: req.Reason,
		NotifyOwner: notifyOwner, NotifyDone: !notifyOwner, Title: prev.Title,
		CreatedAt: now, NextAttemptAt: now, StorageDone: true,
	}
	if kind != elonActionStatus {
		job.Reason = detail
	} else {
		job.Detail += " — " + req.Reason
	}
	set := bson.M{"status": status, "updatedAt": now}
	upd := bson.M{"$set": set, "$inc": bson.M{"ownerRevision": 1}}
	if status == "hidden" {
		if prev.Status != "hidden" {
			set["hiddenFromStatus"] = prev.Status
		}
	} else if prev.HiddenFromStatus != "" {
		upd["$unset"] = bson.M{"hiddenFromStatus": ""}
	}
	if status == "hidden" || prev.Status == "hidden" {
		// Older hidden records can still contain photo URLs. Restoring them
		// must retain the documented no-photo state too.
		set["images"] = bson.A{}
		if len(prev.Images) > 0 {
			set["imagesRemovedAt"] = now
			job.Images = append([]string(nil), prev.Images...)
			job.StorageDone = false
		}
	}
	upd["$push"] = bson.M{"adminModerationJobs": job}
	filter := elonModerationFilter(prev)
	if req.ExpectedUpdatedAt != nil {
		filter["updatedAt"] = *req.ExpectedUpdatedAt
	}
	res, err := h.Elons.UpdateOne(r.Context(), filter, upd)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		httpx.Err(w, elonChangedError())
		return
	}
	job = h.processElonModeration(r.Context(), prev.ID, prev.OwnerID, job)
	httpx.JSON(w, 200, map[string]any{"ok": true, "status": status, "updatedAt": now,
		"cleanupPending": !job.StorageDone, "auditPending": !job.AuditDone, "notificationPending": !job.NotifyDone})
}

func (h *Handler) DeleteElon(w http.ResponseWriter, r *http.Request) {
	if !elonAdminAllowed(r) {
		httpx.Err(w, httpx.NewError(403, "forbidden", "bu amal uchun ruxsat yo'q"))
		return
	}
	mode, err := deleteMode(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	prev, err := h.moderationElon(r)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if mode == deleteModePurge {
		if h.Purger == nil {
			httpx.Err(w, httpx.NewError(503, "purge_unavailable", "permanent deletion is not configured on this server"))
			return
		}
		// Archive first under the revision fence. Once purge is accepted,
		// neither a slow owner save nor another status action may add work or
		// photos while the cascading deletion runs. A failed purge is retryable
		// from the retained, already non-public archive record.
		filter := elonModerationFilter(prev)
		if prev.IsDeleted {
			filter["isDeleted"] = true
		}
		now := elonModerationTime(prev)
		set := bson.M{"isDeleted": true, "status": "cancelled", "updatedAt": now}
		event := prev.PurgeEvent
		if event == nil {
			adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
			event = &models.ElonPurgeEvent{ID: primitive.NewObjectID(), ElonID: prev.ID, AdminID: adminID, CreatedAt: now, NextAttemptAt: now}
			set["adminPurgeEvent"] = event
		}
		if prev.DeletedAt == nil {
			set["deletedAt"] = now
		}
		res, err := h.Elons.UpdateOne(r.Context(), filter, bson.M{"$set": set, "$inc": bson.M{"ownerRevision": 1}})
		if err != nil {
			httpx.Err(w, err)
			return
		}
		if res.MatchedCount == 0 {
			httpx.Err(w, elonChangedError())
			return
		}
		// Let in-flight durable events finish before removing their records.
		// Otherwise a worker could recreate a notification after cascade.
		for _, pending := range prev.ModerationJobs {
			job := h.processElonModeration(r.Context(), prev.ID, prev.OwnerID, pending)
			if !job.StorageDone || !job.AuditDone || !job.NotifyDone {
				httpx.Err(w, httpx.NewError(503, "cleanup_pending", "oldingi amal yakunlanmoqda, qayta urinib ko'ring"))
				return
			}
		}
		if err := h.Purger.PurgeElonNow(r.Context(), prev.ID); err != nil {
			httpx.Err(w, err)
			return
		}
		auditDone := elonpurge.Finish(r.Context(), h.Elons.Database(), h.AuditCol, *event)
		httpx.JSON(w, 200, map[string]any{"ok": true, "mode": deleteModePurge, "auditPending": !auditDone})
		return
	}
	if prev.IsDeleted {
		httpx.Err(w, httpx.NewError(409, "elon_deleted", "e'lon allaqachon o'chirilgan"))
		return
	}
	now := elonModerationTime(prev)
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	job := models.ElonModerationJob{
		ID: primitive.NewObjectID(), AdminID: adminID, Action: "elon_delete", Kind: elonActionDeleted,
		FromStatus: prev.Status, Status: "cancelled", Detail: "o'chirildi — foydalanuvchilardan olib tashlandi, bazada qoldi",
		Images: append([]string(nil), prev.Images...), StorageDone: len(prev.Images) == 0, NotifyDone: true,
		CreatedAt: now, NextAttemptAt: now,
	}
	set := bson.M{"isDeleted": true, "status": "cancelled", "deletedAt": now, "updatedAt": now, "images": bson.A{}}
	if len(prev.Images) > 0 {
		set["imagesRemovedAt"] = now
	}
	res, err := h.Elons.UpdateOne(r.Context(), elonModerationFilter(prev), bson.M{
		"$set": set, "$inc": bson.M{"ownerRevision": 1}, "$push": bson.M{"adminModerationJobs": job},
		"$unset": bson.M{"hiddenFromStatus": ""},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		httpx.Err(w, elonChangedError())
		return
	}
	job = h.processElonModeration(r.Context(), prev.ID, prev.OwnerID, job)
	httpx.JSON(w, 200, map[string]any{"ok": true, "mode": deleteModeHidden, "deletedAt": now,
		"cleanupPending": !job.StorageDone, "auditPending": !job.AuditDone})
}
