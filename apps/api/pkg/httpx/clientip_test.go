package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A spoofed X-Forwarded-For must not change the rate-limit identity. Reverse
// proxies APPEND, so anything to the left of the last `hops` elements is a
// string the caller typed. Reading it would give an attacker a fresh limiter
// bucket per request and remove every brute-force budget in this package.
func TestClientIPIgnoresSpoofedForwardedPrefix(t *testing.T) {
	restoreTrust, restoreHops := TrustProxyHeaders, TrustedProxyHops
	t.Cleanup(func() { TrustProxyHeaders, TrustedProxyHops = restoreTrust, restoreHops })
	TrustProxyHeaders, TrustedProxyHops = true, 1

	const real = "203.0.113.7"
	spoofs := []string{
		"9.9.9.9, " + real,
		"1.1.1.1, 2.2.2.2, " + real,
		"  attacker-supplied  ,   " + real + "  ",
	}
	for _, header := range spoofs {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("X-Forwarded-For", header)
		if got := clientIP(r); got != real {
			t.Errorf("X-Forwarded-For %q: got %q, want %q (proxy-written element)", header, got, real)
		}
	}
}

func TestClientIPHonoursSingleTrustedHop(t *testing.T) {
	restoreTrust, restoreHops := TrustProxyHeaders, TrustedProxyHops
	t.Cleanup(func() { TrustProxyHeaders, TrustedProxyHops = restoreTrust, restoreHops })
	TrustProxyHeaders, TrustedProxyHops = true, 1

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("X-Forwarded-For", "198.51.100.4")
	if got := clientIP(r); got != "198.51.100.4" {
		t.Errorf("got %q, want the sole forwarded element", got)
	}
}

// Two hops (a CDN in front of Caddy) means the client sits one further left.
func TestClientIPMultipleHops(t *testing.T) {
	restoreTrust, restoreHops := TrustProxyHeaders, TrustedProxyHops
	t.Cleanup(func() { TrustProxyHeaders, TrustedProxyHops = restoreTrust, restoreHops })
	TrustProxyHeaders, TrustedProxyHops = true, 2

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("X-Forwarded-For", "evil, 198.51.100.4, 10.0.0.9")
	if got := clientIP(r); got != "198.51.100.4" {
		t.Errorf("got %q, want the element before the two trusted hops", got)
	}
}

// A chain shorter than the configured topology is not what our proxy produces,
// so it must fall back to the socket address rather than trust an element of it.
func TestClientIPShortChainFallsBackToRemoteAddr(t *testing.T) {
	restoreTrust, restoreHops := TrustProxyHeaders, TrustedProxyHops
	t.Cleanup(func() { TrustProxyHeaders, TrustedProxyHops = restoreTrust, restoreHops })
	TrustProxyHeaders, TrustedProxyHops = true, 2

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.55:44321"
	r.Header.Set("X-Forwarded-For", "evil")
	if got := clientIP(r); got != "192.0.2.55" {
		t.Errorf("got %q, want the socket address", got)
	}
}

// With the proxy switch off the header must be ignored entirely.
func TestClientIPUntrustedIgnoresHeader(t *testing.T) {
	restoreTrust := TrustProxyHeaders
	t.Cleanup(func() { TrustProxyHeaders = restoreTrust })
	TrustProxyHeaders = false

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.55:44321"
	r.Header.Set("X-Forwarded-For", "9.9.9.9")
	if got := clientIP(r); got != "192.0.2.55" {
		t.Errorf("got %q, want the socket address", got)
	}
}
