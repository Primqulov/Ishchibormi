package account

import (
	"crypto/rand"
	"math/big"
)

// Character classes for the deletion code. Unlike the 6-digit login OTP this
// code is mixed-case with punctuation, so a stolen glance or a shoulder-surfed
// login code can never be replayed against the (irreversible) delete endpoint.
//
// Look-alike characters are excluded on purpose — the user reads the code out of
// Telegram and types it into the app by hand, so I/l/1 and O/0 confusion would
// burn attempts against a 5-guess budget.
const (
	upperSet  = "ABCDEFGHJKLMNPQRSTUVWXYZ" // no I, O
	lowerSet  = "abcdefghijkmnpqrstuvwxyz" // no l, o
	digitSet  = "23456789"                 // no 0, 1
	symbolSet = "!@#$%*?+-="

	// CodeLength is the number of characters in a deletion code.
	CodeLength = 6
)

// generateCode returns a CodeLength-character code guaranteed to contain at
// least one uppercase letter, one lowercase letter, one digit and one symbol.
//
// Every draw uses crypto/rand via rand.Int, which is rejection-sampled and so
// unbiased — the login OTP's `byte % len(alphabet)` trick skews toward the first
// few characters of the alphabet and is not reused here.
func generateCode() (string, error) {
	classes := []string{upperSet, lowerSet, digitSet, symbolSet}
	all := upperSet + lowerSet + digitSet + symbolSet

	out := make([]byte, 0, CodeLength)
	// Seed one character per class so the guarantee holds...
	for _, set := range classes {
		c, err := pick(set)
		if err != nil {
			return "", err
		}
		out = append(out, c)
	}
	// ...then fill the remainder from the full alphabet.
	for len(out) < CodeLength {
		c, err := pick(all)
		if err != nil {
			return "", err
		}
		out = append(out, c)
	}
	// Shuffle, otherwise the class order above would be positionally predictable
	// (always upper-lower-digit-symbol in the first four slots).
	if err := shuffle(out); err != nil {
		return "", err
	}
	return string(out), nil
}

func pick(set string) (byte, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(set))))
	if err != nil {
		return 0, err
	}
	return set[n.Int64()], nil
}

// shuffle is Fisher-Yates over a crypto/rand source.
func shuffle(b []byte) error {
	for i := len(b) - 1; i > 0; i-- {
		j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return err
		}
		b[i], b[j.Int64()] = b[j.Int64()], b[i]
	}
	return nil
}
