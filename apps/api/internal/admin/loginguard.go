package admin

import (
	"errors"
	"sync"
	"time"
)

// errTOTPRace means a second request consumed the same TOTP code first. It is
// reported to the caller as a plain invalid-code failure — the distinction
// matters to us, not to whoever is submitting codes.
var errTOTPRace = errors.New("totp code already consumed")

// Per-account brute-force budget for the admin panel.
//
// # WHY THIS EXISTS
//
// /admin/login already sits behind loginLimiter, which buckets by client IP.
// That is the wrong axis on its own for two reasons:
//
//   - It only holds while the IP is honest. Anything that lets a caller change
//     the perceived IP — a spoofed X-Forwarded-For, a botnet, a residential
//     proxy pool — converts "8 attempts then 1 per 5s" into "unlimited".
//   - It is per source, not per target. A thousand hosts each making eight
//     guesses never trips it, yet that is eight thousand guesses against one
//     password.
//
// A budget keyed on the username closes both: the total number of wrong
// passwords a single account will accept in a window is fixed no matter how
// the attempts are distributed.
//
// # TRADE-OFF, ACCEPTED DELIBERATELY
//
// Anyone who knows an admin username can burn its budget on purpose and lock
// that admin out. This is why the guard is a time-boxed throttle and never a
// sticky lockout: the window is short, it clears itself, and no operator action
// is needed to recover. A short self-healing delay for a targeted admin is a
// far better outcome than an unbounded offline-speed grind against every admin
// password, so the trade is made knowingly.
const (
	// adminMaxLoginFailures is how many wrong password / wrong-2FA attempts a
	// single username absorbs inside adminLoginWindow before further attempts
	// are refused outright.
	adminMaxLoginFailures = 10
	adminLoginWindow      = 15 * time.Minute
)

type loginFailures struct {
	count      int
	windowEnds time.Time
}

// loginGuard tracks failed admin logins per username. The zero value is not
// usable — build it with newLoginGuard.
type loginGuard struct {
	mu       sync.Mutex
	failures map[string]*loginFailures
}

func newLoginGuard() *loginGuard {
	return &loginGuard{failures: map[string]*loginFailures{}}
}

// exhausted reports whether this username has burnt its budget for the current
// window. Callers must consult it BEFORE touching the database, so a throttled
// account costs an attacker a bcrypt comparison of nothing at all.
func (g *loginGuard) exhausted(username string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	f := g.failures[username]
	if f == nil || now.After(f.windowEnds) {
		return false
	}
	return f.count >= adminMaxLoginFailures
}

// recordFailure charges one wrong attempt against a username. It is called for
// unknown usernames too: skipping them would turn the guard itself into an
// account-existence oracle (throttled == real, never throttled == not real).
func (g *loginGuard) recordFailure(username string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Prune expired buckets so a stream of invented usernames cannot grow this
	// map without bound.
	for k, v := range g.failures {
		if now.After(v.windowEnds) {
			delete(g.failures, k)
		}
	}

	f := g.failures[username]
	if f == nil || now.After(f.windowEnds) {
		g.failures[username] = &loginFailures{count: 1, windowEnds: now.Add(adminLoginWindow)}
		return
	}
	f.count++
}

// clear drops the budget after a fully successful login (password AND, when
// enabled, second factor). A legitimate admin who mistyped a few times is not
// left carrying those failures into their next session.
func (g *loginGuard) clear(username string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.failures, username)
}
