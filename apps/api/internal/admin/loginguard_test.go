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
