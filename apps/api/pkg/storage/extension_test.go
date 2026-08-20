package storage

import "testing"

func TestSafeExtensionFollowsSniffedMIME(t *testing.T) {
	for _, tc := range []struct{ name, mime, want string }{
		{"payload.html", "image/png", ".png"},
		{"photo.exe", "image/jpeg", ".jpg"},
		{"photo.jpeg", "image/jpeg", ".jpeg"},
		{"photo.webp", "image/webp", ".webp"},
	} {
		if got := safeExtension(tc.name, tc.mime); got != tc.want {
			t.Errorf("safeExtension(%q, %q)=%q, want %q", tc.name, tc.mime, got, tc.want)
		}
	}
}
