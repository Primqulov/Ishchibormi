package models

import "strings"

// ListingWorkDetails is an internal candidate snapshot. Keeping exact location
// details out of the public Application JSON preserves its existing contract.
type ListingWorkDetails struct {
	StartDate    string  `bson:"startDate"`
	WorkTimeFrom string  `bson:"workTimeFrom"`
	WorkTimeTo   string  `bson:"workTimeTo"`
	LocationText string  `bson:"locationText"`
	LocationURL  string  `bson:"locationUrl"`
	Lat          float64 `bson:"lat"`
	Lng          float64 `bson:"lng"`
	Region       string  `bson:"region"`
	District     string  `bson:"district"`
}

func (e Elon) WorkDetails() *ListingWorkDetails {
	return &ListingWorkDetails{
		StartDate: strings.TrimSpace(e.StartDate), WorkTimeFrom: strings.TrimSpace(e.WorkTimeFrom),
		WorkTimeTo: strings.TrimSpace(e.WorkTimeTo), LocationText: strings.TrimSpace(e.LocationText),
		LocationURL: strings.TrimSpace(e.LocationURL), Lat: e.Lat, Lng: e.Lng,
		Region: strings.TrimSpace(e.Region), District: strings.TrimSpace(e.District),
	}
}
