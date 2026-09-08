package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/account"
	"github.com/ishchibormi/backend/internal/elonimages"
	"github.com/ishchibormi/backend/internal/elonpurge"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func elonDetailTestHandler(t *testing.T, status string) (*Handler, *mongo.Database, models.Elon, *avatarFakePush) {
	t.Helper()
	db := filterDB(t)
	s, err := storage.NewLocal(t.TempDir(), "https://assets.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	uid := primitive.NewObjectID()
	f, err := s.Upload(context.Background(), "elons/"+uid.Hex(), "photo.png", "image/png", bytes.NewBufferString("original image"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond).Add(-time.Minute)
	e := models.Elon{ID: primitive.NewObjectID(), OwnerID: uid, Status: status, Title: "G'isht terish", OwnerName: "Oldingi ism",
		OwnerAvatarURL: "https://example.test/old.png", Description: "Maxfiy tavsif", ContactPhone: "+998901234567", Images: []string{f.URL},
		OwnerSnapshot: &models.ElonOwnerSnapshot{Name: "Oldingi ism", Phone: "+998909999999", Region: "Andijon", Complete: true},
		CreatedAt:     now, UpdatedAt: now}
	if _, err := db.Collection("elons").InsertOne(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Collection("users").InsertOne(context.Background(), models.User{ID: uid, FirstName: "Hozirgi ism", Phone: "+998900000000", IsPhoneVerified: true}); err != nil {
		t.Fatal(err)
	}
	p := &avatarFakePush{}
	n := notification.New(db)
	n.AttachPusher(p)
	h := &Handler{Elons: db.Collection("elons"), Users: db.Collection("users"), Apps: db.Collection("applications"),
		Admins: db.Collection("admins"), Cats: db.Collection("categories"), ErrGroups: db.Collection("error_groups"),
		Reports: db.Collection("reports"), AuditCol: db.Collection("admin_audit"), Storage: s, Notify: n,
		Purger: account.NewPurger(db, s, 90, nil)}
	return h, db, e, p
}

func elonStatusHTTP(t *testing.T, h *Handler, e models.Elon, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.SetElonStatus(w, blockRequest(t, e.ID, "moderator", string(b)))
	return w
}

func TestElonDetailStatusReasonAndStaleValidation(t *testing.T) {
	now := time.Now().UTC()
	old := now.Add(-time.Second)
	prev := models.Elon{Status: "recruiting", UpdatedAt: now}
	for _, req := range []elonStatusRequest{
		{Status: "filled"}, {Status: "filled", Reason: "  "},
		{Status: "completed", Reason: strings.Repeat("Ў", 501)}, {Status: "draft", Reason: "sabab"},
		{Status: "filled", Reason: "sabab", ExpectedStatus: "cancelled"},
		{Status: "filled", Reason: "sabab", ExpectedUpdatedAt: &old},
	} {
		if req.validate(prev) == nil {
			t.Errorf("invalid change accepted: %+v", req)
		}
	}
	for _, status := range []string{"recruiting", "filled", "in_progress", "completed", "cancelled", "hidden"} {
		req := elonStatusRequest{Status: status, Reason: strings.Repeat("Ў", 500), ExpectedStatus: prev.Status, ExpectedUpdatedAt: &now}
		if err := req.validate(prev); err != nil {
			t.Errorf("valid %s rejected: %v", status, err)
		}
	}
	for _, status := range []string{"hidden", "recruiting"} {
		req := elonStatusRequest{Status: status}
		if err := req.validate(models.Elon{Status: "hidden"}); err != nil {
			t.Errorf("hide/restore requires reason: %v", err)
		}
	}
}

func TestElonDetailHideRestoreRemovesImagesAndPreservesPreviousStatus(t *testing.T) {
	h, _, e, p := elonDetailTestHandler(t, "in_progress")
	w := elonStatusHTTP(t, h, e, map[string]any{"status": "hidden", "expectedStatus": e.Status, "expectedUpdatedAt": e.UpdatedAt})
	if w.Code != 200 {
		t.Fatalf("hide: %d %s", w.Code, w.Body.String())
	}
	var hidden models.Elon
	if err := h.Elons.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&hidden); err != nil {
		t.Fatal(err)
	}
	if hidden.Status != "hidden" || hidden.HiddenFromStatus != "in_progress" || len(hidden.Images) != 0 || hidden.ImagesRemovedAt == nil {
		t.Fatalf("bad hidden record: %+v", hidden)
	}
	if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(e.Images[0]), 1024); err == nil {
		t.Error("hidden image still exists")
	}
	w = elonStatusHTTP(t, h, hidden, map[string]any{"status": "recruiting"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"in_progress"`) {
		t.Fatalf("restore: %d %s", w.Code, w.Body.String())
	}
	var restored models.Elon
	if err := h.Elons.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&restored); err != nil {
		t.Fatal(err)
	}
	if len(restored.Images) != 0 || restored.HiddenFromStatus != "" || restored.OwnerRevision < 2 || p.calls != 0 {
		t.Fatalf("bad restore: %+v, pushes=%d", restored, p.calls)
	}
	count, err := h.Elons.CountDocuments(context.Background(), elonModerationFilter(e))
	if err != nil || count != 0 {
		t.Error("pre-hide snapshot still permits write after restore")
	}
	actions := h.elonAdminActions(context.Background(), e.ID, true)
	if len(actions) != 2 || actions[0].Kind != "restored" || actions[1].FromStatus != "in_progress" || actions[1].Reason == "" {
		t.Fatalf("audit: %+v", actions)
	}
}

func TestElonDetailStatusAuditsReasonAndRespectsOwnerNotification(t *testing.T) {
	for _, notify := range []bool{false, true} {
		t.Run(map[bool]string{false: "no notification", true: "notify"}[notify], func(t *testing.T) {
			h, db, e, p := elonDetailTestHandler(t, "recruiting")
			body := map[string]any{"status": "completed", "reason": "  Ish tugaganini egasi tasdiqladi.  "}
			if !notify {
				body["notifyOwner"] = false
			}
			w := elonStatusHTTP(t, h, e, body)
			if w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			var audit models.AdminAudit
			if err := h.AuditCol.FindOne(context.Background(), bson.M{"target": e.ID.Hex()}).Decode(&audit); err != nil {
				t.Fatal(err)
			}
			if audit.Kind != "status" || audit.Status != "completed" || audit.FromStatus != "recruiting" || audit.Reason != "Ish tugaganini egasi tasdiqladi." || audit.NotifyOwner == nil || *audit.NotifyOwner != notify {
				t.Fatalf("bad audit: %+v", audit)
			}
			count, _ := db.Collection("notifications").CountDocuments(context.Background(), bson.M{"userId": e.OwnerID})
			if count != int64(map[bool]int{false: 0, true: 1}[notify]) || p.calls != int(count) {
				t.Fatalf("notification option ignored: count=%d push=%d", count, p.calls)
			}
			if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(e.Images[0]), 1024); err != nil {
				t.Error("ordinary status change deleted picture")
			}
		})
	}
}

func TestElonDetailRejectsStaleAndConcurrentStatusChanges(t *testing.T) {
	h, _, e, _ := elonDetailTestHandler(t, "recruiting")
	w := elonStatusHTTP(t, h, e, map[string]any{"status": "filled", "reason": "Sabab", "expectedStatus": "in_progress"})
	if w.Code != 409 || !strings.Contains(w.Body.String(), "state_changed") {
		t.Fatalf("stale accepted: %d %s", w.Code, w.Body.String())
	}
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for _, status := range []string{"filled", "in_progress"} {
		body, _ := json.Marshal(map[string]any{"status": status, "reason": "Sabab", "notifyOwner": false, "expectedStatus": e.Status, "expectedUpdatedAt": e.UpdatedAt})
		r := blockRequest(t, e.ID, "moderator", string(body))
		wg.Add(1)
		go func() { defer wg.Done(); w := httptest.NewRecorder(); h.SetElonStatus(w, r); results <- w.Code }()
	}
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent statuses: %v", counts)
	}
	count, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{"target": e.ID.Hex()})
	if count != 1 {
		t.Fatalf("stale request changed audit: %d", count)
	}
}

func TestElonDetailDeletedArchiveMaskedAndPurgeRoleEnforced(t *testing.T) {
	h, db, e, _ := elonDetailTestHandler(t, "recruiting")
	appID := primitive.NewObjectID()
	_, _ = h.Apps.InsertOne(context.Background(), models.Application{ID: appID, ElonID: e.ID, WorkerName: "Ishchi", Status: "pending"})
	_, _ = db.Collection("notifications").InsertOne(context.Background(), models.Notification{ID: primitive.NewObjectID(), RelatedEntity: &models.RelatedEntity{Type: "application", ID: appID}})
	w := httptest.NewRecorder()
	h.DeleteElon(w, blockRequest(t, e.ID, "moderator", ""))
	if w.Code != 200 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.GetElon(w, blockRequest(t, e.ID, "moderator", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"isDeleted":true`) {
		t.Fatalf("archive: %d %s", w.Code, w.Body.String())
	}
	for _, secret := range []string{e.Description, e.ContactPhone, e.OwnerSnapshot.Phone, "Ishchi"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Errorf("archive leaked %q", secret)
		}
	}
	w = elonStatusHTTP(t, h, e, map[string]any{"status": "recruiting", "reason": "Tiklash"})
	if w.Code != 409 {
		t.Error("deleted record was restored")
	}
	for _, role := range []string{"moderator", "superadmin"} {
		r := blockRequest(t, e.ID, role, "")
		r.URL.RawQuery = "mode=purge"
		w = httptest.NewRecorder()
		h.DeleteElon(w, r)
		if w.Code != map[string]int{"moderator": 403, "superadmin": 200}[role] {
			t.Fatalf("purge %s: %d %s", role, w.Code, w.Body.String())
		}
	}
	for _, col := range []*mongo.Collection{h.Elons, h.Apps, db.Collection("notifications")} {
		if count, _ := col.CountDocuments(context.Background(), bson.M{}); count != 0 {
			t.Errorf("purge left %s documents: %d", col.Name(), count)
		}
	}
}

func TestElonDetailStorageRetryDoesNotDuplicateAudit(t *testing.T) {
	h, _, e, _ := elonDetailTestHandler(t, "recruiting")
	s := h.Storage
	h.Storage = nil
	w := elonStatusHTTP(t, h, e, map[string]any{"status": "hidden"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"cleanupPending":true`) {
		t.Fatalf("pending cleanup: %d %s", w.Code, w.Body.String())
	}
	var pending models.Elon
	if err := h.Elons.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&pending); err != nil || len(pending.ModerationJobs) != 1 {
		t.Fatalf("durable cleanup missing: %+v %v", pending, err)
	}
	h.Storage = s
	job := h.processElonModeration(context.Background(), e.ID, e.OwnerID, pending.ModerationJobs[0])
	if !job.StorageDone || !job.AuditDone || !job.NotifyDone {
		t.Fatalf("retry failed: %+v", job)
	}
	if count, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{}); count != 1 {
		t.Errorf("duplicate audit: %d", count)
	}
	if _, err := s.Download(context.Background(), s.KeyFromURL(e.Images[0]), 1024); err == nil {
		t.Error("retry left image")
	}
}

func TestElonDetailSupportCannotReadOrWrite(t *testing.T) {
	h := &Handler{}
	for _, handler := range []func(http.ResponseWriter, *http.Request){h.GetElon, h.SetElonStatus, h.DeleteElon} {
		w := httptest.NewRecorder()
		handler(w, blockRequest(t, primitive.NewObjectID(), "support", `{"status":"hidden"}`))
		if w.Code != 403 {
			t.Errorf("support status %d", w.Code)
		}
	}
}

func TestElonDetailCountsSnapshotAndTargetFilters(t *testing.T) {
	h, _, e, _ := elonDetailTestHandler(t, "recruiting")
	otherID := primitive.NewObjectID()
	for i := 0; i < 105; i++ {
		_, _ = h.Apps.InsertOne(context.Background(), models.Application{ID: primitive.NewObjectID(), ElonID: e.ID, Status: "pending", AppliedAt: time.Now()})
		_, _ = h.AuditCol.InsertOne(context.Background(), models.AdminAudit{ID: primitive.NewObjectID(), Action: "elon_status", Target: e.ID.Hex(), Detail: "hidden — oldingi holat", CreatedAt: time.Now()})
		_, _ = h.Reports.InsertOne(context.Background(), models.Report{ID: primitive.NewObjectID(), TargetType: "elon", TargetID: e.ID, Reason: "spam"})
	}
	_, _ = h.Apps.InsertOne(context.Background(), models.Application{ID: primitive.NewObjectID(), ElonID: otherID, Status: "pending"})
	_, _ = h.AuditCol.InsertOne(context.Background(), models.AdminAudit{ID: primitive.NewObjectID(), Action: "elon_status", Target: otherID.Hex(), Detail: "hidden"})
	_, _ = h.AuditCol.InsertOne(context.Background(), models.AdminAudit{ID: primitive.NewObjectID(), Action: "export_elons", Target: "", Detail: "export"})
	w := httptest.NewRecorder()
	h.GetElon(w, blockRequest(t, e.ID, "moderator", ""))
	if w.Code != 200 {
		t.Fatalf("detail: %d %s", w.Code, w.Body.String())
	}
	var d struct {
		OwnerSnapshot     models.ElonOwnerSnapshot `json:"ownerSnapshot"`
		Owner             elonOwnerBrief           `json:"owner"`
		Applications      []elonApplicationRow     `json:"applications"`
		ApplicationCounts map[string]int           `json:"applicationCounts"`
		AdminActions      []elonAdminAction        `json:"adminActions"`
		AdminActionCounts map[string]int           `json:"adminActionCounts"`
		ReportsTotal      int                      `json:"reportsTotal"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if d.OwnerSnapshot.Name != "Oldingi ism" || d.Owner.FirstName != "Hozirgi ism" || d.OwnerSnapshot.Phone == d.Owner.Phone {
		t.Fatalf("snapshot overwritten: %+v", d)
	}
	if len(d.Applications) != 100 || d.ApplicationCounts["pending"] != 105 || len(d.AdminActions) != 100 || d.AdminActionCounts["hidden"] != 105 || d.ReportsTotal != 105 {
		t.Errorf("truncated counts: apps=%d/%v audit=%d/%v reports=%d", len(d.Applications), d.ApplicationCounts, len(d.AdminActions), d.AdminActionCounts, d.ReportsTotal)
	}
	for _, test := range []struct {
		name, query string
		handler     func(http.ResponseWriter, *http.Request)
	}{
		{"applications", "elonId=" + e.ID.Hex(), h.ListApplications}, {"audit", "target=" + e.ID.Hex(), h.Audit},
	} {
		r := blockRequest(t, e.ID, "moderator", "")
		r.URL.RawQuery = test.query + "&page=2&limit=20"
		w := httptest.NewRecorder()
		test.handler(w, r)
		var page struct {
			Total, Overall int
			Items          []json.RawMessage
		}
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || w.Code != 200 || page.Total != 105 || len(page.Items) != 20 {
			t.Errorf("%s filter: %d %s %v", test.name, w.Code, w.Body.String(), err)
		}
		if test.name == "applications" && page.Overall != 105 {
			t.Errorf("scoped overall %d", page.Overall)
		}
	}
	if f := appsFilter(url.Values{"elonId": {"not-an-id"}}); f["elonId"] != primitive.NilObjectID {
		t.Error("invalid listing scope widened")
	}
	r := blockRequest(t, e.ID, "moderator", "")
	r.URL.RawQuery = "target=invalid"
	w = httptest.NewRecorder()
	h.Audit(w, r)
	if w.Code != 400 {
		t.Error("invalid audit target widened scope")
	}
}

func TestElonDirectPurgePreservesAvatarAndOtherOwnersFiles(t *testing.T) {
	h, db, e, _ := elonDetailTestHandler(t, "recruiting")
	avatar, err := h.Storage.Upload(context.Background(), "avatars/"+e.OwnerID.Hex(), "avatar.png", "image/png", bytes.NewBufferString("avatar"))
	if err != nil {
		t.Fatal(err)
	}
	other, err := h.Storage.Upload(context.Background(), "elons/"+primitive.NewObjectID().Hex(), "other.png", "image/png", bytes.NewBufferString("other"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.Elons.UpdateOne(context.Background(), bson.M{"_id": e.ID}, bson.M{"$set": bson.M{"images": bson.A{e.Images[0], avatar.URL, other.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	r := blockRequest(t, e.ID, "superadmin", "")
	r.URL.RawQuery = "mode=purge"
	w := httptest.NewRecorder()
	h.DeleteElon(w, r)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(e.Images[0]), 1024); err == nil {
		t.Error("owned image survived")
	}
	for _, f := range []string{avatar.URL, other.URL} {
		if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(f), 1024); err != nil {
			t.Errorf("unrelated file erased: %v", err)
		}
	}
	if n, _ := db.Collection("elons").CountDocuments(context.Background(), bson.M{"_id": e.ID}); n != 0 {
		t.Error("listing survived")
	}
}

func TestElonDirectPurgeStorageUnavailableKeepsRetryAndNoFalseAudit(t *testing.T) {
	h, db, e, _ := elonDetailTestHandler(t, "recruiting")
	h.Purger = account.NewPurger(db, nil, 90, nil)
	r := blockRequest(t, e.ID, "superadmin", "")
	r.URL.RawQuery = "mode=purge"
	w := httptest.NewRecorder()
	h.DeleteElon(w, r)
	if w.Code < 400 {
		t.Fatalf("purge falsely succeeded: %d %s", w.Code, w.Body.String())
	}
	var kept models.Elon
	if err := h.Elons.FindOne(context.Background(), bson.M{"_id": e.ID}).Decode(&kept); err != nil {
		t.Fatal(err)
	}
	if !kept.IsDeleted || len(kept.Images) != 1 || kept.PurgeEvent == nil {
		t.Fatalf("retry source lost: %+v", kept)
	}
	if n, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{"kind": "purged"}); n != 0 {
		t.Error("failed purge audited as success")
	}
	h.Purger = account.NewPurger(db, h.Storage, 90, nil)
	w = httptest.NewRecorder()
	h.DeleteElon(w, r)
	if w.Code != 200 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	var audit models.AdminAudit
	if err := h.AuditCol.FindOne(context.Background(), bson.M{"kind": "purged"}).Decode(&audit); err != nil || audit.ID != kept.PurgeEvent.ID {
		t.Fatalf("stable purge event lost: %+v %v", audit, err)
	}
}

func TestElonPurgeAuditRecoversAfterFinalRowRemoval(t *testing.T) {
	h, db, e, _ := elonDetailTestHandler(t, "recruiting")
	audit := h.AuditCol
	h.AuditCol = nil
	r := blockRequest(t, e.ID, "superadmin", "")
	r.URL.RawQuery = "mode=purge"
	w := httptest.NewRecorder()
	h.DeleteElon(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"auditPending":true`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if n, _ := db.Collection(elonpurge.Collection).CountDocuments(context.Background(), bson.M{}); n != 1 {
		t.Fatalf("durable event count %d", n)
	}
	if n, _ := h.Elons.CountDocuments(context.Background(), bson.M{"_id": e.ID}); n != 0 {
		t.Error("listing not purged")
	}
	h.AuditCol = audit
	elonpurge.Retry(context.Background(), db, audit)
	elonpurge.Retry(context.Background(), db, audit)
	if n, _ := audit.CountDocuments(context.Background(), bson.M{"kind": "purged", "target": e.ID.Hex()}); n != 1 {
		t.Errorf("audit count %d", n)
	}
	if n, _ := db.Collection(elonpurge.Collection).CountDocuments(context.Background(), bson.M{}); n != 0 {
		t.Error("finished event retained")
	}
}

func TestElonSharedImagesAreDetachedAndQueuedImagesCannotBeReattached(t *testing.T) {
	h, db, e, _ := elonDetailTestHandler(t, "recruiting")
	other := models.Elon{ID: primitive.NewObjectID(), OwnerID: e.OwnerID, Status: "recruiting", Images: e.Images}
	if _, err := h.Elons.InsertOne(context.Background(), other); err != nil {
		t.Fatal(err)
	}
	w := elonStatusHTTP(t, h, e, map[string]any{"status": "hidden"})
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(e.Images[0]), 1024); err != nil {
		t.Error("another listing's shared file erased")
	}
	if err := elonimages.Reserve(context.Background(), db, h.Storage, primitive.NewObjectID(), e.OwnerID, e.Images); err == nil {
		t.Error("shared/removed URL can be newly attached")
	}
	// A storage outage leaves a durable URL reference. A fresh edit after
	// restore must not reattach that URL before the cleanup worker catches up.
	f, err := h.Storage.Upload(context.Background(), "elons/"+e.OwnerID.Hex(), "new.png", "image/png", bytes.NewBufferString("new"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = h.Elons.UpdateOne(context.Background(), bson.M{"_id": other.ID}, bson.M{"$set": bson.M{"images": bson.A{f.URL}}})
	s := h.Storage
	h.Storage = nil
	w = elonStatusHTTP(t, h, other, map[string]any{"status": "hidden"})
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	w = elonStatusHTTP(t, h, other, map[string]any{"status": "recruiting"})
	if w.Code != 200 {
		t.Fatalf("restore: %d %s", w.Code, w.Body.String())
	}
	for _, id := range []primitive.ObjectID{other.ID, primitive.NewObjectID()} {
		if err := elonimages.Reserve(context.Background(), db, s, id, e.OwnerID, []string{f.URL}); err == nil {
			t.Errorf("queued URL reattached to %s", id.Hex())
		}
	}
}
