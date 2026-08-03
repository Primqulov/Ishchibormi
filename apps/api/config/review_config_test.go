package config

import (
	"strings"
	"testing"
	"time"
)

func validReviewConfig() Config {
	return Config{
		OTPLength:            6,
		ReviewLoginEnabled:   true,
		ReviewLoginCode:      "418306",
		ReviewLoginUserID:    "6a5cdc801af63650ee96c89e",
		ReviewLoginExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
}

// The default configuration — the one every server boots with — must never
// produce a complaint, because the switch is off.
func TestReviewLoginSilentWhenDisabled(t *testing.T) {
	if p := (Config{OTPLength: 6}).reviewLoginProblems(); len(p) != 0 {
		t.Fatalf("default config complained: %v", p)
	}
	// Even with leftover values lying around, disabled means disabled.
	c := validReviewConfig()
	c.ReviewLoginEnabled = false
	c.ReviewLoginCode = "1"
	c.ReviewLoginExpiresAt = time.Time{}
	c.ReviewLoginUserID = ""
	if p := c.reviewLoginProblems(); len(p) != 0 {
		t.Fatalf("disabled config complained: %v", p)
	}
}

func TestReviewLoginAcceptsAValidWindow(t *testing.T) {
	if p := validReviewConfig().reviewLoginProblems(); len(p) != 0 {
		t.Fatalf("valid config rejected: %v", p)
	}
}

func TestReviewLoginRejectsBadConfigurations(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Config)
		want string
	}{
		{"no code", func(c *Config) { c.ReviewLoginCode = "" }, "REVIEW_LOGIN_CODE must be set"},
		{"wrong length", func(c *Config) { c.ReviewLoginCode = "4183" }, "exactly 6 digits"},
		{"not digits", func(c *Config) { c.ReviewLoginCode = "41830a" }, "digits only"},
		{"all same digit", func(c *Config) { c.ReviewLoginCode = "555555" }, "trivially guessable"},
		{"ascending run", func(c *Config) { c.ReviewLoginCode = "123456" }, "trivially guessable"},
		{"descending run", func(c *Config) { c.ReviewLoginCode = "654321" }, "trivially guessable"},
		{"no expiry", func(c *Config) { c.ReviewLoginExpiresAt = time.Time{} }, "REVIEW_LOGIN_EXPIRES_AT must be set"},
		{"window too long", func(c *Config) { c.ReviewLoginExpiresAt = time.Now().Add(90 * 24 * time.Hour) }, "more than 30 days"},
		{"no user id", func(c *Config) { c.ReviewLoginUserID = "" }, "REVIEW_LOGIN_USER_ID"},
		{"malformed user id", func(c *Config) { c.ReviewLoginUserID = "nope" }, "REVIEW_LOGIN_USER_ID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validReviewConfig()
			tc.mut(&c)
			problems := c.reviewLoginProblems()
			if len(problems) == 0 {
				t.Fatalf("accepted a bad configuration")
			}
			if !strings.Contains(strings.Join(problems, "\n"), tc.want) {
				t.Fatalf("problems %v do not mention %q", problems, tc.want)
			}
		})
	}
}

// A window that has already closed is NOT a boot error: the gate goes inert on
// its own, and failing to start here would take production down the moment a
// review window lapsed.
func TestLapsedWindowIsNotABootError(t *testing.T) {
	c := validReviewConfig()
	c.ReviewLoginExpiresAt = time.Now().Add(-24 * time.Hour)
	if p := c.reviewLoginProblems(); len(p) != 0 {
		t.Fatalf("a lapsed window must not block startup, got: %v", p)
	}
}

func TestIsWeakNumericCode(t *testing.T) {
	weak := []string{"000000", "111111", "123456", "654321", "12", "9"}
	for _, c := range weak {
		if !isWeakNumericCode(c) {
			t.Errorf("%q should be rejected as weak", c)
		}
	}
	strong := []string{"418306", "907213", "102938"}
	for _, c := range strong {
		if isWeakNumericCode(c) {
			t.Errorf("%q should be accepted", c)
		}
	}
}
