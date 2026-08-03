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
func Validate(secret, input string) bool {
	input = strings.TrimSpace(input)
	if len(input) != digits {
		return false
	}
	counter := uint64(time.Now().Unix() / period)
	for _, d := range []int64{0, -1, 1} {
		want, err := codeAt(secret, uint64(int64(counter)+d))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(input)) == 1 {
			return true
		}
	}
	return false
}

// URI builds the otpauth:// provisioning URI an authenticator app imports (as a
// QR code or manual "setup key").
func URI(secret, account, issuer string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&digits=%d&period=%d",
		url.PathEscape(issuer), url.PathEscape(account), secret, url.QueryEscape(issuer), digits, period)
}
