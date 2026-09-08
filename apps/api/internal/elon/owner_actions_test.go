package elon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestOwnerCloseRules(t *testing.T) {
	for _, tc := range []struct {
		name, status, reason, code string
		count                      int
		accepted, deleting         bool
	}{
		{name: "unconfirmed delete", status: "recruiting", deleting: true},
		{name: "legacy empty cancel", status: "recruiting"},
		{name: "accepted count", status: "recruiting", count: 1, deleting: true, code: "cancellation_required"},
		{name: "accepted document with stale count", status: "recruiting", accepted: true, deleting: true, code: "cancellation_required"},
		{name: "filled", status: "filled", deleting: true, code: "cancellation_required"},
		{name: "started", status: "in_progress", deleting: true, code: "cancellation_required"},
		{name: "confirmed", status: "confirmed", deleting: true, code: "cancellation_required"},
		{name: "legacy cannot bypass accepted", status: "recruiting", accepted: true, code: "reason_required"},
		{name: "blank reason", status: "filled", reason: "  ", code: "reason_required"},
		{name: "reasoned cancel", status: "filled", reason: "Ish boshqa kunga ko'chdi"},
		{name: "500 unicode letters allowed", status: "filled", reason: strings.Repeat("ў", 500)},
		{name: "too long", status: "filled", reason: strings.Repeat("ў", 501), code: "reason_too_long"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := models.Elon{Status: tc.status, AcceptedCount: tc.count}
			reason, err := closeReason(tc.reason, tc.deleting, cancellationRequired(e, tc.accepted))
			if tc.code == "" {
				if err != nil || reason == "" {
					t.Fatalf("reason=%q err=%v", reason, err)
				}
				return
			}
			var he *httpx.HTTPError
			if !errors.As(err, &he) || he.Code != tc.code {
				t.Fatalf("got %v, want %s", err, tc.code)
			}
		})
	}
	for _, status := range []string{"cancelled", "completed", "hidden", "unknown"} {
		if ownerEditable(status) || ownerCancelable(status) {
			t.Errorf("terminal/unknown status %q remained mutable", status)
		}
	}
}

func TestCandidateTermsChanges(t *testing.T) {
	before := models.Elon{CategoryID: primitive.NewObjectID(), PricingType: "per_worker", PriceAmount: 200, PerWorkerAmount: 100}
	for _, tc := range []struct {
		name string
		edit func(*models.Elon)
		want bool
	}{
		{"title only", func(e *models.Elon) { e.Title = "New title" }, false},
		{"unchanged effective salary", func(e *models.Elon) { e.WorkersNeeded = 3; e.PriceAmount = 300 }, false},
		{"salary", func(e *models.Elon) { e.PerWorkerAmount = 150 }, true},
		{"category", func(e *models.Elon) { e.CategoryID = primitive.NewObjectID() }, true},
		{"negotiable", func(e *models.Elon) { e.PricingType = "negotiable" }, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			after := before
			tc.edit(&after)
			if got := candidateTermsChanged(before, after); got != tc.want {
				t.Fatalf("changed=%v, want %v", got, tc.want)
			}
		})
	}
}

type ownerPushRecorder struct {
	calls  int
	onPush func()
}

func (p *ownerPushRecorder) PushUser(_ primitive.ObjectID, _ string, _ any) {
	p.calls++
	if p.onPush != nil {
		p.onPush()
	}
}

// Only a local, isolated test database is used. No application configuration or
// production URI is read; the suite skips if a local Mongo is unavailable.
func ownerTestDB(t *testing.T) *mongo.Database {
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
	db := client.Database("ib_owner_actions_test_" + primitive.NewObjectID().Hex())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Drop(ctx)
		_ = client.Disconnect(ctx)
	})
	return db
}

func ownerRequest(method string, e models.Elon, uid primitive.ObjectID, body any) *http.Request {
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, "/api/elons/"+e.ID.Hex(), bytes.NewReader(data))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", e.ID.Hex())
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, httpx.CtxUserID, uid.Hex())
	return r.WithContext(ctx)
}

