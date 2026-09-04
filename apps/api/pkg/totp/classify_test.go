package totp

import (
	"testing"
	"time"
)

func mustSecret(t *testing.T) string {
	t.Helper()
	s, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustCode(t *testing.T, secret string, counter uint64) string {
	t.Helper()
	c, err := codeAt(secret, counter)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCheckAcceptsLiveCode(t *testing.T) {
	secret := mustSecret(t)
	now := uint64(time.Now().Unix() / period)
	got, res := Check(secret, mustCode(t, secret, now), 0)
	if res != Valid {
		t.Fatalf("res = %v, want Valid", res)
	}
	if got != now {
		t.Fatalf("counter = %d, want %d", got, now)
	}
}

// A code from a few minutes ago is this secret's code — the admin simply took
// too long. The screen needs that distinction to say "wait for the next one"
// instead of sending them looking for a typo.
func TestCheckLabelsAgedCodeExpired(t *testing.T) {
	secret := mustSecret(t)
	now := uint64(time.Now().Unix() / period)
	for _, back := range []uint64{2, 5, staleWindows} {
		code := mustCode(t, secret, now-back)
		if _, res := Check(secret, code, 0); res != Expired {
			t.Errorf("%d windows back: res = %v, want Expired", back, res)
		}
	}
}

// Already spent counts as expired too: re-entering the code you just logged in
// with is the most common way to land here.
func TestCheckLabelsSpentCodeExpired(t *testing.T) {
	secret := mustSecret(t)
	now := uint64(time.Now().Unix() / period)
	code := mustCode(t, secret, now)
	if _, res := Check(secret, code, now); res != Expired {
		t.Fatalf("res = %v, want Expired", res)
	}
}

func TestCheckLabelsUnrelatedCodeInvalid(t *testing.T) {
	secret := mustSecret(t)
	other := mustSecret(t)
	now := uint64(time.Now().Unix() / period)
	// Another secret's live code, and something far outside the sweep.
	for _, code := range []string{
		mustCode(t, other, now),
		mustCode(t, secret, now-staleWindows-5),
		"12345",  // too short
		"abcdef", // not digits, and not a code either
	} {
		if _, res := Check(secret, code, 0); res == Valid {
			t.Errorf("%q was accepted", code)
		}
	}
}

// The widened sweep must stay a LABEL. Anything Check calls Expired has to be
// refused by the accept path as firmly as before.
func TestCheckNeverWidensAcceptance(t *testing.T) {
	secret := mustSecret(t)
	now := uint64(time.Now().Unix() / period)
	for back := uint64(2); back <= staleWindows; back++ {
		code := mustCode(t, secret, now-back)
		if _, ok := ValidateCounter(secret, code, 0); ok {
			t.Fatalf("%d windows back was accepted by ValidateCounter", back)
		}
		if _, res := Check(secret, code, 0); res == Valid {
			t.Fatalf("%d windows back was accepted by Check", back)
		}
	}
}
