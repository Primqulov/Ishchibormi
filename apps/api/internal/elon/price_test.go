package elon

import (
	"testing"
	"time"
)

func TestValidateStartDate(t *testing.T) {
	// 2026-07-01 10:00 Asia/Tashkent (UTC+5).
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, uzTZ)
	day := func(d string) string { return d } // YYYY-MM-DD
	cases := []struct {
		name      string
		startDate string
		allowPast bool
		wantErr   bool
	}{
		{"empty ok", "", false, false},
		{"today ok", day("2026-07-01"), false, false},
		{"today with time ok", "2026-07-01T14:30:00.000", false, false},
		{"tomorrow ok", day("2026-07-02"), false, false},
		{"day after tomorrow ok", day("2026-07-03"), false, false},
		{"3 days ahead rejected", day("2026-07-04"), false, true},
		{"yesterday rejected on create", day("2026-06-30"), false, true},
		{"yesterday allowed on update", day("2026-06-30"), true, false},
		{"too far still rejected on update", day("2026-07-04"), true, true},
		{"garbage rejected", "not-a-date", false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateStartDate(c.startDate, now, c.allowPast)
			if (err != nil) != c.wantErr {
				t.Fatalf("validateStartDate(%q, allowPast=%v) err=%v, wantErr=%v", c.startDate, c.allowPast, err, c.wantErr)
			}
		})
	}
}

func TestComputePrice(t *testing.T) {
	cases := []struct {
		name      string
		req       upsertReq
		wantType  string
		wantTotal int64
		wantPer   int64
	}{
		{"per_worker", upsertReq{PricingType: "per_worker", PriceAmount: 100000, WorkersNeeded: 3}, "per_worker", 300000, 100000},
		{"total", upsertReq{PricingType: "total", PriceAmount: 600000, WorkersNeeded: 4}, "total", 600000, 150000},
		{"empty -> negotiable", upsertReq{PricingType: "", PriceAmount: 0, WorkersNeeded: 2}, "negotiable", 0, 0},
		{"empty + amount falls back to per_worker", upsertReq{PricingType: "", PriceAmount: 200000, WorkersNeeded: 2}, "per_worker", 400000, 200000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pt, total, per := c.req.computePrice()
			if pt != c.wantType || total != c.wantTotal || per != c.wantPer {
				t.Fatalf("got (%s,%d,%d) want (%s,%d,%d)", pt, total, per, c.wantType, c.wantTotal, c.wantPer)
			}
		})
	}
}