func ownerTestHandler(t *testing.T, db *mongo.Database, status string, count int) (*Handler, models.Elon, *ownerPushRecorder) {
	t.Helper()
	e := models.Elon{
		ID: primitive.NewObjectID(), OwnerID: primitive.NewObjectID(), CategoryID: primitive.NewObjectID(),
		Title: "Kunlik ish", CategoryName: "Qurilish", Description: "Ish tavsifi", Status: status,
		WorkersNeeded: 3, AcceptedCount: count, PricingType: "per_worker", PriceAmount: 300, PerWorkerAmount: 100,
		Images: []string{"https://images.example/job.jpg"}, UpdatedAt: time.Now(),
	}
	if _, err := db.Collection("elons").InsertOne(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	n := notification.New(db)
	p := &ownerPushRecorder{}
	n.AttachPusher(p)
	h := &Handler{Col: db.Collection("elons"), Applications: db.Collection("applications"), Categories: db.Collection("categories"), Users: db.Collection("users"), Notify: n}
	return h, e, p
}

func ownerSeedCandidate(t *testing.T, h *Handler, e models.Elon, status string) models.Application {
	t.Helper()
	a := models.Application{
		ID: primitive.NewObjectID(), ElonID: e.ID, EmployerID: e.OwnerID, WorkerID: primitive.NewObjectID(),
		ElonTitle: e.Title, ElonCategoryName: e.CategoryName, Status: status, Amount: e.PerWorkerAmount,
	}
	if _, err := h.Applications.InsertOne(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	return a
}

func TestOwnerHandlersPreserveArchiveAndNotify(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 0)
	pending := ownerSeedCandidate(t, h, e, "pending")
	done := ownerSeedCandidate(t, h, e, "completed")
	store, err := storage.NewLocal(t.TempDir(), "https://images.example")
	if err != nil {
		t.Fatal(err)
	}
	h.Storage = store
	file, err := store.Upload(context.Background(), "elons/"+e.OwnerID.Hex(), "job.jpg", "image/jpeg", strings.NewReader("test image"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Col.UpdateOne(context.Background(), bson.M{"_id": e.ID}, bson.M{"$set": bson.M{"images": []string{file.URL}}}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.Delete(w, ownerRequest(http.MethodDelete, e, e.OwnerID, nil))
	if w.Code != 200 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	var archived models.Elon
	if err := h.Col.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&archived); err != nil {
		t.Fatal("listing was physically removed", err)
	}
	if archived.Status != "cancelled" || archived.IsDeleted || archived.CancelReason == "" || archived.CancelledAt == nil || len(archived.Images) != 1 {
		t.Fatalf("archive fields: %+v", archived)
	}
	if _, err := store.Download(context.Background(), file.Key, 100); err != nil {
		t.Fatalf("archive image was removed: %v", err)
	}
	for _, a := range []models.Application{pending, done} {
		var got models.Application
		if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&got); err != nil {
			t.Fatal("application history was removed", err)
		}
		if a.Status == "completed" && got.Status != "completed" {
			t.Fatal("completed history changed")
		}
		if a.Status == "pending" && (got.Status != "cancelled" || got.CancelReason != archived.CancelReason) {
			t.Fatalf("candidate not cancelled with reason: %+v", got)
		}
	}
	if p.calls != 1 {
		t.Fatalf("candidate push count=%d", p.calls)
	}
	// Retry must not duplicate the worker's notification.
	h.Delete(httptest.NewRecorder(), ownerRequest(http.MethodDelete, e, e.OwnerID, nil))
	if p.calls != 1 {
		t.Fatal("repeated delete notified twice")
	}
	for _, tc := range []struct {
		uid  primitive.ObjectID
		code int
	}{{e.OwnerID, 200}, {pending.WorkerID, 200}, {primitive.NilObjectID, 404}} {
		w := httptest.NewRecorder()
		h.Get(w, ownerRequest(http.MethodGet, e, tc.uid, nil))
		if w.Code != tc.code {
			t.Fatalf("archived details access: got %d want %d", w.Code, tc.code)
		}
	}
	w = httptest.NewRecorder()
	h.MyElons(w, ownerRequest(http.MethodGet, e, e.OwnerID, nil))
	var grouped struct{ Active, Archived []models.Elon }
	if err := json.Unmarshal(w.Body.Bytes(), &grouped); err != nil || len(grouped.Active) != 0 || len(grouped.Archived) != 1 {
		t.Fatalf("owner archive: %s (%v)", w.Body.String(), err)
	}
}

func TestOwnerConfirmedCancellationAndAuthorization(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 0)
	ownerSeedCandidate(t, h, e, "accepted") // stale count must not bypass the guard
	for _, method := range []string{http.MethodDelete, http.MethodPost} {
		w := httptest.NewRecorder()
		r := ownerRequest(method, e, e.OwnerID, nil)
		if method == http.MethodDelete {
			h.Delete(w, r)
		} else {
			h.Cancel(w, r)
		}
		if w.Code < 400 || p.calls != 0 {
			t.Fatalf("unreasoned confirmed close passed: %d %s", w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	h.Cancel(w, ownerRequest(http.MethodPost, e, e.OwnerID, map[string]string{"intent": "delete", "reason": "Sabab"}))
	if w.Code != 409 || !strings.Contains(w.Body.String(), "cancellation_required") || p.calls != 0 {
		t.Fatalf("delete intent bypassed accepted guard: %d %s", w.Code, w.Body.String())
	}
	for _, fn := range []http.HandlerFunc{h.Delete, h.Cancel, h.Update} {
		w := httptest.NewRecorder()
		fn(w, ownerRequest(http.MethodPost, e, primitive.NewObjectID(), nil))
		if w.Code != 404 {
			t.Fatalf("non-owner got %d", w.Code)
		}
	}
	w = httptest.NewRecorder()
	h.Cancel(w, ownerRequest(http.MethodPost, e, e.OwnerID, map[string]string{"reason": "  Material kelmadi  "}))
	if w.Code != 200 || p.calls != 1 {
		t.Fatalf("reasoned cancel: %d %s pushes=%d", w.Code, w.Body.String(), p.calls)
	}
	var got models.Elon
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got.CancelReason != "Material kelmadi" {
		t.Fatalf("reason not returned: %s", w.Body.String())
	}
	// The compatibility path archives unconfirmed work, just like DELETE.
	h, e, _ = ownerTestHandler(t, db, "recruiting", 0)
	w = httptest.NewRecorder()
	h.Cancel(w, ownerRequest(http.MethodPost, e, e.OwnerID, map[string]string{"intent": "delete"}))
	if w.Code != 200 {
		t.Fatalf("delete intent: %d %s", w.Code, w.Body.String())
	}
	if err := h.Col.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&got); err != nil || got.Status != "cancelled" || got.IsDeleted {
		t.Fatalf("delete intent lost archive: %+v %v", got, err)
	}
}

func TestOwnerEditTermsAndStateRaces(t *testing.T) {
	db := ownerTestDB(t)
	h, e, p := ownerTestHandler(t, db, "recruiting", 1)
	active := ownerSeedCandidate(t, h, e, "accepted")
	terminal := ownerSeedCandidate(t, h, e, "completed")
	cat := models.Category{ID: primitive.NewObjectID(), Name: "Tozalash"}
	if _, err := h.Categories.InsertOne(context.Background(), cat); err != nil {
		t.Fatal(err)
	}
	req := upsertReq{Title: e.Title, Description: e.Description, WorkersNeeded: 3, PricingType: "per_worker", PriceAmount: 200, CategoryID: cat.ID.Hex()}
	w := httptest.NewRecorder()
	h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, req))
	if w.Code != 200 || p.calls != 1 {
		t.Fatalf("terms edit: %d %s pushes=%d", w.Code, w.Body.String(), p.calls)
	}
	for _, a := range []models.Application{active, terminal} {
		var got models.Application
		if err := h.Applications.FindOne(context.Background(), bson.M{"_id": a.ID}).Decode(&got); err != nil {
			t.Fatal(err)
		}
		if a.Status == "accepted" && (got.Amount != 200 || got.ElonCategoryName != cat.Name) {
			t.Fatalf("active terms stale: %+v", got)
		}
		if a.Status == "completed" && got.Amount != 100 {
			t.Fatal("terminal agreed terms changed")
		}
	}
	req.Title = "Yangi sarlavha"
	w = httptest.NewRecorder()
	h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, req))
	if w.Code != 200 || p.calls != 1 {
		t.Fatalf("content-only edit notified: %d pushes=%d", w.Code, p.calls)
	}
	// An earlier save's slow follow-up cannot roll candidate cards back.
	h.notifyCandidateChanges(context.Background(), models.Elon{}, e)
	var latestCandidate models.Application
	if err := h.Applications.FindOne(context.Background(), bson.M{"_id": active.ID}).Decode(&latestCandidate); err != nil || latestCandidate.Amount != 200 || p.calls != 1 {
		t.Fatalf("stale follow-up rewrote terms: %+v err=%v pushes=%d", latestCandidate, err, p.calls)
	}
	// A request validated before this edit must not overwrite the current terms.
	res, err := h.Col.UpdateOne(context.Background(), ownerUpdateFilter(e, 3), bson.M{"$set": bson.M{"title": "Stale overwrite"}})
	if err != nil || res.MatchedCount != 0 {
		t.Fatalf("stale owner snapshot matched: %v %+v", err, res)
	}
	// A confirmed/accepted listing must not match the unconfirmed DELETE gate.
	var current models.Elon
	_ = h.Col.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&current)
	res, err = h.Col.UpdateOne(context.Background(), ownerCloseFilter(current, false), bson.M{"$set": bson.M{"status": "cancelled"}})
	if err != nil || res.MatchedCount != 0 {
		t.Fatalf("accepted listing deleted without reason: %v %+v", err, res)
	}
	if _, err := h.Col.UpdateOne(context.Background(), bson.M{"_id": e.ID}, bson.M{"$set": bson.M{"status": "cancelled"}}); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	h.Update(w, ownerRequest(http.MethodPatch, e, e.OwnerID, req))
	if w.Code != 409 || p.calls != 1 {
		t.Fatalf("closed listing remained editable: %d", w.Code)
	}
}
