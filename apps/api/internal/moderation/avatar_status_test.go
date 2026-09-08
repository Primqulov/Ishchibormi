package moderation

import (
	"context"
	"testing"

	"github.com/ishchibormi/backend/pkg/gemini"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestAvatarStatusNeverReportsSkippedCheckAsClean(t *testing.T) {
	for _, tc := range []struct {
		name    string
		enforce bool
		quota   bool
		want    string
	}{
		{"checked", true, false, "clean"}, {"disabled", false, false, "unknown"}, {"quota", true, true, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fn := always(negligible())
			if tc.quota {
				fn = func(gemini.Input) (*gemini.Verdict, error) { return nil, quotaErr() }
			}
			g, _ := guardWith(t, GuardOptions{Enforce: tc.enforce}, fn)
			status, err := g.CheckImageStatus(context.Background(), primitive.NewObjectID(), "avatar", "image_rejected", "Rasm qabul qilinmadi", "image/png", pngBytes(t, 16))
			if err != nil || status != tc.want {
				t.Fatalf("status %q, error %v; want %q", status, err, tc.want)
			}
		})
	}
}
