package admin

import "testing"

func TestCSVCellNeutralizesSpreadsheetFormulas(t *testing.T) {
	for _, dangerous := range []string{"=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =HYPERLINK(\"x\")"} {
		if got := csvCell(dangerous); got == dangerous || got[0] != '\'' {
			t.Errorf("csvCell(%q)=%q; formula was not neutralized", dangerous, got)
		}
	}
	for _, safe := range []string{"Ali", "998901234567", "", "normal-text"} {
		if got := csvCell(safe); got != safe {
			t.Errorf("csvCell(%q)=%q; safe value changed", safe, got)
		}
	}
}
