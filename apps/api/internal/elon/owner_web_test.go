package elon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func ownerWebPatch(e models.Elon) map[string]any {
	amount := e.PriceAmount
	if e.PricingType == "per_worker" {
		amount = e.PerWorkerAmount
	}
	return map[string]any{
		"title": e.Title, "description": e.Description, "workersNeeded": e.WorkersNeeded,
		"pricingType": e.PricingType, "priceAmount": amount,
	}
}

func ownerReadListing(t *testing.T, h *Handler, id primitive.ObjectID) models.Elon {
	t.Helper()
	var e models.Elon
	if err := h.Col.FindOne(context.Background(), bson.M{"_id": id}).Decode(&e); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestOwnerEditPreservesOmittedWorkDetailsAndLegacyDate(t *testing.T) {
	for _, date := range []string{"2020-01-01T14:00:00", "2099-01-01", "legacy date"} {
		for _, full := range []bool{false, true} {
			name := date + "/omitted"
			if full {
				name = date + "/unchanged full form"
			}
			t.Run(name, func(t *testing.T) {
				db := ownerTestDB(t)
				h, e, p := ownerTestHandler(t, db, "recruiting", 0)
				e.StartDate, e.WorkTimeFrom, e.WorkTimeTo = date, "14:00", "18:00"
				e.LocationText, e.Region, e.District = "Chilonzor, 12-mavze", "Toshkent", "Chilonzor"
				e.Lat, e.Lng = 41.285, 69.203
				// A legacy listing may have coordinates but no generated map URL.
				if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": e.ID}, e); err != nil {
					t.Fatal(err)
				}
				a := ownerSeedCandidate(t, h, e, "pending")
				patch := ownerWebPatch(e)
				patch["title"] = "Yangilangan sarlavha"
				if full {
					patch["startDate"], patch["workTimeFrom"], patch["workTimeTo"] = e.StartDate, e.WorkTimeFrom, e.WorkTimeTo
					patch["locationText"], patch["locationUrl"] = e.LocationText, e.LocationURL
					patch["lat"], patch["lng"], patch["region"], patch["district"] = e.Lat, e.Lng, e.Region, e.District
				}
				w := httptest.NewRecorder()
				h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, patch))
				got := ownerReadListing(t, h, e.ID)
				if w.Code != 200 || *got.WorkDetails() != *e.WorkDetails() || p.calls != 0 {
					t.Fatalf("unchanged details were cleared/validated/notified: code=%d body=%s got=%+v pushes=%d", w.Code, w.Body.String(), got.WorkDetails(), p.calls)
				}
				var app models.Application
				if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&app); err != nil || app.ElonWorkDetails == nil || *app.ElonWorkDetails != *e.WorkDetails() {
					t.Fatalf("legacy snapshot was not initialized quietly: %+v %v", app, err)
				}
			})
		}
	}
}

func TestOwnerWorkDetailsNotifyLiveCandidatesOnlyOnce(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		value       any
	}{
		{"date", "startDate", time.Now().In(uzTZ).AddDate(0, 0, 1).Format("2006-01-02")},
		{"start time", "workTimeFrom", "15:00"},
		{"end time", "workTimeTo", "19:00"},
		{"street address", "locationText", "Chilonzor, 13-mavze"},
		{"map URL", "locationUrl", "https://maps.google.com/?q=Chilonzor"},
		{"district", "district", "Yunusobod"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := ownerTestDB(t)
			h, e, p := ownerTestHandler(t, db, "recruiting", 1)
			e.StartDate = time.Now().In(uzTZ).Format("2006-01-02")
			e.WorkTimeFrom, e.WorkTimeTo = "14:00", "18:00"
			e.LocationText, e.Region, e.District = "Chilonzor, 12-mavze", "Toshkent", "Chilonzor"
			if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": e.ID}, e); err != nil {
				t.Fatal(err)
			}
			legacy := ownerSeedCandidate(t, h, e, "pending")
			accepted := ownerSeedCandidate(t, h, e, "accepted")
			completed := ownerSeedCandidate(t, h, e, "completed")
			for _, a := range []models.Application{accepted, completed} {
				if _, err := h.Applications.UpdateOne(context.Background(), bson.M{"_id": a.ID}, bson.M{"$set": bson.M{"elonWorkDetails": e.WorkDetails()}}); err != nil {
					t.Fatal(err)
				}
			}
			patch := ownerWebPatch(e)
			patch[tc.field] = tc.value
			w := httptest.NewRecorder()
			h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, patch))
			if w.Code != 200 || p.calls != 2 {
				t.Fatalf("work edit notification: %d %s pushes=%d", w.Code, w.Body.String(), p.calls)
			}
			updated := ownerReadListing(t, h, e.ID)
			if *updated.WorkDetails() == *e.WorkDetails() || updated.OwnerWorkDetailsRevision != 1 {
				t.Fatalf("work change not stored with its revision: %+v", updated)
			}
			for _, a := range []models.Application{legacy, accepted, completed} {
				var got models.Application
				if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&got); err != nil {
					t.Fatal(err)
				}
				want := updated.WorkDetails()
				if a.Status == "completed" {
					want = e.WorkDetails()
				}
				if got.ElonWorkDetails == nil || *got.ElonWorkDetails != *want || got.Status != a.Status {
					t.Fatalf("candidate snapshot/status incorrect: %+v", got)
				}
			}
			// An identical save and then a content-only save do not send again.
			for _, title := range []string{e.Title, "Yangi sarlavha"} {
				patch["title"] = title
				w = httptest.NewRecorder()
				h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, patch))
				if w.Code != 200 || p.calls != 2 {
					t.Fatalf("no-op/title edit sent duplicate notice: %d %s pushes=%d", w.Code, w.Body.String(), p.calls)
				}
			}
			var notice models.Notification
			if err := h.Notify.Col.FindOne(context.Background(), bson.M{"userId": legacy.WorkerID}).Decode(&notice); err != nil || notice.Type != "elon_updated" || notice.RelatedEntity == nil || notice.RelatedEntity.ID != e.ID || !strings.Contains(notice.Body, "sana yoki manzil") {
				t.Fatalf("work change notification contract: %+v err=%v", notice, err)
			}
		})
	}
}

