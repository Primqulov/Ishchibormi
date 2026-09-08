package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/notification"
	"github.com/ishchibormi/backend/internal/user"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type avatarFakePush struct {
	calls int
	mu    sync.Mutex
}

func (p *avatarFakePush) PushUser(_ primitive.ObjectID, _ string, _ any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
}

func avatarTestHandler(t *testing.T) (*Handler, *mongo.Database, primitive.ObjectID, string, *avatarFakePush) {
	t.Helper()
	db := filterDB(t)
	s, err := storage.NewLocal(t.TempDir(), "https://assets.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	uid := primitive.NewObjectID()
	url := avatarTestFile(t, s, uid)
	if _, err := db.Collection("users").InsertOne(context.Background(), bson.M{"_id": uid, "avatarUrl": url, "firstName": "Ali", "phone": "+998901234567"}); err != nil {
		t.Fatal(err)
	}
	p := &avatarFakePush{}
	n := notification.New(db)
	n.AttachPusher(p)
	h := &Handler{Users: db.Collection("users"), AvatarUploads: db.Collection("avatar_uploads"), AuditCol: db.Collection("admin_audit"), Storage: s, Notify: n}
	return h, db, uid, url, p
}

func avatarTestFile(t *testing.T, s *storage.Service, uid primitive.ObjectID) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 24, 12))); err != nil {
		t.Fatal(err)
	}
	f, err := s.Upload(context.Background(), "avatars/"+uid.Hex(), "avatar.png", "image/png", &b)
	if err != nil {
		t.Fatal(err)
	}
	return f.URL
}

func avatarRequest(t *testing.T, uid primitive.ObjectID, role, url, reason, comment string) *http.Request {
	t.Helper()
	b, err := json.Marshal(map[string]string{"expectedUrl": url, "reason": reason, "comment": comment})
	if err != nil {
		t.Fatal(err)
	}
	r := blockRequest(t, uid, role, string(b))
	r.Method = http.MethodDelete
	return r
}

func TestAvatarDeletionRemovesFileAuditsAndNotifies(t *testing.T) {
	for _, role := range []string{"superadmin", "moderator"} {
		t.Run(role, func(t *testing.T) {
			h, db, uid, url, p := avatarTestHandler(t)
			r := avatarRequest(t, uid, role, url, "spam", "")
			w := httptest.NewRecorder()
			h.DeleteUserAvatar(w, r)
			if w.Code != 200 {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(url), 1<<20); err == nil {
				t.Error("file still exists")
			}
			var doc bson.M
			if err := h.Users.FindOne(context.Background(), bson.M{"_id": uid}).Decode(&doc); err != nil {
				t.Fatal(err)
			}
			if doc["avatarUrl"] != nil {
				t.Fatalf("avatar not null: %v", doc["avatarUrl"])
			}
			if doc["avatarDeletedAt"] == nil || doc["avatarDeletedReason"] != "Reklama yoki spam" {
				t.Fatalf("deletion metadata missing: %v", doc)
			}
			var a models.AdminAudit
			if err := h.AuditCol.FindOne(context.Background(), bson.M{"action": "avatar.delete", "target": uid.Hex()}).Decode(&a); err != nil {
				t.Fatal(err)
			}
			if a.AdminID.Hex() != httpx.AdminID(r) || !strings.Contains(a.Detail, "spam") {
				t.Fatalf("audit missing actor/reason: %+v", a)
			}
			var n models.Notification
			if err := db.Collection("notifications").FindOne(context.Background(), bson.M{"userId": uid}).Decode(&n); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(n.Body, "Reklama yoki spam") || p.calls != 1 {
				t.Fatalf("notification %+v; pushes=%d", n, p.calls)
			}
			var record models.AvatarUpload
			if err := h.AvatarUploads.FindOne(context.Background(), bson.M{"_id": url}).Decode(&record); err != nil || record.DeletedAt == nil {
				t.Fatalf("no tombstone: %+v %v", record, err)
			}
		})
	}
}

func TestAvatarMissingFileStillClearsReference(t *testing.T) {
	h, _, uid, url, _ := avatarTestHandler(t)
	if err := h.Storage.DeleteByURL(context.Background(), url); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, uid, "moderator", url, "adult", ""))
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestAvatarDeleteSupportForbiddenBeforeAnyDatabaseAccess(t *testing.T) {
	h := &Handler{}
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, primitive.NewObjectID(), "support", "https://cdn/a.png", "adult", ""))
	if w.Code != 403 {
		t.Fatalf("got %d", w.Code)
	}
}

func TestAvatarDeletionValidation(t *testing.T) {
	for _, tc := range []struct {
		reason, comment string
		valid           bool
	}{
		{"", "", false}, {"unknown", "", false}, {"adult", "", true}, {"violence", "", true},
		{"impersonation", "", true}, {"spam", "", true}, {"other", "   ", false},
		{"other", strings.Repeat("Ў", 200), true}, {"other", strings.Repeat("Ў", 201), false},
	} {
		req := avatarDeleteRequest{ExpectedURL: "https://cdn/a.png", Reason: tc.reason, Comment: tc.comment}
		if (req.validate() == nil) != tc.valid {
			t.Errorf("reason=%q comment chars=%d valid=%v", tc.reason, len([]rune(tc.comment)), tc.valid)
		}
	}
}

