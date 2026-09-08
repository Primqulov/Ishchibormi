package elon

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func ownerEditable(status string) bool {
	return status == "draft" || status == "recruiting" || status == "filled"
}

func ownerCancelable(status string) bool {
	return ownerEditable(status) || status == "in_progress" || status == "confirmed"
}

func cancellationRequired(e models.Elon, acceptedApplication bool) bool {
	return acceptedApplication || e.AcceptedCount > 0 || e.Status == "filled" ||
		e.Status == "in_progress" || e.Status == "confirmed"
}

func (h *Handler) ownerElon(ctx context.Context, id, uid primitive.ObjectID) (models.Elon, error) {
	var e models.Elon
	if uid.IsZero() {
		return e, httpx.NewError(401, "no_account", "Hisobga kiring.")
	}
	err := h.Col.FindOne(ctx, bson.M{
		"_id": id, "ownerId": uid, "isDeleted": bson.M{"$ne": true},
	}).Decode(&e)
	if errors.Is(err, mongo.ErrNoDocuments) {
		err = httpx.NewError(404, "not_found_or_forbidden", "elon not found or not yours")
	}
	return e, err
}

// ownerSnapshotFilter fences simultaneous owner requests and state transitions.
// Legacy listings have neither ownerRevision nor (occasionally) acceptedCount.
func ownerSnapshotFilter(e models.Elon) bson.M {
	return bson.M{
		"_id": e.ID, "ownerId": e.OwnerID, "isDeleted": bson.M{"$ne": true},
		"status": e.Status,
		"$expr": bson.M{"$and": bson.A{
			bson.M{"$eq": bson.A{bson.M{"$ifNull": bson.A{"$ownerRevision", 0}}, e.OwnerRevision}},
			bson.M{"$eq": bson.A{bson.M{"$ifNull": bson.A{"$acceptedCount", 0}}, e.AcceptedCount}},
		}},
	}
}

func ownerUpdateFilter(e models.Elon, workersNeeded int) bson.M {
	f := ownerSnapshotFilter(e)
	expr := f["$expr"].(bson.M)
	expr["$and"] = append(expr["$and"].(bson.A),
		bson.M{"$lte": bson.A{bson.M{"$ifNull": bson.A{"$acceptedCount", 0}}, workersNeeded}})
	return f
}

func ownerCloseFilter(e models.Elon, allowConfirmed bool) bson.M {
	f := ownerSnapshotFilter(e)
	if !allowConfirmed {
		f["status"] = bson.M{"$in": []string{"draft", "recruiting"}}
		expr := f["$expr"].(bson.M)
		expr["$and"] = append(expr["$and"].(bson.A),
			bson.M{"$lte": bson.A{bson.M{"$ifNull": bson.A{"$acceptedCount", 0}}, 0}})
	}
	return f
}

func closeReason(reason string, deleting, confirmed bool) (string, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) > 500 {
		return "", httpx.NewError(400, "reason_too_long", "Bekor qilish sababi 500 belgidan oshmasin.")
	}
	if deleting && confirmed {
		return "", httpx.NewError(409, "cancellation_required", "Ishchilar qabul qilingan. Ishni sabab ko'rsatib bekor qiling.")
	}
	if confirmed && reason == "" {
		return "", httpx.NewError(400, "reason_required", "Bekor qilish sababini yozing.")
	}
	if reason == "" {
		if deleting {
			return "E'lon egasi tomonidan o'chirildi", nil
		}
		return "E'lon bekor qilindi", nil
	}
	return reason, nil
}

