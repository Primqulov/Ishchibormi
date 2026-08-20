package storage

import "testing"

func TestKeyBelongsToUser(t *testing.T) {
	s := &Service{publicBaseURL: "https://cdn.example.test"}
	uid := "64b7f4e9c40a1a2b3c4d5e6f"
	for _, tc := range []struct {
		key  string
		want bool
	}{
		{"avatars/" + uid + "/photo.jpg", true},
		{"elons/" + uid + "/job/photo.jpg", true},
		{"/avatars/" + uid + "/photo.jpg", true},
		{"avatars/other-user/photo.jpg", false},
		{"category-icons/" + uid + "/icon.png", false},
		{"avatars/" + uid + "-extra/photo.jpg", false},
		{"avatars/" + uid + "/../../category-icons/admin/icon.png", false},
		{"avatars\\" + uid + "\\photo.jpg", false},
		{"", false},
	} {
		if got := s.KeyBelongsToUser(tc.key, uid); got != tc.want {
			t.Errorf("KeyBelongsToUser(%q)=%v, want %v", tc.key, got, tc.want)
		}
	}
}

func TestURLBelongsToUserRejectsForeignHost(t *testing.T) {
	s := &Service{publicBaseURL: "https://cdn.example.test"}
	uid := "user-1"
	if !s.URLBelongsToUser("https://cdn.example.test/avatars/user-1/a.png", uid) {
		t.Fatal("own CDN URL was rejected")
	}
	if s.URLBelongsToUser("https://evil.example/avatars/user-1/a.png", uid) {
		t.Fatal("foreign URL was accepted")
	}
}
