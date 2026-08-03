package httpx

import (
	"testing"
	"time"
)

func TestLimiterBurstThenBlock(t *testing.T) {
	l := NewLimiter(3, 0) // capacity 3, no refill
	for i := 0; i < 3; i++ {
		if !l.allow("k") {
			t.Fatalf("request %d should be allowed within the burst", i+1)
		}
	}
	if l.allow("k") {
		t.Error("4th request should be blocked once the burst is exhausted")
	}
}

func TestLimiterSeparateKeys(t *testing.T) {
	l := NewLimiter(1, 0)
	if !l.allow("a") {
		t.Error("first request for key a should be allowed")
	}
	if !l.allow("b") {
		t.Error("first request for key b should be allowed (independent bucket)")
	}
	if l.allow("a") {
		t.Error("second request for key a should be blocked")
	}
}

func TestLimiterRefill(t *testing.T) {
	l := NewLimiter(1, 1000) // 1000 tokens/sec
	if !l.allow("k") {
		t.Fatal("first request should be allowed")
	}
	if l.allow("k") {
		t.Fatal("second immediate request should be blocked")
	}
	time.Sleep(15 * time.Millisecond) // plenty of time to refill >=1 token
	if !l.allow("k") {
		t.Error("request should be allowed again after refill")
	}
}

// TestEvictIdle covers the memory-leak fix: buckets untouched beyond the idle
// window are dropped, while recently-used ones survive.
func TestEvictIdle(t *testing.T) {
	l := NewLimiter(5, 0)
	l.allow("fresh")
	l.allow("stale")

	// Backdate the "stale" bucket far beyond the idle window.
	l.mu.Lock()
	l.buckets["stale"].last = time.Now().Add(-time.Hour)
	l.mu.Unlock()

	l.evictIdle(time.Now(), 10*time.Minute)

	l.mu.Lock()
	_, freshOK := l.buckets["fresh"]
	_, staleOK := l.buckets["stale"]
	n := len(l.buckets)
	l.mu.Unlock()

	if !freshOK {
		t.Error("fresh bucket should survive eviction")
	}
	if staleOK {
		t.Error("stale bucket should have been evicted")
	}
	if n != 1 {
		t.Errorf("bucket count=%d, want 1", n)
	}
}
