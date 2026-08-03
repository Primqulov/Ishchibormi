package account

import (
	"regexp"
	"strings"
	"testing"
)

// Telegram rejects a message whose HTML it can't parse ("can't parse entities"),
// which would break delivery for whichever unlucky user drew a code containing
// &, < or >. The symbol alphabet doesn't currently include them, but the message
// must stay correct if it ever does — so assert the escaping, not the alphabet.
func TestDeleteCodeMessageEscapesCode(t *testing.T) {
	msg := deleteCodeMessage("a<b>&c")

	if strings.Contains(msg, "<b>&c") {
		t.Fatalf("code was interpolated raw:\n%s", msg)
	}
	if !strings.Contains(msg, "a&lt;b&gt;&amp;c") {
		t.Fatalf("code not escaped as expected:\n%s", msg)
	}
}

// Telegram's HTML parse mode supports a fixed tag list; anything else is an
// error. Keep the message to the two tags we intend to use.
func TestDeleteCodeMessageUsesOnlySupportedTags(t *testing.T) {
	msg := deleteCodeMessage("Ab3!xY")

	allowed := map[string]bool{"b": true, "/b": true, "code": true, "/code": true}
	for _, tag := range regexp.MustCompile(`<([^>]*)>`).FindAllStringSubmatch(msg, -1) {
		if !allowed[tag[1]] {
			t.Fatalf("unsupported tag <%s> in message:\n%s", tag[1], msg)
		}
	}

	// Every opened tag must close, or the whole message fails to parse.
	for _, tag := range []string{"b", "code"} {
		if strings.Count(msg, "<"+tag+">") != strings.Count(msg, "</"+tag+">") {
			t.Fatalf("unbalanced <%s> tags in message:\n%s", tag, msg)
		}
	}
}

// A real generated code must survive the round trip intact — the user copies it
// out of Telegram and it has to match what the database stored.
func TestDeleteCodeMessageCarriesCodeVerbatim(t *testing.T) {
	for i := 0; i < 100; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		if !strings.Contains(deleteCodeMessage(code), "<code>"+code+"</code>") {
			t.Fatalf("code %q not rendered verbatim in message", code)
		}
	}
}
