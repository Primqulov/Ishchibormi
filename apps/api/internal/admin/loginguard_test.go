package admin

import (
	"testing"
	"time"
)

func TestLoginGuardBlocksAfterBudget(t *testing.T) {
	g := newLoginGuard()
	now := time.Now()

	for i := 0; i < adminMaxLoginFailures; i++ {
		if g.exhausted("admin", now) {
			t.Fatalf("budget reported exhausted after %d failures, expected %d", i, adminMaxLoginFailures)
		}
		g.recordFailure("admin", now)
	}
	if !g.exhausted("admin", now) {
		t.Error("budget must be exhausted once the failure ceiling is reached")
	}
}

// The budget is per target account: guessing one admin's password must not
// throttle a different admin, and — the point of the control — spreading the
// same attack over many source addresses must not widen it.
func TestLoginGuardIsPerUsername(t *testing.T) {
	g := newLoginGuard()
	now := time.Now()
	for i := 0; i < adminMaxLoginFailures; i++ {
		g.recordFailure("victim", now)
	}
	if !g.exhausted("victim", now) {
		t.Fatal("victim should be throttled")
	}
	if g.exhausted("someone-else", now) {
		t.Error("an unrelated username must keep its own budget")
	}
}

// The throttle must heal by itself — it is a delay, never an operator-cleared
// lockout, so a targeted admin is never permanently locked out by an attacker.
func TestLoginGuardWindowExpires(t *testing.T) {
	g := newLoginGuard()
	now := time.Now()
	for i := 0; i < adminMaxLoginFailures; i++ {
		g.recordFailure("admin", now)
	}
	if !g.exhausted("admin", now) {
		t.Fatal("should be throttled inside the window")
	}
	if g.exhausted("admin", now.Add(adminLoginWindow+time.Second)) {
		t.Error("budget must reset once the window has passed")
	}
}

func TestLoginGuardClearOnSuccess(t *testing.T) {
	g := newLoginGuard()
	now := time.Now()
	for i := 0; i < adminMaxLoginFailures-1; i++ {
		g.recordFailure("admin", now)
	}
	g.clear("admin")
	for i := 0; i < adminMaxLoginFailures-1; i++ {
		if g.exhausted("admin", now) {
			t.Fatal("a successful login must reset the accumulated failures")
		}
		g.recordFailure("admin", now)
	}
}

// The 2FA budget is its own pool. A stolen access token grinding /2fa/disable
// must not be able to spend the login budget (which would lock the real admin
// out of the panel), and a throttled login must not stop the same admin from
// turning 2FA back on.
func TestTOTPGuardIsSeparateAndTighter(t *testing.T) {
	login := newLoginGuard()
	twofa := newTOTPGuard()
	now := time.Now()

	if twofaMaxFailures >= adminMaxLoginFailures {
		t.Fatalf("2FA budget (%d) is meant to be tighter than login (%d)",
			twofaMaxFailures, adminMaxLoginFailures)
	}

	for i := 0; i < twofaMaxFailures; i++ {
		if twofa.exhausted("admin-id", now) {
			t.Fatalf("2FA budget reported exhausted after %d failures, expected %d",
				i, twofaMaxFailures)
		}
		twofa.recordFailure("admin-id", now)
	}
	if !twofa.exhausted("admin-id", now) {
		t.Error("2FA budget must be exhausted once its ceiling is reached")
	}
	if login.exhausted("admin-id", now) {
		t.Error("burning the 2FA budget must not touch the login budget")
	}
}

func TestTOTPGuardWindowExpires(t *testing.T) {
	g := newTOTPGuard()
	now := time.Now()
	for i := 0; i < twofaMaxFailures; i++ {
		g.recordFailure("admin-id", now)
	}
	if !g.exhausted("admin-id", now) {
		t.Fatal("should be throttled inside the window")
	}
	if g.exhausted("admin-id", now.Add(twofaWindow+time.Second)) {
		t.Error("budget must reset once the window has passed")
	}
}

// Expired buckets are pruned, so a stream of invented usernames cannot grow the
// map without bound.
func TestLoginGuardPrunesExpiredBuckets(t *testing.T) {
	g := newLoginGuard()
	start := time.Now()
	for i := 0; i < 50; i++ {
		g.recordFailure(string(rune('a'+i%26))+"-old", start)
	}
	g.recordFailure("fresh", start.Add(adminLoginWindow+time.Minute))
	if len(g.failures) != 1 {
		t.Errorf("expected stale buckets to be pruned, %d remain", len(g.failures))
	}
}
