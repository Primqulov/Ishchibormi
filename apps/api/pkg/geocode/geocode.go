// Package geocode does reverse geocoding (coordinates -> region/district)
// using the free OpenStreetMap Nominatim service. No API key required.
//
// Ish beruvchi xato kiritmasligi uchun viloyat va tuman koordinatadan
// avtomatik aniqlanadi.
package geocode

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Place is the resolved administrative location for a coordinate.
type Place struct {
	Region   string // viloyat / shahar (state)
	District string // tuman (county/city_district)
}

var client = &http.Client{Timeout: 6 * time.Second}

type nominatimResp struct {
	Address struct {
		State        string `json:"state"`
		Region       string `json:"region"`
		County       string `json:"county"`
		City         string `json:"city"`
		Town         string `json:"town"`
		Municipality string `json:"municipality"`
		CityDistrict string `json:"city_district"`
		Suburb       string `json:"suburb"`
		District     string `json:"district"`
	} `json:"address"`
}

// Reverse resolves the given coordinates into a Place. On any failure it
// returns an empty Place and a non-nil error; callers should treat the result
// as best-effort and fall back gracefully.
func Reverse(ctx context.Context, lat, lng float64) (Place, error) {
	if lat == 0 && lng == 0 {
		return Place{}, fmt.Errorf("empty coordinates")
	}
	url := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=uz,ru,en&lat=%f&lon=%f",
		lat, lng,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Place{}, err
	}
	// Nominatim policy requires an identifying User-Agent.
	req.Header.Set("User-Agent", "IshchiBormi/1.0 (reverse-geocode)")

	res, err := client.Do(req)
	if err != nil {
		return Place{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Place{}, fmt.Errorf("nominatim status %d", res.StatusCode)
	}
	var nr nominatimResp
	if err := json.NewDecoder(res.Body).Decode(&nr); err != nil {
		return Place{}, err
	}
	a := nr.Address

	region := firstNonEmpty(a.State, a.Region, a.City, a.Town, a.Municipality)
	district := firstNonEmpty(a.County, a.CityDistrict, a.District, a.Suburb, a.Town, a.Municipality)

	// "Toshkent shahri" maxsus holati: viloyat va tuman bir xil bo'lib qolmasligi uchun.
	region = cleanUz(region)
	district = cleanUz(district)
	if district == region {
		district = firstNonEmpty(cleanUz(a.CityDistrict), cleanUz(a.Suburb), district)
	}
	return Place{Region: region, District: district}, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// cleanUz trims common administrative suffixes for tidier display.
func cleanUz(s string) string {
	s = strings.TrimSpace(s)
	for _, suf := range []string{" Region", " Province", " viloyati", " tumani", " District", " shahri"} {
		s = strings.TrimSuffix(s, suf)
	}
	return strings.TrimSpace(s)
}