func TestAvatarStaleConfirmationCannotDeleteReplacement(t *testing.T) {
	h, _, uid, old, _ := avatarTestHandler(t)
	replacement := avatarTestFile(t, h.Storage, uid)
	if _, err := h.Users.UpdateOne(context.Background(), bson.M{"_id": uid}, bson.M{"$set": bson.M{"avatarUrl": replacement}}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, uid, "superadmin", old, "adult", ""))
	if w.Code != 409 {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	for _, url := range []string{old, replacement} {
		if _, err := h.Storage.Download(context.Background(), h.Storage.KeyFromURL(url), 1<<20); err != nil {
			t.Errorf("file removed: %v", err)
		}
	}
	n, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{})
	if n != 0 {
		t.Errorf("stale confirmation was audited as a delete")
	}
}

func TestConcurrentAvatarDeleteRunsOnce(t *testing.T) {
	h, _, uid, url, p := avatarTestHandler(t)
	results := make(chan int, 2)
	requests := []*http.Request{avatarRequest(t, uid, "moderator", url, "adult", ""), avatarRequest(t, uid, "moderator", url, "adult", "")}
	var wg sync.WaitGroup
	for _, req := range requests {
		wg.Add(1)
		go func(r *http.Request) {
			defer wg.Done()
			w := httptest.NewRecorder()
			h.DeleteUserAvatar(w, r)
			results <- w.Code
		}(req)
	}
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("statuses %v", counts)
	}
	if p.calls != 1 {
		t.Errorf("%d pushes, want 1", p.calls)
	}
}

func TestAvatarDeletionRecoversAfterStorageFailureWithoutDuplicateNotifications(t *testing.T) {
	h, _, uid, url, p := avatarTestHandler(t)
	s := h.Storage
	h.Storage = nil
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, uid, "moderator", url, "other", "Tasvirda shaxsiy ma'lumot bor"))
	if w.Code != 202 || !strings.Contains(w.Body.String(), `"cleanupPending":true`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var u models.User
	if err := h.Users.FindOne(context.Background(), bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if len(u.AvatarDeletionJobs) != 1 || u.AvatarURL != "" {
		t.Fatalf("outbox missing: %+v", u)
	}
	h.Storage = s
	job := h.processAvatarDeletion(context.Background(), uid, u.AvatarDeletionJobs[0])
	if !job.StorageDone || !job.AuditDone || !job.PushDone {
		t.Fatalf("retry incomplete: %+v", job)
	}
	if p.calls != 1 {
		t.Errorf("push repeated %d", p.calls)
	}
	n, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{"action": "avatar.delete"})
	if n != 1 {
		t.Errorf("%d audit records", n)
	}
	if err := h.Users.FindOne(context.Background(), bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if len(u.AvatarDeletionJobs) != 0 {
		t.Error("completed job not removed")
	}
	if u.AvatarRevision < 2 {
		t.Error("completed cleanup did not invalidate earlier metadata validation snapshots")
	}
}

func TestNewAvatarClearsDeletionNoteAndPendingOldCleanupCannotRemoveIt(t *testing.T) {
	h, db, uid, old, _ := avatarTestHandler(t)
	s := h.Storage
	h.Storage = nil
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, uid, "moderator", old, "spam", ""))
	if w.Code != 202 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	newURL := avatarTestFile(t, s, uid)
	now := time.Now()
	meta := models.AvatarMetadata{URL: newURL, Width: 24, Height: 12, ModerationStatus: "clean", UploadedAt: &now}
	if _, err := h.AvatarUploads.InsertOne(context.Background(), models.AvatarUpload{ID: newURL, UserID: uid, Metadata: meta}); err != nil {
		t.Fatal(err)
	}
	uH := user.NewHandler(db, s)
	body, _ := json.Marshal(map[string]string{"avatarUrl": newURL})
	r := httptest.NewRequest(http.MethodPatch, "/api/me", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), httpx.CtxUserID, uid.Hex()))
	w = httptest.NewRecorder()
	uH.UpdateMe(w, r)
	if w.Code != 200 {
		t.Fatalf("new upload status %d: %s", w.Code, w.Body.String())
	}
	var u models.User
	if err := h.Users.FindOne(context.Background(), bson.M{"_id": uid}).Decode(&u); err != nil {
		t.Fatal(err)
	}
	if u.AvatarURL != newURL || u.AvatarDeletedAt != nil || u.AvatarMetadata == nil || u.AvatarMetadata.Width != 24 {
		t.Fatalf("new avatar not attached correctly: %+v", u)
	}
	h.Storage = s
	h.processAvatarDeletion(context.Background(), uid, u.AvatarDeletionJobs[0])
	if _, err := s.Download(context.Background(), s.KeyFromURL(newURL), 1<<20); err != nil {
		t.Errorf("replacement removed: %v", err)
	}
	// A client cannot reattach the URL that the administrator removed.
	body, _ = json.Marshal(map[string]string{"avatarUrl": old})
	r = httptest.NewRequest(http.MethodPatch, "/api/me", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), httpx.CtxUserID, uid.Hex()))
	w = httptest.NewRecorder()
	uH.UpdateMe(w, r)
	if w.Code != 400 {
		t.Fatalf("removed URL reattached: %d %s", w.Code, w.Body.String())
	}
}

