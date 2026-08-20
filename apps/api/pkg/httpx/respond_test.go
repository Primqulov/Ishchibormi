package httpx

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRejectsUnknownAndTrailingJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}
	for _, raw := range []string{
		`{"name":"ok","unexpected":true}`,
		`{"name":"ok"} {"name":"second"}`,
	} {
		req := httptest.NewRequest("POST", "/", strings.NewReader(raw))
		var got payload
		if err := Decode(req, &got); err == nil {
			t.Fatalf("Decode accepted %q", raw)
		}
	}
}

func TestDecodeAcceptsOneJSONValue(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"ok"}`))
	var got struct {
		Name string `json:"name"`
	}
	if err := Decode(req, &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "ok" {
		t.Fatalf("name=%q", got.Name)
	}
}
