package main

import "testing"

func TestIsOwnContact(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		sender, contactUserID int64
		want                  bool
	}{
		{"own Telegram contact", 42, 42, true},
		{"somebody else's contact", 42, 99, false},
		{"plain contact card has no owner id", 42, 0, false},
		{"missing sender", 0, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := isOwnContact(tc.sender, tc.contactUserID); got != tc.want {
				t.Fatalf("isOwnContact(%d, %d)=%v, want %v", tc.sender, tc.contactUserID, got, tc.want)
			}
		})
	}
}