func TestAvatarMetadataAndDownloadAudit(t *testing.T) {
	h, _, uid, url, _ := avatarTestHandler(t)
	for _, role := range []string{"support", "moderator", "superadmin"} {
		w := httptest.NewRecorder()
		h.GetUserAvatar(w, blockRequest(t, uid, role, ""))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"moderationStatus":"unknown"`) {
			t.Fatalf("legacy metadata %d %s", w.Code, w.Body.String())
		}
		body, _ := json.Marshal(map[string]string{"expectedUrl": url})
		w = httptest.NewRecorder()
		h.RecordAvatarDownload(w, blockRequest(t, uid, role, string(body)))
		if w.Code != 200 {
			t.Fatalf("download audit %d %s", w.Code, w.Body.String())
		}
	}
	n, _ := h.AuditCol.CountDocuments(context.Background(), bson.M{"action": "avatar.download"})
	if n != 3 {
		t.Errorf("%d download records", n)
	}
	meta := models.AvatarMetadata{URL: url, ModerationStatus: "flagged", ModerationReason: "Reklama bor", ModerationReasonCode: "spam", Width: 1024, Height: 600}
	if _, err := h.Users.UpdateOne(context.Background(), bson.M{"_id": uid}, bson.M{"$set": bson.M{"avatarMetadata": meta}}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.GetUserAvatar(w, blockRequest(t, uid, "support", ""))
	if !strings.Contains(w.Body.String(), `"moderationReasonCode":"spam"`) || !strings.Contains(w.Body.String(), `"width":1024`) {
		t.Errorf("metadata lost: %s", w.Body.String())
	}
	bad, _ := json.Marshal(map[string]string{"expectedUrl": url + "-stale"})
	w = httptest.NewRecorder()
	h.RecordAvatarDownload(w, blockRequest(t, uid, "support", string(bad)))
	if w.Code != 409 {
		t.Fatalf("stale download accepted: %d", w.Code)
	}
}

func TestAvatarNotificationRetriesAfterInboxPersistedBeforePush(t *testing.T) {
	h, db, uid, _, p := avatarTestHandler(t)
	n := models.Notification{ID: primitive.NewObjectID(), UserID: uid, Type: "system", Title: "Profil rasmi olib tashlandi", Body: "Sabab: spam", CreatedAt: time.Now()}
	// Simulate a crash after the durable inbox insert but before FCM dispatch.
	if _, err := db.Collection("notifications").InsertOne(context.Background(), n); err != nil {
		t.Fatal(err)
	}
	if err := h.Notify.PushOnce(context.Background(), n); err != nil {
		t.Fatal(err)
	}
	if err := h.Notify.PushOnce(context.Background(), n); err != nil {
		t.Fatal(err)
	}
	if p.calls != 1 {
		t.Errorf("push count %d, want 1", p.calls)
	}
	count, _ := db.Collection("notifications").CountDocuments(context.Background(), bson.M{"_id": n.ID})
	if count != 1 {
		t.Errorf("inbox count %d", count)
	}
}

func TestLegacySharedAvatarOnlyUnlinksAndNewSharedAttachmentIsRejected(t *testing.T) {
	h, db, uid, _, _ := avatarTestHandler(t)
	file, err := h.Storage.Upload(context.Background(), "elons/"+uid.Hex(), "listing.png", "image/png", bytes.NewBufferString("listing bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Users.UpdateOne(context.Background(), bson.M{"_id": uid}, bson.M{"$set": bson.M{"avatarUrl": file.URL}}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.DeleteUserAvatar(w, avatarRequest(t, uid, "moderator", file.URL, "spam", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"storageStatus":"reference_only"`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if _, err := h.Storage.Download(context.Background(), file.Key, 1<<20); err != nil {
		t.Error("shared listing image deleted")
	}
	if n, _ := h.AvatarUploads.CountDocuments(context.Background(), bson.M{"_id": file.URL}); n != 0 {
		t.Error("shared upload tombstoned")
	}
	body, _ := json.Marshal(map[string]string{"avatarUrl": file.URL})
	r := httptest.NewRequest(http.MethodPatch, "/api/me", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), httpx.CtxUserID, uid.Hex()))
	w = httptest.NewRecorder()
	user.NewHandler(db, h.Storage).UpdateMe(w, r)
	if w.Code != 400 {
		t.Fatalf("listing asset accepted as new avatar: %d %s", w.Code, w.Body.String())
	}
}
