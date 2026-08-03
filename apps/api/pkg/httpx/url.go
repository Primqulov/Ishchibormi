package httpx

import (
	"net/url"
	"strings"
)

// IsSafeHTTPURL reports whether raw is empty (allowed — means "unset") or a
// well-formed absolute http(s) URL. Used to keep user-supplied URLs (avatars,
// images, location links) from carrying javascript:/data: payloads that would
// execute when rendered in an href on another user's browser.
func IsSafeHTTPURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
