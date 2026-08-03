package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

const testReviewCode = "418306"

func reviewConfig(userID primitive.ObjectID, code string, expires time.Time) config.Config {
	c := loginTestConfig()
	c.ReviewLoginEnabled = true
	c.ReviewLoginCode = code
	c.ReviewLoginUserID = userID.Hex()
	c.ReviewLoginExpiresAt = expires
	return c
}

type reviewAccountOpts struct {
	flagged bool // isReviewAccount
	blocked bool
	deleted bool
}

func seedReviewAccount(t *testing.T, db *mongo.Database, o reviewAccountOpts) primitive.ObjectID {
	t.Helper()
	id := primitive.NewObjectID()
	_, err := db.Collection("users").InsertOne(context.Background(), bson.M{
		"_id":             id,
		"phone":           "+998000000000",
		"firstName":       "Play",
		"lastName":        "Reviewer",
		"isReviewAccount": o.flagged,
		"isBlocked":       o.blocked,
		"isDeleted":       o.deleted,
		"createdAt":       time.Now(),
	})
	if err != nil {
		t.Fatalf("seed review account: %v", err)
	}
	return id
}

// unboundToken is what a Play reviewer's client holds: a deep-link token from
// /auth/otp/request that the Telegram bot never bound a phone to, because the
// reviewer never opens the bot.
func unboundToken(t *testing.T, h *Handler) string {
	t.Helper()
	tok, err := h.otp.RequestToken(context.Background())
	if err != nil {
		t.Fatalf("request token: %v", err)
	}
	return tok
}

// ---------------------------------------------------------------------------
// The switch is off by default — this is the property that matters most.
// ---------------------------------------------------------------------------

func TestReviewLoginDisabledByDefault(t *testing.T) {
	db := testDB(t)
	// loginTestConfig sets none of the REVIEW_LOGIN_* fields, exactly like a
	// server booted without them in the environment.
	h := NewHandler(loginTestConfig(), db)
	seedReviewAccount(t, db, reviewAccountOpts{flagged: true})

	status, access, errCode := login(t, h, unboundToken(t, h), testReviewCode)
	if status != 401 || access != "" {
		t.Fatalf("review code worked with the switch off: status=%d token=%q", status, access)
	}
	if errCode != "invalid_code" {
		t.Fatalf("want the ordinary invalid_code rejection, got %q", errCode)
	}
}

func TestReviewLoginInertAfterWindowCloses(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	// Window closed an hour ago. The switch is still on — this is precisely the
	// "somebody forgot to turn it off" case, and it must fail closed.
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(-time.Hour)), db)

	status, _, errCode := login(t, h, unboundToken(t, h), testReviewCode)
	if status != 401 {
		t.Fatalf("expired review window still let the code through: status=%d", status)
	}
	if errCode != "invalid_code" {
		t.Fatalf("want invalid_code, got %q", errCode)
	}
}

func TestReviewLoginRequiresExpiryToBeSet(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	// Enabled, correct code, valid account — but no deadline. The gate treats a
	// missing expiry as "not configured" rather than "no deadline".
	h := NewHandler(reviewConfig(id, testReviewCode, time.Time{}), db)

	if status, _, _ := login(t, h, unboundToken(t, h), testReviewCode); status != 401 {
		t.Fatalf("review login worked with no expiry configured: status=%d", status)
	}
}

// ---------------------------------------------------------------------------
// The happy path.
// ---------------------------------------------------------------------------

func TestReviewLoginSucceedsAndSessionWorks(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	status, access, errCode := login(t, h, unboundToken(t, h), testReviewCode)
	if status != 200 {
		t.Fatalf("review login failed: status=%d code=%s", status, errCode)
	}
	if access == "" {
		t.Fatal("review login returned no access token")
	}
	// The session must survive UserAuth + RequireActiveUser like any other.
	if s, e := callProtected(t, h, access); s != 200 {
		t.Fatalf("review session rejected on first protected call: status=%d code=%s", s, e)
	}
}

// Blocking the account is the post-approval kill switch, and it has to revoke
// both new logins and any session already handed out.
func TestBlockingReviewAccountRevokesEverything(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	_, access, _ := login(t, h, unboundToken(t, h), testReviewCode)
	if access == "" {
		t.Fatal("setup: expected a working review session")
	}

	if _, err := db.Collection("users").UpdateOne(context.Background(),
		bson.M{"_id": id}, bson.M{"$set": bson.M{"isBlocked": true}}); err != nil {
		t.Fatalf("block account: %v", err)
	}

	// Existing token: dead on the very next request.
	if s, _ := callProtected(t, h, access); s != 403 {
		t.Fatalf("blocked review account kept its session alive: status=%d", s)
	}
	// New logins: refused even though the code is still correct.
	if s, _, _ := login(t, h, unboundToken(t, h), testReviewCode); s != 401 {
		t.Fatalf("blocked review account could log in again: status=%d", s)
	}
}

