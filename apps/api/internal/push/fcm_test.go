package push

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// testServiceAccountJSON test uchun haqiqiy (lekin tasodifiy) RSA kalitli
// service-account JSON tanasini yasaydi.
func testServiceAccountJSON(t *testing.T, tokenURI string) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	raw, _ := json.Marshal(map[string]string{
		"project_id":   "test-project",
		"private_key":  string(pemKey),
		"client_email": "svc@test-project.iam.gserviceaccount.com",
		"token_uri":    tokenURI,
	})
	return raw
}

func TestParseServiceAccount(t *testing.T) {
	sa, key, err := parseServiceAccount(testServiceAccountJSON(t, "https://example.com/token"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if key == nil || sa.ProjectID != "test-project" || sa.TokenURI != "https://example.com/token" {
		t.Fatalf("unexpected parse result: %+v", sa)
	}

	if _, _, err := parseServiceAccount([]byte(`{"project_id":"x"}`)); err == nil {
		t.Fatal("kalitsiz JSON xato bermadi")
	}
	if _, _, err := parseServiceAccount([]byte(`not-json`)); err == nil {
		t.Fatal("buzuq JSON xato bermadi")
	}
}

func TestBuildMessage(t *testing.T) {
	nid := primitive.NewObjectID()
	rid := primitive.NewObjectID()
	n := models.Notification{
		ID: nid, Type: "new_application", Title: "Yangi ariza", Body: "Elon: X",
		RelatedEntity: &models.RelatedEntity{Type: "application", ID: rid},
	}
	msg := buildMessage("tok-1", n)

	m, ok := msg["message"].(map[string]any)
	if !ok {
		t.Fatal("message maydoni yo'q")
	}
	if m["token"] != "tok-1" {
		t.Fatalf("token: %v", m["token"])
	}
	data, ok := m["data"].(map[string]string)
	if !ok {
		t.Fatal("data string-map emas — FCM v1 buni rad etadi")
	}
	if data["type"] != "new_application" || data["notificationId"] != nid.Hex() ||
		data["relatedType"] != "application" || data["relatedId"] != rid.Hex() {
		t.Fatalf("data: %+v", data)
	}

	// RelatedEntity'siz notification ham buzilmasin.
	data2 := buildMessage("t", models.Notification{ID: nid, Type: "system"})["message"].(map[string]any)["data"].(map[string]string)
	if _, has := data2["relatedId"]; has {
		t.Fatal("relatedId bo'sh bo'lishi kerak edi")
	}
}

func TestShouldDropToken(t *testing.T) {
	cases := []struct {
		status int
		body   string
		want   bool
	}{
		{404, `{"error":{"status":"NOT_FOUND"}}`, true},
		{400, `{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}`, true},
		{400, `{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}`, true},
		{400, `{"error":{"status":"INVALID_ARGUMENT","message":"Invalid JSON payload"}}`, false},
		{500, `{"error":{"status":"INTERNAL"}}`, false},
		{503, ``, false},
	}
	for _, c := range cases {
		if got := shouldDropToken(c.status, []byte(c.body)); got != c.want {
			t.Errorf("status=%d body=%q: got %v, want %v", c.status, c.body, got, c.want)
		}
	}
}

// TestSendFlow OAuth token olish + FCM send yo'lini soxta serverlar bilan
// to'liq bosib o'tadi (mongo kerak emas).
func TestSendFlow(t *testing.T) {
	// Soxta OAuth endpoint: assertion grant'ni tekshirib access token beradi.
	oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" || r.Form.Get("assertion") == "" {
			w.WriteHeader(400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at-123", "expires_in": 3600})
	}))
	defer oauth.Close()

	var gotAuth string
	var gotBody []byte
	fcmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotBody, _ = io.ReadAll(r.Body)
		_ = json.NewEncoder(w).Encode(map[string]string{"name": "projects/test/messages/1"})
	}))
	defer fcmSrv.Close()

	sa, key, err := parseServiceAccount(testServiceAccountJSON(t, oauth.URL))
	if err != nil {
		t.Fatal(err)
	}
	f := &FCM{
		projectID: sa.ProjectID, clientEmail: sa.ClientEmail, tokenURI: sa.TokenURI, key: key,
		httpc:   &http.Client{Timeout: 5 * time.Second},
		log:     slog.Default(),
		sendURL: fcmSrv.URL,
	}

	status, _, err := f.send(context.Background(), "device-token-1", models.Notification{
		ID: primitive.NewObjectID(), Type: "system", Title: "T", Body: "B",
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if status != 200 {
		t.Fatalf("status: %d", status)
	}
	if gotAuth != "Bearer at-123" {
		t.Fatalf("auth header: %q", gotAuth)
	}
	if !strings.Contains(string(gotBody), `"device-token-1"`) {
		t.Fatalf("body: %s", gotBody)
	}

	// Ikkinchi chaqiruv keshdagi access-token'ni ishlatishi kerak (OAuth
	// serveri yopilsa ham ishlaydi).
	oauth.Close()
	if _, _, err := f.send(context.Background(), "device-token-2", models.Notification{ID: primitive.NewObjectID()}); err != nil {
		t.Fatalf("cached token send: %v", err)
	}
}
