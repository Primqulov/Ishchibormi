package account

import (
	"strings"
	"testing"
)

func TestGenerateCodeShape(t *testing.T) {
	// Many iterations: the class guarantee must hold for every draw, not most.
	for i := 0; i < 500; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		if len(code) != CodeLength {
			t.Fatalf("length = %d, want %d (%q)", len(code), CodeLength, code)
		}
		for _, tc := range []struct {
			name string
			set  string
		}{
			{"uppercase", upperSet},
			{"lowercase", lowerSet},
			{"digit", digitSet},
			{"symbol", symbolSet},
		} {
			if !strings.ContainsAny(code, tc.set) {
				t.Fatalf("code %q has no %s", code, tc.name)
			}
		}
		if strings.ContainsAny(code, "IOl01") {
			t.Fatalf("code %q contains a look-alike character", code)
		}
	}
}

// The first four positions must not be predictable by class — an unshuffled
// implementation would always be upper, lower, digit, symbol in that order.
func TestGenerateCodeIsShuffled(t *testing.T) {
	const runs = 200
	unshuffled := 0
	for i := 0; i < runs; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		if strings.IndexByte(upperSet, code[0]) >= 0 &&
			strings.IndexByte(lowerSet, code[1]) >= 0 &&
			strings.IndexByte(digitSet, code[2]) >= 0 &&
			strings.IndexByte(symbolSet, code[3]) >= 0 {
			unshuffled++
		}
	}
	// That exact layout is reachable by chance, but should be rare.
	if unshuffled > runs/10 {
		t.Fatalf("class order looks fixed: %d/%d codes in seed order", unshuffled, runs)
	}
}

func TestGenerateCodeVaries(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		seen[code] = true
	}
	if len(seen) < 190 {
		t.Fatalf("only %d unique codes in 200 draws — generator is not random enough", len(seen))
	}
}
