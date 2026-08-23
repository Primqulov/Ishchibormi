package totp

import (
	"testing"
	"time"
)

// RFC 6238 §5.2: a code that has been accepted once must never be accepted
// again. Without this, a code read over a shoulder or captured by a phishing
// page stays usable for the rest of its ~90s skew window.
func TestValidateCounterRejectsReplay(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	counter := uint64(time.Now().Unix() / period)
	code, err := codeAt(secret, counter)
	if err != nil {
		t.Fatal(err)
	}

	got, ok := ValidateCounter(secret, code, 0)
	if !ok {
		t.Fatal("first submission of a live code must be accepted")
	}
	if got != counter {
		t.Fatalf("returned counter %d, want %d", got, counter)
	}
	if _, ok := ValidateCounter(secret, code, got); ok {
		t.Error("replaying the same code must be refused once its counter is recorded")
	}
}

// The skew window must not become a replay loophole: a code from the previous
// 30s step is still refused when the high-water mark has moved past it.
func TestValidateCounterRejectsStaleSkewWindow(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := uint64(time.Now().Unix() / period)
	previous, err := codeAt(secret, now-1)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ValidateCounter(secret, previous, now); ok {
		t.Error("a code older than the last accepted counter must be refused")
	}
}

func TestValidateCounterAcceptsNextWindow(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := uint64(time.Now().Unix() / period)
	code, err := codeAt(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	// Having spent the previous window, the current one is still available.
	if _, ok := ValidateCounter(secret, code, now-1); !ok {
		t.Error("a fresh code after an older one was spent must be accepted")
	}
}
