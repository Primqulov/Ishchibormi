package application

import (
	"testing"
	"time"

	"github.com/ishchibormi/backend/internal/models"
)

func TestAutoCompleteReady(t *testing.T) {
	// Asia/Tashkent (UTC+5) — ScheduledStart naive vaqtni shu mintaqada talqin qiladi.
	uz := time.FixedZone("UZT", 5*3600)
	start := time.Date(2026, 1, 10, 9, 0, 0, 0, uz) // 09:00 uz

	cases := []struct {
		name string
		elon models.Elon
		now  time.Time
		want bool
	}{
		{
			name: "date + workTimeFrom, 17h passed → not ready",
			elon: models.Elon{StartDate: "2026-01-10", WorkTimeFrom: "09:00"},
			now:  start.Add(17 * time.Hour),
			want: false,
		},
		{
			name: "date + workTimeFrom, exactly 18h passed → ready",
			elon: models.Elon{StartDate: "2026-01-10", WorkTimeFrom: "09:00"},
			now:  start.Add(18 * time.Hour),
			want: true,
		},
		{
			name: "date + workTimeFrom, 18h1m passed → ready",
			elon: models.Elon{StartDate: "2026-01-10", WorkTimeFrom: "09:00"},
			now:  start.Add(18*time.Hour + time.Minute),
			want: true,
		},
		{
			name: "full ISO startDate (Flutter), 20h passed → ready",
			elon: models.Elon{StartDate: "2026-01-10T09:00:00.000"},
			now:  start.Add(20 * time.Hour),
			want: true,
		},
		{
			name: "full ISO startDate (Flutter), 10h passed → not ready",
			elon: models.Elon{StartDate: "2026-01-10T09:00:00.000"},
			now:  start.Add(10 * time.Hour),
			want: false,
		},
		{
			name: "empty startDate → never ready",
			elon: models.Elon{StartDate: "", WorkTimeFrom: "09:00"},
			now:  start.Add(1000 * time.Hour),
			want: false,
		},
		{
			name: "date only, no workTimeFrom → uses 23:59, 18h after that",
			elon: models.Elon{StartDate: "2026-01-10"},
			now:  time.Date(2026, 1, 11, 23, 0, 0, 0, uz), // 23:00 next day = ~23h after 23:59
			want: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := autoCompleteReady(c.elon, c.now); got != c.want {
				t.Fatalf("autoCompleteReady = %v, want %v", got, c.want)
			}
		})
	}
}
