package auth

// Google Play review login.
//
// WHY THIS EXISTS
//
// Normal sign-in is a Telegram-bot OTP: the client asks for a tgToken, the user
// opens the bot, the bot binds their phone and issues a code. A Google Play
// reviewer cannot complete that — they have no Telegram account, no Uzbek phone
// number, and no access to our bot. Google's App Access policy nevertheless
// requires working credentials that reach every part of the app, so the review
// is blocked without something like this.
//
// SHAPE OF THE SOLUTION
//
// While the switch is on, ONE extra code is accepted at /auth/otp/verify and
// resolves to ONE pre-created, sandboxed account. Deliberately:
//
//   - No new endpoint. A /auth/review-login route would be a labelled target
//     for scanners; this rides the existing verify call instead.
//   - Nothing in the mobile app. The reviewer types the code into the ordinary
//     6-digit OTP box, so the APK contains no review code, no review flag and
//     no review UI. Reverse-engineering the build yields nothing.
//   - No account creation. The gate resolves a specific pre-existing _id and
//     fails closed if that document is missing, blocked, deleted or not
//     actually flagged as a review account.
//   - Ordinary user tokens. A review session carries no extra privilege, and
//     blocking the account revokes it instantly through RequireActiveUser.
//
// RESIDUAL RISK
//
// The code is only six digits, because it shares the app's OTP input. That is
// the weakest part of this design and it is contained rather than eliminated:
// a per-IP guess budget (below), a self-closing window, per-IP rate limiting
// already applied to the whole OTP route group, a zero-privilege sandboxed
// account, and mandatory blocking of that account once review finishes.

import (
	"crypto/subtle"
	"fmt"
	"sync"
	"time"

	"github.com/ishchibormi/backend/config"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

const (
	// reviewMaxFailuresPerIP is how many wrong review-code guesses a single IP
	// may make inside reviewFailureWindow before the review path stops
	// answering it entirely. Normal OTP login is unaffected for that IP — this
	// budget only ever gates the review branch.
	//
	// Per-IP rather than global on purpose. A global counter would let anyone
	// lock the reviewer out by burning the budget (a denial of service against
	// our own release), and it would also be consumed by ordinary users
	// mistyping their OTP.
	reviewMaxFailuresPerIP = 5
	reviewFailureWindow    = time.Hour
)

// reviewGate holds the review-login switch and its guess budget. The zero value
// is inert, and so is a gate built from a default configuration.
type reviewGate struct {
	enabled   bool
	code      string
	expiresAt time.Time
	userID    primitive.ObjectID

	mu       sync.Mutex
	failures map[string]*reviewFailures
}

type reviewFailures struct {
	count      int
	windowEnds time.Time
}

func newReviewGate(cfg config.Config) *reviewGate {
	g := &reviewGate{
		enabled:   cfg.ReviewLoginEnabled,
		code:      cfg.ReviewLoginCode,
		expiresAt: cfg.ReviewLoginExpiresAt,
		failures:  map[string]*reviewFailures{},
	}
	// An unparseable/absent id leaves userID zero, which active() treats as
	// "not configured" — the gate stays shut rather than guessing.
	if id, err := primitive.ObjectIDFromHex(cfg.ReviewLoginUserID); err == nil {
		g.userID = id
	}
	return g
}

// active reports whether the review branch should be consulted at all.
//
// The expiry check is what makes the window self-closing: once the deadline
// passes the gate goes inert on its own, with no deploy, no restart and nobody
// having to remember. Boot deliberately does NOT treat a lapsed deadline as a
// fatal misconfiguration — that would take production down the moment a review
// window ended.
func (g *reviewGate) active(now time.Time) bool {
	return g.enabled &&
		g.code != "" &&
		!g.userID.IsZero() &&
		!g.expiresAt.IsZero() &&
		now.Before(g.expiresAt)
}

// matches compares in constant time, so the response latency cannot be used to
// recover the code digit by digit.
func (g *reviewGate) matches(code string) bool {
	if g.code == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(code), []byte(g.code)) == 1
}

// budgetExhausted reports whether this IP has burnt its guesses for the current
// window.
func (g *reviewGate) budgetExhausted(ip string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	f := g.failures[ip]
	if f == nil || now.After(f.windowEnds) {
		return false
	}
	return f.count >= reviewMaxFailuresPerIP
}

// recordFailure charges one wrong guess against an IP. Callers must only invoke
// it for attempts that plausibly targeted the review code — see
// Handler.tryReviewLogin, which skips ordinary users mistyping their real OTP.
func (g *reviewGate) recordFailure(ip string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Prune expired buckets so an attacker rotating source addresses cannot
	// grow this map without bound.
	for k, v := range g.failures {
		if now.After(v.windowEnds) {
			delete(g.failures, k)
		}
	}

	f := g.failures[ip]
	if f == nil || now.After(f.windowEnds) {
		g.failures[ip] = &reviewFailures{count: 1, windowEnds: now.Add(reviewFailureWindow)}
		return
	}
	f.count++
}

// describe renders the gate's state for the startup banner. It never includes
// the code itself.
func (g *reviewGate) describe(now time.Time) string {
	switch {
	case !g.enabled:
		return "disabled"
	case g.code == "":
		return "inert (REVIEW_LOGIN_CODE unset)"
	case g.userID.IsZero():
		return "inert (REVIEW_LOGIN_USER_ID unset or malformed)"
	case g.expiresAt.IsZero():
		return "inert (REVIEW_LOGIN_EXPIRES_AT unset)"
	case !now.Before(g.expiresAt):
		return fmt.Sprintf("inert (window closed at %s)", g.expiresAt.Format(time.RFC3339))
	default:
		return fmt.Sprintf("ACTIVE until %s for account %s",
			g.expiresAt.Format(time.RFC3339), g.userID.Hex())
	}
}
