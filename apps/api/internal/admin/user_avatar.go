package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var avatarReasons = map[string]string{
	"adult":         "Nomaqbul tasvir (18+)",
	"violence":      "Zo'ravonlik/qon",
	"impersonation": "Boshqa odamning rasmi",
	"spam":          "Reklama yoki spam",
	"other":         "Boshqa",
}

type avatarDeleteRequest struct {
	ExpectedURL string `json:"expectedUrl"`
	Reason      string `json:"reason"`
	Comment     string `json:"comment"`
}

func (req *avatarDeleteRequest) validate() error {
	req.ExpectedURL = strings.TrimSpace(req.ExpectedURL)
	req.Reason = strings.TrimSpace(req.Reason)
	req.Comment = strings.TrimSpace(req.Comment)
	if req.ExpectedURL == "" || len(req.ExpectedURL) > 2048 {
		return httpx.NewError(400, "avatar_url_required", "ko'rilgan rasm manzili talab qilinadi")
	}
	if _, ok := avatarReasons[req.Reason]; !ok {
		return httpx.NewError(400, "avatar_reason_required", "rasmni o'chirish sababini tanlang")
	}
	if utf8.RuneCountInString(req.Comment) > 200 || (req.Reason == "other" && req.Comment == "") {
		return httpx.NewError(400, "avatar_comment_invalid", "izoh 1 dan 200 belgigacha bo'lishi kerak")
	}
	if req.Reason != "other" {
		req.Comment = ""
	}
	return nil
}

func avatarAdminAllowed(r *http.Request, write bool) bool {
	role := httpx.AdminRole(r)
	return httpx.AdminID(r) != "" && (role == "superadmin" || role == "moderator" || (!write && role == "support"))
}

func (h *Handler) avatarUser(r *http.Request, write bool) (*models.User, error) {
	if !avatarAdminAllowed(r, write) {
		return nil, httpx.NewError(403, "forbidden", "bu amal uchun ruxsat yo'q")
	}
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		return nil, httpx.NewError(400, "bad_id", "foydalanuvchi ID noto'g'ri")
	}
	var u models.User
	err = h.Users.FindOne(r.Context(), bson.M{"_id": id}).Decode(&u)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, httpx.NewError(404, "not_found", "foydalanuvchi topilmadi")
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GET /admin/users/{id}/avatar. No external URL is fetched by this endpoint.
func (h *Handler) GetUserAvatar(w http.ResponseWriter, r *http.Request) {
	u, err := h.avatarUser(r, false)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	meta := models.AvatarMetadata{URL: u.AvatarURL, ModerationStatus: "unknown"}
	if u.AvatarMetadata != nil && u.AvatarMetadata.URL == u.AvatarURL {
		meta = *u.AvatarMetadata
	} else if u.AvatarURL != "" && h.AvatarUploads != nil {
		var upload models.AvatarUpload
		err := h.AvatarUploads.FindOne(r.Context(), bson.M{"_id": u.AvatarURL, "userId": u.ID}).Decode(&upload)
		if err == nil && upload.DeletedAt == nil {
			meta = upload.Metadata
		}
		if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
			httpx.Err(w, err)
			return
		}
	}
	if meta.ModerationStatus != "clean" && meta.ModerationStatus != "flagged" {
		meta.ModerationStatus = "unknown"
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, 200, struct {
		models.AvatarMetadata
		DeletedAt *time.Time `json:"deletedAt,omitempty"`
	}{meta, u.AvatarDeletedAt})
}