func TestOwnerTitleSaveCarriesMissedWorkDetailsNotification(t *testing.T) {
	for _, legacy := range []bool{true, false} {
		name := "current snapshot"
		if legacy {
			name = "legacy snapshot"
		}
		t.Run(name, func(t *testing.T) {
			db := ownerTestDB(t)
			h, e, p := ownerTestHandler(t, db, "recruiting", 0)
			a := ownerSeedCandidate(t, h, e, "pending")
			if !legacy {
				if _, err := h.Applications.UpdateOne(context.Background(), bson.M{"_id": a.ID}, bson.M{"$set": bson.M{"elonWorkDetails": e.WorkDetails()}}); err != nil {
					t.Fatal(err)
				}
			}
			// Date/address save commits, then a title-only save wins before either
			// detached follow-up runs. The marker must survive the second save.
			e.StartDate, e.LocationText = "2026-09-09", "Yangi manzil"
			e.OwnerRevision, e.OwnerWorkDetailsRevision = 1, 1
			e.OwnerFollowupPending, e.OwnerFollowupVersion = true, 1
			if _, err := h.Col.ReplaceOne(context.Background(), bson.M{"_id": e.ID}, e); err != nil {
				t.Fatal(err)
			}
			patch := ownerWebPatch(e)
			patch["title"] = "Yangi sarlavha"
			w := httptest.NewRecorder()
			h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, patch))
			if w.Code != 200 || p.calls != 1 {
				t.Fatalf("title-only save lost pending work edit: %d %s pushes=%d", w.Code, w.Body.String(), p.calls)
			}
			var got models.Application
			if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&got); err != nil || got.ElonOwnerRevision != 2 || got.ElonWorkDetails == nil || got.ElonWorkDetails.LocationText != "Yangi manzil" {
				t.Fatalf("work snapshot not caught up: %+v err=%v", got, err)
			}
			h.retryOwnerActions(context.Background())
			if p.calls != 1 {
				t.Fatalf("retry duplicated work edit: %d", p.calls)
			}
		})
	}
}

func TestOwnerArchivedGetWithOptionalBearerAuth(t *testing.T) {
	db := ownerTestDB(t)
	h, e, _ := ownerTestHandler(t, db, "cancelled", 0)
	a := ownerSeedCandidate(t, h, e, "cancelled")
	const secret = "owner-web-test-secret"
	router := chi.NewRouter()
	router.Use(httpx.OptionalUserAuth(secret, ""))
	router.Get("/api/elons/{id}", h.Get)
	for _, tc := range []struct {
		name string
		id   primitive.ObjectID
		want int
	}{
		{"owner", e.OwnerID, 200},
		{"past applicant", a.WorkerID, 200},
		{"another account", primitive.NewObjectID(), 404},
		{"anonymous", primitive.NilObjectID, 404},
		{"invalid token", primitive.NilObjectID, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/elons/"+e.ID.Hex(), nil)
			if !tc.id.IsZero() {
				token := jwt.NewWithClaims(jwt.SigningMethodHS256, httpx.Claims{
					UserID: tc.id.Hex(), RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
				})
				signed, err := token.SignedString([]byte(secret))
				if err != nil {
					t.Fatal(err)
				}
				r.Header.Set("Authorization", "Bearer "+signed)
			} else if tc.name == "invalid token" {
				r.Header.Set("Authorization", "Bearer invalid-token")
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("optional-auth archive access: %d %s", w.Code, w.Body.String())
			}
			if tc.want == 200 {
				var got models.Elon
				if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got.ID != e.ID || got.Status != "cancelled" {
					t.Fatalf("archive payload: %+v err=%v", got, err)
				}
			}
		})
	}
}