func (h *Handler) closeOwnerElon(w http.ResponseWriter, r *http.Request, deleting bool) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	e, err := h.ownerElon(r.Context(), id, uid)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
		Intent string `json:"intent"`
	}
	// Older clients send an empty body. They may only close unconfirmed work.
	if !deleting && r.Body != nil && r.ContentLength != 0 {
		if err := httpx.Decode(r, &req); err != nil {
			httpx.Err(w, err)
			return
		}
	}
	if req.Intent != "" {
		if req.Intent != "delete" {
			httpx.Err(w, httpx.NewError(400, "bad_intent", "Noto'g'ri amal."))
			return
		}
		// New clients use the historical archive endpoint during rolling deploys:
		// an older API still archives it instead of physically deleting records.
		// On this API the explicit intent retains DELETE's confirmed-work guard.
		deleting = true
	}
	if e.Status != "cancelled" {
		if !ownerCancelable(e.Status) {
			httpx.Err(w, httpx.NewError(409, "bad_state", "Bu holatdagi e'lonni bekor qilib bo'lmaydi."))
			return
		}
		accepted, err := h.Applications.CountDocuments(r.Context(),
			bson.M{"elonId": id, "status": "accepted"}, options.Count().SetLimit(1))
		if err != nil {
			httpx.Err(w, err)
			return
		}
		reason, err := closeReason(req.Reason, deleting, cancellationRequired(e, accepted > 0))
		if err != nil {
			httpx.Err(w, err)
			return
		}
		now := time.Now()
		allowConfirmed := !deleting && strings.TrimSpace(req.Reason) != ""
		err = h.Col.FindOneAndUpdate(r.Context(), ownerCloseFilter(e, allowConfirmed),
			bson.M{"$set": bson.M{
				"status": "cancelled", "cancelReason": reason,
				"cancelledAt": now, "updatedAt": now,
				"ownerFollowupPending": true,
			}, "$inc": bson.M{"ownerRevision": 1, "ownerFollowupVersion": 1}},
			options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&e)
		if err != nil {
			if errors.Is(err, mongo.ErrNoDocuments) {
				err = httpx.NewError(409, "state_changed", "E'lon o'zgardi. Yangilab, qayta urinib ko'ring.")
				if latest, readErr := h.ownerElon(r.Context(), id, uid); readErr == nil &&
					!allowConfirmed && cancellationRequired(latest, false) {
					err = httpx.NewError(409, "cancellation_required", "Ishchilar qabul qilingan. Ishni sabab ko'rsatib bekor qiling.")
				}
			}
			httpx.Err(w, err)
			return
		}
	} else {
		// An explicit retry can repair older closed listings, too. The version
		// prevents a concurrent follow-up from clearing newly queued work.
		_, err := h.Col.UpdateOne(r.Context(), bson.M{"_id": e.ID, "ownerId": uid},
			bson.M{"$set": bson.M{"ownerFollowupPending": true}, "$inc": bson.M{"ownerFollowupVersion": 1}})
		if err != nil {
			httpx.Err(w, err)
			return
		}
	}
	// Cancellation is committed. Finishing it no longer depends on the caller
	// keeping their connection open; an unfinished sweep is durably retried.
	if err := h.finishOwnerFollowupDetached(r.Context(), e.ID); err != nil {
		slog.Error("owner cancellation follow-up pending", "elon", e.ID.Hex(), "err", err)
		httpx.Err(w, httpx.NewError(503, "owner_cleanup_pending", "Ish yopildi. Arizalar va bildirishnomalar yangilanmoqda."))
		return
	}
	if deleting {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
	} else {
		httpx.JSON(w, 200, e)
	}
}

func liveCandidateFilter(id primitive.ObjectID) bson.M {
	return bson.M{"elonId": id, "status": bson.M{"$in": []string{"pending", "accepted"}}}
}

func (h *Handler) cancelOwnerCandidates(ctx context.Context, e models.Elon) error {
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
		if err := h.cancelOwnerCandidate(ctx, e, a); err != nil {
			return err
		}
	}
	return cur.Err()
}

// Salary means the effective wage. Increasing a per-worker listing's capacity
// alone changes its aggregate total, but does not change a candidate's wage.
func candidateTermsChanged(before, after models.Elon) bool {
	return before.CategoryID != after.CategoryID || before.PricingType != after.PricingType ||
		before.PerWorkerAmount != after.PerWorkerAmount ||
		((before.PricingType == "total" || after.PricingType == "total") && before.PriceAmount != after.PriceAmount) ||
		*before.WorkDetails() != *after.WorkDetails()
}

func (h *Handler) notifyCandidateChanges(ctx context.Context, _ models.Elon, after models.Elon) {
	if err := h.finishOwnerFollowupDetached(ctx, after.ID); err != nil {
		slog.Error("listing candidate refresh pending", "elon", after.ID.Hex(), "err", err)
	}
}
