// Package totp implements RFC 6238 time-based one-time passwords (the scheme
// used by Google Authenticator / Authy). Pure stdlib — no external dependency.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	period = 30 // seconds per code
	digits = 6
)

var enc = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateSecret returns a new random base32 secret (160 bits) to store per admin.
func GenerateSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return enc.EncodeToString(b), nil
}

// codeAt computes the TOTP for a given 30s counter.
func codeAt(secret string, counter uint64) (string, error) {
	key, err := enc.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	val := (int(sum[offset]&0x7f) << 24) |
		(int(sum[offset+1]) << 16) |
		(int(sum[offset+2]) << 8) |
		int(sum[offset+3])
	return fmt.Sprintf("%0*d", digits, val%1_000_000), nil
}

// Validate reports whether input matches the secret's code in the current 30s
// window (±1 window tolerance for clock skew). Constant-time comparison.
//
// Prefer [ValidateCounter] anywhere the caller can persist state: this form
// cannot tell that a code has already been spent, so a code observed over a
// shoulder, read off a screen share, or captured by a phishing page stays
// usable for the rest of its ~90-second validity.
func Validate(secret, input string) bool {
	_, ok := ValidateCounter(secret, input, 0)
	return ok
}

// ValidateCounter is [Validate] plus replay protection, as RFC 6238 §5.2
// requires: "the verifier MUST NOT accept the second attempt of the OTP after
// the successful validation has been issued for the first OTP".
//
// lastUsed is the counter returned by the previous successful validation for
// this secret (0 when there has never been one). Any code whose counter is not
// strictly greater is rejected, which makes each generated code single-use —
// re-entering it, or an attacker replaying one they watched being typed, fails
// even inside the skew window.
//
// On success it returns the counter the caller must persist alongside the
// secret. On failure the returned counter is meaningless and must be ignored.
//
// The skew windows are walked oldest-first so a code that is valid in more than
// one position (possible only with a repeating code) burns the earliest one,
// never sliding the high-water mark further than necessary.
func ValidateCounter(secret, input string, lastUsed uint64) (uint64, bool) {
	c, res := check(secret, input, lastUsed, false)
	return c, res == Valid
}

// Result says WHY a submission was refused. Only [Valid] grants anything; the
// other two exist so a screen can tell "you mistyped" from "that code has
// aged out", which are different problems with different fixes.
type Result int

const (
	// Invalid — the code does not belong to this secret at any nearby time.
	Invalid Result = iota
	// Expired — genuinely this secret's code, but its 30-second window has
	// passed, or it was already spent and cannot be reused.
	Expired
	// Valid — accepted. The returned counter must be persisted.
	Valid
)

// staleWindows is how far either side of now [Check] looks when it is only
// LABELLING an already-refused code.
//
// It does NOT widen acceptance: the accept loop is still ±1 window and runs
// first, so nothing found out here is ever let through. The only thing the
// wider sweep can reveal is "that string was one of this secret's codes a few
// minutes ago" — to a caller who is already authenticated as the owner of the
// secret, and who cannot derive the secret from a code either way.
const staleWindows = 10 // ±5 minutes

// Check is [ValidateCounter] with the refusal reason attached.
//
// Reserved for callers acting on their OWN second factor while already
// authenticated (the admin panel's 2FA screen). Login deliberately keeps using
// [ValidateCounter]: on an unauthenticated endpoint, "wrong" and "expired" must
// look identical to the caller, and the response must not depend on any extra
// work the server did.
func Check(secret, input string, lastUsed uint64) (uint64, Result) {
	return check(secret, input, lastUsed, true)
}

func check(secret, input string, lastUsed uint64, labelStale bool) (uint64, Result) {
	input = strings.TrimSpace(input)
	if len(input) != digits {
		return 0, Invalid
	}
	now := uint64(time.Now().Unix() / period)
	for _, d := range []int64{-1, 0, 1} {
		c := uint64(int64(now) + d)
		want, err := codeAt(secret, c)
		if err != nil {
			return 0, Invalid
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(input)) != 1 {
			continue
		}
		// Correct code, but already spent (or older than one we have spent).
		// Re-entering the code you just logged in with is the single most
		// common way to land here, and "wrong code" would send the admin
		// hunting for a typo that is not there.
		if c <= lastUsed {
			return 0, Expired
		}
		return c, Valid
	}
	if !labelStale {
		return 0, Invalid
	}
	for d := int64(-staleWindows); d <= staleWindows; d++ {
		if d >= -1 && d <= 1 {
			continue // already walked by the accept loop above
		}
		c := uint64(int64(now) + d)
		want, err := codeAt(secret, c)
		if err != nil {
			return 0, Invalid
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(input)) == 1 {
			return 0, Expired
		}
	}
	return 0, Invalid
}

// URI builds the otpauth:// provisioning URI an authenticator app imports (as a
// QR code or manual "setup key").
func URI(secret, account, issuer string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&digits=%d&period=%d",
		url.PathEscape(issuer), url.PathEscape(account), secret, url.QueryEscape(issuer), digits, period)
}