// The gate resolves one specific document. Anything else about that document
// being wrong must fail closed rather than improvise.
func TestReviewLoginFailsClosedOnBadAccount(t *testing.T) {
	cases := []struct {
		name string
		opts *reviewAccountOpts // nil = do not create the account at all
	}{
		{"account missing", nil},
		{"not flagged as review account", &reviewAccountOpts{flagged: false}},
		{"blocked", &reviewAccountOpts{flagged: true, blocked: true}},
		{"soft-deleted", &reviewAccountOpts{flagged: true, deleted: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := testDB(t)
			id := primitive.NewObjectID()
			if tc.opts != nil {
				id = seedReviewAccount(t, db, *tc.opts)
			}
			h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

			status, access, _ := login(t, h, unboundToken(t, h), testReviewCode)
			if status != 401 || access != "" {
				t.Fatalf("correct code let a bad account in: status=%d token=%q", status, access)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Brute-force budget.
// ---------------------------------------------------------------------------

func TestReviewLoginBudgetLocksOutGuessing(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	for i := 0; i < reviewMaxFailuresPerIP; i++ {
		if s, _, _ := login(t, h, unboundToken(t, h), "000001"); s != 401 {
			t.Fatalf("guess %d: want 401, got %d", i, s)
		}
	}
	// Budget spent. Even the RIGHT code is now refused from this address.
	if s, access, _ := login(t, h, unboundToken(t, h), testReviewCode); s != 401 || access != "" {
		t.Fatalf("correct code accepted after the budget was exhausted: status=%d token=%q", s, access)
	}
}

// Ordinary users mistyping their real OTP must not spend the reviewer's budget
// — otherwise normal traffic would lock the reviewer out within minutes.
func TestOrdinaryTyposDoNotConsumeReviewBudget(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	// Well past the budget: real users who opened the bot and fat-fingered the
	// code. Each has a phone-bound token, so the review path skips them.
	for i := 0; i < reviewMaxFailuresPerIP*3; i++ {
		token, realCode := issueCode(t, h, "+99890000010"+string(rune('0'+i%10)), int64(880000+i))
		wrong := "000000"
		if realCode == wrong {
			wrong = "111111"
		}
		if s, _, _ := login(t, h, token, wrong); s != 401 {
			t.Fatalf("typo %d: want 401, got %d", i, s)
		}
	}

	// The reviewer is unaffected.
	if s, access, e := login(t, h, unboundToken(t, h), testReviewCode); s != 200 || access == "" {
		t.Fatalf("real users' typos locked the reviewer out: status=%d code=%s", s, e)
	}
}

// ---------------------------------------------------------------------------
// Regression: the normal Telegram login must be untouched, switch on or off.
// ---------------------------------------------------------------------------

func TestNormalLoginUnaffectedByReviewSwitch(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "review disabled"
		if enabled {
			name = "review enabled"
		}
		t.Run(name, func(t *testing.T) {
			db := testDB(t)
			cfg := loginTestConfig()
			var h *Handler
			if enabled {
				id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
				cfg = reviewConfig(id, testReviewCode, time.Now().Add(time.Hour))
			}
			h = NewHandler(cfg, db)

			// A real user signs in through the bot exactly as before.
			token, code := issueCode(t, h, "+998900000091", 779001)
			status, access, errCode := login(t, h, token, code)
			if status != 200 || access == "" {
				t.Fatalf("normal login broke: status=%d code=%s", status, errCode)
			}
			if s, e := callProtected(t, h, access); s != 200 {
				t.Fatalf("normal session broke: status=%d code=%s", s, e)
			}

			// And a wrong code is still a plain invalid_code, not something new.
			token2, _ := issueCode(t, h, "+998900000092", 779002)
			if s, _, e := login(t, h, token2, "999999"); s != 401 || e != "invalid_code" {
				t.Fatalf("wrong-code rejection changed: status=%d code=%s", s, e)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Write restrictions on the sandboxed account.
// ---------------------------------------------------------------------------

// callRestricted drives a route mounted behind the same chain main.go uses for
// the restricted endpoints (uploads, account deletion, reports, feedback,
// blocking): UserAuth -> RequireActiveUser -> DenyReviewAccount.
func callRestricted(t *testing.T, h *Handler, accessToken string) (int, string) {
	t.Helper()
	var chain http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
	})
	chain = DenyReviewAccount(chain)
	chain = RequireActiveUser(h.Users())(chain)
	chain = httpx.UserAuth(loginTestConfig().JWTAccessSecret)(chain)

	req := httptest.NewRequest(http.MethodPost, "/api/uploads", nil)
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

func TestReviewAccountIsBlockedFromRestrictedRoutes(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	_, access, _ := login(t, h, unboundToken(t, h), testReviewCode)
	if access == "" {
		t.Fatal("setup: expected a working review session")
	}

	// Open routes stay open — the reviewer must be able to assess the app.
	if s, e := callProtected(t, h, access); s != 200 {
		t.Fatalf("review account locked out of an ordinary route: status=%d code=%s", s, e)
	}
	// Restricted ones are refused.
	s, errCode := callRestricted(t, h, access)
	if s != 403 || errCode != "not_available" {
		t.Fatalf("review account reached a restricted route: status=%d code=%s", s, errCode)
	}
}

// The restriction must key off the review flag alone — a normal user is never
// affected by any of this.
func TestNormalUserUnaffectedByRestrictions(t *testing.T) {
	db := testDB(t)
	id := seedReviewAccount(t, db, reviewAccountOpts{flagged: true})
	h := NewHandler(reviewConfig(id, testReviewCode, time.Now().Add(time.Hour)), db)

	token, code := issueCode(t, h, "+998900000093", 779003)
	_, access, _ := login(t, h, token, code)
	if access == "" {
		t.Fatal("setup: expected a working normal session")
	}
	if s, e := callRestricted(t, h, access); s != 200 {
		t.Fatalf("a real user was caught by the review restriction: status=%d code=%s", s, e)
	}
}

// ---------------------------------------------------------------------------
// Gate unit tests — no database needed.
// ---------------------------------------------------------------------------

func TestReviewGateActive(t *testing.T) {
	now := time.Now()
	id := primitive.NewObjectID()
	full := func() config.Config {
		return config.Config{
			ReviewLoginEnabled:   true,
			ReviewLoginCode:      testReviewCode,
			ReviewLoginUserID:    id.Hex(),
			ReviewLoginExpiresAt: now.Add(time.Hour),
		}
	}
	cases := []struct {
		name string
		mut  func(*config.Config)
		want bool
	}{
		{"fully configured", func(*config.Config) {}, true},
		{"switch off", func(c *config.Config) { c.ReviewLoginEnabled = false }, false},
		{"no code", func(c *config.Config) { c.ReviewLoginCode = "" }, false},
		{"no user id", func(c *config.Config) { c.ReviewLoginUserID = "" }, false},
		{"malformed user id", func(c *config.Config) { c.ReviewLoginUserID = "not-an-objectid" }, false},
		{"no expiry", func(c *config.Config) { c.ReviewLoginExpiresAt = time.Time{} }, false},
		{"expired", func(c *config.Config) { c.ReviewLoginExpiresAt = now.Add(-time.Second) }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := full()
			tc.mut(&c)
			if got := newReviewGate(c).active(now); got != tc.want {
				t.Fatalf("active() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestReviewGateMatches(t *testing.T) {
	g := newReviewGate(config.Config{ReviewLoginCode: testReviewCode})
	if !g.matches(testReviewCode) {
		t.Fatal("correct code did not match")
	}
	for _, bad := range []string{"", "418305", "41830", "4183067", "abcdef"} {
		if g.matches(bad) {
			t.Fatalf("wrong code %q matched", bad)
		}
	}
	// An unconfigured gate must never match, least of all the empty string.
	if newReviewGate(config.Config{}).matches("") {
		t.Fatal("empty code matched an unconfigured gate")
	}
}

func TestReviewGateBudgetIsPerIPAndResets(t *testing.T) {
	g := newReviewGate(config.Config{ReviewLoginCode: testReviewCode})
	now := time.Now()

	for i := 0; i < reviewMaxFailuresPerIP; i++ {
		g.recordFailure("10.0.0.1", now)
	}
	if !g.budgetExhausted("10.0.0.1", now) {
		t.Fatal("budget should be exhausted for this ip")
	}
	// A different address is unaffected — one attacker cannot lock out the
	// reviewer by burning a shared counter.
	if g.budgetExhausted("10.0.0.2", now) {
		t.Fatal("budget leaked across ips")
	}
	// And the window rolls over.
	if g.budgetExhausted("10.0.0.1", now.Add(reviewFailureWindow+time.Second)) {
		t.Fatal("budget did not reset after the window")
	}
}
