package upload

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestAvatarUploadPreservesOriginalBytes(t *testing.T) {
	h := handlerFor(t, &fakeModerator{on: false})
	raw := pngBytes(t, 800)
	w := httptest.NewRecorder()
	h.Upload(w, uploadReq(t, "avatar", raw))
	if w.Code != 201 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var out struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	stored, err := h.Storage.Download(context.Background(), out.Key, 5<<20)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, stored) {
		t.Fatal("avatar original resized/re-encoded")
	}
}