// POST /admin/users/{id}/avatar/download records an explicit save, not each
// viewer/image request. The client downloads only the unauthenticated public
// asset; administrator bearer credentials never travel to a CDN.
func (h *Handler) RecordAvatarDownload(w http.ResponseWriter, r *http.Request) {
	if !avatarAdminAllowed(r, false) {
		httpx.Err(w, httpx.NewError(403, "forbidden", "bu amal uchun ruxsat yo'q"))
		return
	}
	var req struct {
		ExpectedURL string `json:"expectedUrl"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if req.ExpectedURL == "" || len(req.ExpectedURL) > 2048 {
		httpx.Err(w, httpx.NewError(400, "avatar_url_required", "rasm manzili talab qilinadi"))
		return
	}
	u, err := h.avatarUser(r, false)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if u.AvatarURL != req.ExpectedURL {
		httpx.Err(w, httpx.NewError(409, "avatar_changed", "profil rasmi o'zgargan, profilni yangilang"))
		return
	}
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	detail, _ := json.Marshal(map[string]string{"url": req.ExpectedURL})
	if h.AuditCol == nil {
		httpx.Err(w, httpx.NewError(503, "audit_unavailable", "amal jurnalini yozib bo'lmadi"))
		return
	}
	_, err = h.AuditCol.InsertOne(r.Context(), models.AdminAudit{
		AdminID: adminID, Action: "avatar.download", Target: u.ID.Hex(), Detail: string(detail), CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DELETE /admin/users/{id}/avatar atomically detaches exactly the viewed file.
// A new concurrent upload is never removed by an older viewer's confirmation.
func (h *Handler) DeleteUserAvatar(w http.ResponseWriter, r *http.Request) {
	if !avatarAdminAllowed(r, true) {
		httpx.Err(w, httpx.NewError(403, "forbidden", "rasmni o'chirish uchun ruxsat yo'q"))
		return
	}
	var req avatarDeleteRequest
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	if err := req.validate(); err != nil {
		httpx.Err(w, err)
		return
	}
	u, err := h.avatarUser(r, true)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if u.AvatarURL != req.ExpectedURL {
		httpx.Err(w, httpx.NewError(409, "avatar_changed", "profil rasmi o'zgargan, profilni yangilang"))
		return
	}
	now := time.Now().UTC()
	adminID, _ := primitive.ObjectIDFromHex(httpx.AdminID(r))
	job := models.AvatarDeletionJob{ID: primitive.NewObjectID(), AdminID: adminID, URL: req.ExpectedURL, Reason: req.Reason, Comment: req.Comment, CreatedAt: now, NextAttemptAt: &now}
	res, err := h.Users.UpdateOne(r.Context(), bson.M{"_id": u.ID, "avatarUrl": req.ExpectedURL}, bson.M{
		"$set":   bson.M{"avatarUrl": nil, "avatarDeletedAt": now, "avatarDeletedBy": adminID, "avatarDeletedReason": avatarReasonText(job), "updatedAt": now},
		"$unset": bson.M{"avatarMetadata": ""},
		"$push":  bson.M{"avatarDeletionJobs": job},
		"$inc":   bson.M{"avatarRevision": 1},
	})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		httpx.Err(w, httpx.NewError(409, "avatar_changed", "profil rasmi o'zgargan, profilni yangilang"))
		return
	}
	job = h.processAvatarDeletion(r.Context(), u.ID, job)
	inApp, push := "pending", "pending"
	if job.PushDone {
		inApp = "sent"
		push = "not_configured"
		if h.Notify != nil && h.Notify.Pusher != nil {
			push = "queued"
		}
	}
	code := http.StatusOK
	if !job.StorageDone || !job.AuditDone || !job.PushDone {
		code = http.StatusAccepted
	}
	storageStatus := job.StorageStatus
	if storageStatus == "" {
		storageStatus = "pending"
	}
	httpx.JSON(w, code, map[string]any{
		"ok": true, "avatarUrl": nil, "deletedAt": now,
		"cleanupPending": !job.StorageDone, "auditPending": !job.AuditDone,
		"storageStatus": storageStatus,
		"notifications": map[string]string{"inApp": inApp, "push": push},
	})
}

func avatarReasonText(job models.AvatarDeletionJob) string {
	if job.Reason == "other" {
		return job.Comment
	}
	return avatarReasons[job.Reason]
}

func (h *Handler) processAvatarDeletion(ctx context.Context, uid primitive.ObjectID, job models.AvatarDeletionJob) models.AvatarDeletionJob {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	now := time.Now().UTC()
	// A lease prevents concurrent workers from dispatching the same notification.
	claim, err := h.Users.UpdateOne(ctx, bson.M{"_id": uid, "avatarDeletionJobs": bson.M{"$elemMatch": bson.M{
		"id": job.ID, "$or": []bson.M{{"leaseUntil": nil}, {"leaseUntil": bson.M{"$lte": now}}},
	}}}, bson.M{"$set": bson.M{"avatarDeletionJobs.$.leaseUntil": now.Add(time.Minute)}})
	if err != nil || claim.ModifiedCount == 0 {
		return job
	}

	if !job.AuditDone && h.AuditCol != nil {
		detail, _ := json.Marshal(map[string]string{"reason": job.Reason, "reasonText": avatarReasonText(job), "comment": job.Comment, "url": job.URL})
		_, err := h.AuditCol.UpdateOne(ctx, bson.M{"_id": job.ID}, bson.M{"$setOnInsert": models.AdminAudit{
			ID: job.ID, AdminID: job.AdminID, Action: "avatar.delete", Target: uid.Hex(), Detail: string(detail), CreatedAt: job.CreatedAt,
		}}, options.Update().SetUpsert(true))
		job.AuditDone = err == nil
	}
	if !job.StorageDone {
		// Write a tombstone even when the object is already missing. It blocks a
		// stale client from reattaching the same URL after moderation.
		if h.Storage != nil {
			key := h.Storage.KeyFromURL(job.URL)
			if !strings.HasPrefix(key, "avatars/"+uid.Hex()+"/") || !h.Storage.KeyBelongsToUser(key, uid.Hex()) {
				// Legacy imported/shared URLs can only be detached. Do not delete
				// a listing's photo, another user's upload or an external resource.
				job.StorageDone, job.StorageStatus = true, "reference_only"
			} else if h.AvatarUploads != nil {
				// A stale imported URL must never tombstone another user's upload.
				_, err := h.AvatarUploads.UpdateOne(ctx, bson.M{"_id": job.URL, "userId": uid}, bson.M{
					"$set": bson.M{"deletedAt": job.CreatedAt},
				}, options.Update().SetUpsert(true))
				if err == nil {
					if err := h.Storage.Delete(ctx, key); err == nil {
						job.StorageDone, job.StorageStatus = true, "deleted"
					}
				}
			}
		}
	}
	if !job.PushDone && h.Notify != nil {
		err := h.Notify.PushOnce(ctx, models.Notification{
			ID: job.ID, UserID: uid, Type: "system", Title: "Profil rasmi olib tashlandi",
			Body:          "Profil rasmi qoidalarga mos emas. Sabab: " + avatarReasonText(job) + ". Yangi profil rasmini yuklashingiz mumkin.",
			SentByAdminID: job.AdminID, CreatedAt: job.CreatedAt,
		})
		job.PushDone = err == nil
	}
	if job.StorageDone && job.AuditDone && job.PushDone {
		_, err = h.Users.UpdateOne(ctx, bson.M{"_id": uid, "avatarDeletionJobs.id": job.ID}, bson.M{
			"$pull": bson.M{"avatarDeletionJobs": bson.M{"id": job.ID}},
			"$inc":  bson.M{"avatarRevision": 1},
		})
	} else {
		_, err = h.Users.UpdateOne(ctx, bson.M{"_id": uid, "avatarDeletionJobs.id": job.ID}, bson.M{
			"$set": bson.M{"avatarDeletionJobs.$.storageDone": job.StorageDone, "avatarDeletionJobs.$.auditDone": job.AuditDone,
				"avatarDeletionJobs.$.storageStatus": job.StorageStatus,
				"avatarDeletionJobs.$.pushDone":      job.PushDone, "avatarDeletionJobs.$.nextAttemptAt": now.Add(time.Minute)},
			"$unset": bson.M{"avatarDeletionJobs.$.leaseUntil": ""},
		})
		slog.Warn("avatar deletion awaiting retry", "user", uid.Hex(), "event", job.ID.Hex(), "storage", job.StorageDone, "audit", job.AuditDone, "notification", job.PushDone)
	}
	if err != nil {
		slog.Error("avatar deletion progress not saved", "event", job.ID.Hex(), "err", err)
	}
	return job
}

func (h *Handler) RunAvatarDeletionWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		h.retryAvatarDeletions(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) retryAvatarDeletions(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cur, err := h.Users.Find(ctx, bson.M{"avatarDeletionJobs.nextAttemptAt": bson.M{"$lte": time.Now()}}, options.Find().SetLimit(100).SetSort(bson.D{{Key: "avatarDeletionJobs.nextAttemptAt", Value: 1}}).SetProjection(bson.M{"avatarDeletionJobs": 1}))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var u models.User
		if cur.Decode(&u) != nil {
			continue
		}
		for _, job := range u.AvatarDeletionJobs {
			if job.NextAttemptAt == nil || !job.NextAttemptAt.After(time.Now()) {
				h.processAvatarDeletion(ctx, u.ID, job)
			}
		}
	}
}
