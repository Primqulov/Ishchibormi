package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func loginTestConfig() config.Config {
	return config.Config{
		JWTAccessSecret:  "test-access-secret",
		JWTRefreshSecret: "test-refresh-secret",
		JWTAccessTTL:     time.Hour,
		JWTRefreshTTL:    24 * time.Hour,
		OTPLength:        6,
		OTPTTL:           3 * time.Minute,
	}
}

// login drives the real HTTP handler the clients call: POST /api/auth/otp/verify.
func login(t *testing.T, h *Handler, token, code string) (status int, accessToken string, errCode string) {
	t.Helper()
	body := `{"token":"` + token + `","code":"` + code + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/otp/verify", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.VerifyOTP(rec, req)

	var parsed struct {
		AccessToken string `json:"accessToken"`
		Error       struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return rec.Code, parsed.AccessToken, parsed.Error.Code
}

// callProtected replays what every client does immediately after login: hit an
// authenticated endpoint behind UserAuth + RequireActiveUser. This is the call
// that used to come back 403 and bounce the user back to the login screen.
func callProtected(t *testing.T, h *Handler, accessToken string) (int, string) {
	t.Helper()
	var chain http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
	})
	chain = RequireActiveUser(h.Users())(chain)
	chain = httpx.UserAuth(loginTestConfig().JWTAccessSecret)(chain)

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	var parsed struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return rec.Code, parsed.Error.Code
}

// issueCode does what the Telegram bot does: bind the phone to the deep-link
// token and hand back the code the user types into the app or the website.
func issueCode(t *testing.T, h *Handler, phone string, tgID int64) (token, code string) {
	t.Helper()
	ctx := context.Background()
	token, err := h.otp.RequestToken(ctx)
	if err != nil {
		t.Fatalf("request token: %v", err)
	}
	code, err = h.otp.BindPhoneAndIssueCode(ctx, token, phone, tgID)
	if err != nil {
		t.Fatalf("bind phone: %v", err)
	}
	return token, code
}

// The reported bug, end to end: enter the bot's code, get in, get thrown back
// out to the login screen. Reproduces on both the web app and the Flutter APK
// because the cause is server-side — login handed out a token for a
// soft-deleted account, and RequireActiveUser 403'd the very next request.
func TestLoginAfterAdminDeleteStaysLoggedIn(t *testing.T) {
	db := testDB(t)
	h := NewHandler(loginTestConfig(), db)
	ctx := context.Background()

	const phone = "+998900000081"
	const tgID = int64(777010)

	// An earlier account on this number, deleted from the admin panel — which
	// left phone/telegramId attached to the dead document.
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": primitive.NewObjectID(), "phone": phone, "telegramId": tgID,
		"firstName": "Eski", "isDeleted": true, "createdAt": time.Now(),
	}); err != nil {
		t.Fatalf("seed deleted user: %v", err)
	}

	token, code := issueCode(t, h, phone, tgID)
	status, access, errCode := login(t, h, token, code)
	if status != 200 {
		t.Fatalf("login failed: status=%d code=%s", status, errCode)
	}
	if access == "" {
		t.Fatal("login returned no access token")
	}

	// The moment of truth — this is where the user was being kicked out.
	protStatus, protErr := callProtected(t, h, access)
	if protStatus != 200 {
		t.Fatalf("logged in, then bounced back out: status=%d code=%s", protStatus, protErr)
	}
}

// The same flow on a clean number must keep working.
func TestLoginOnFreshNumberStaysLoggedIn(t *testing.T) {
	db := testDB(t)
	h := NewHandler(loginTestConfig(), db)

	token, code := issueCode(t, h, "+998900000082", 777011)
	status, access, errCode := login(t, h, token, code)
	if status != 200 {
		t.Fatalf("login failed: status=%d code=%s", status, errCode)
	}
	if protStatus, protErr := callProtected(t, h, access); protStatus != 200 {
		t.Fatalf("fresh login was rejected: status=%d code=%s", protStatus, protErr)
	}
}

// A blocked account must be refused at the login step with account_blocked,
// rather than being handed a token that dies on the next request.
func TestLoginIsRefusedForBlockedAccount(t *testing.T) {
	db := testDB(t)
	h := NewHandler(loginTestConfig(), db)
	ctx := context.Background()

	const phone = "+998900000083"
	const tgID = int64(777012)
	if _, err := db.Collection("users").InsertOne(ctx, bson.M{
		"_id": primitive.NewObjectID(), "phone": phone, "telegramId": tgID,
		"isBlocked": true, "isDeleted": false, "createdAt": time.Now(),
	}); err != nil {
		t.Fatalf("seed blocked user: %v", err)
	}

	token, code := issueCode(t, h, phone, tgID)
	status, access, errCode := login(t, h, token, code)
	if status != 403 || errCode != "account_blocked" {
		t.Fatalf("expected 403 account_blocked, got status=%d code=%s", status, errCode)
	}
	if access != "" {
		t.Fatal("a blocked account was handed an access token")
	}
}
