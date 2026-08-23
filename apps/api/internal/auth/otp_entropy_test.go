package auth

import (
	"math"
	"testing"
)

// randDigits must draw uniformly. The old `byte % 10` produced 0-5 at 26/256
// and 6-9 at 25/256 — a 4% skew that both shortens the effective search space
// and tells a guesser which digits to try first. Rejection sampling removes it.
func TestRandDigitsIsUnbiased(t *testing.T) {
	const (
		samples = 60000
		digits  = 10
	)
	counts := [digits]int{}
	for i := 0; i < samples; i++ {
		s, err := randDigits(1)
		if err != nil {
			t.Fatal(err)
		}
		if len(s) != 1 || s[0] < '0' || s[0] > '9' {
			t.Fatalf("randDigits(1) returned %q", s)
		}
		counts[s[0]-'0']++
	}

	// Chi-square against a uniform expectation. 9 degrees of freedom, 0.1%
	// significance -> critical value 27.88. The biased generator scores far
	// above this at 60k samples, a uniform one essentially never does.
	expected := float64(samples) / digits
	chi := 0.0
	for _, c := range counts {
		d := float64(c) - expected
		chi += d * d / expected
	}
	if chi > 27.88 {
		t.Errorf("digit distribution is not uniform: chi-square = %.2f, counts = %v", chi, counts)
	}
	if math.IsNaN(chi) {
		t.Fatal("chi-square is NaN")
	}
}

func TestRandDigitsLength(t *testing.T) {
	for _, n := range []int{4, 6, 8} {
		s, err := randDigits(n)
		if err != nil {
			t.Fatal(err)
		}
		if len(s) != n {
			t.Errorf("randDigits(%d) returned %q (len %d)", n, s, len(s))
		}
	}
}
