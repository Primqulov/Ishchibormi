package storage

import "testing"

func TestAvatarCachePolicyPermitsModerationRemoval(t *testing.T) {
	if got := objectCacheControl("avatars/user/photo.jpg"); got != "no-store" {
		t.Fatalf("avatar cache policy %s", got)
	}
	if got := objectCacheControl("elons/user/photo.jpg"); got != "no-store" {
		t.Fatalf("moderated listing cache policy %s", got)
	}
}
