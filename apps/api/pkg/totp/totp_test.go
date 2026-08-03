package totp

import (
	"testing"
	"time"
)

// RFC 6238 reference: the ASCII secret "12345678901234567890" is base32
// "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ". At T=59s the 30s counter is 1 and the
// 8-digit TOTP is 94287082, so the 6-digit truncation is 287082. Matching this
// proves interop with Google Authenticator / Authy.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestCodeAtRFCVector(t *testing.T) {
	cases := map[uint64]string{
		1:        "287082",
		37037036: "081804",
	}
	for counter, want := range cases {
		got, err := codeAt(rfcSecret, counter)
		if err != nil {
			t.Fatalf("counter %d: %v", counter, err)
		}
		if got != want {
			t.Errorf("counter %d: got %s, want %s", counter, got, want)
		}
	}
}

func TestGenerateAndValidateRoundTrip(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	// A code computed for the current window must validate.
	cur, err := codeAt(secret, uint64(time.Now().Unix()/period))
	if err != nil {
		t.Fatal(err)
	}
	if !Validate(secret, cur) {
		t.Errorf("freshly generated code did not validate")
	}
	if Validate(secret, "000000") && cur != "000000" {
		t.Errorf("arbitrary wrong code validated")
	}
}
