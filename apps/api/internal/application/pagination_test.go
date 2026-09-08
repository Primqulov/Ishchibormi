package application

import (
	"net/http/httptest"
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestApplicationPageOptionsStableOrder(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/my/elons/applications?limit=500&page=2", nil)
	options := pageOpts(request, 200, 500)
	// Many applications can have identical timestamps. A unique tie-breaker
	// keeps these rows from moving between the pages used for owner totals.
	wantSort := bson.D{{Key: "appliedAt", Value: -1}, {Key: "_id", Value: -1}}
	if !reflect.DeepEqual(options.Sort, wantSort) {
		t.Fatalf("unstable pagination sort: got %#v, want %#v", options.Sort, wantSort)
	}
	if options.Skip == nil || *options.Skip != 500 || options.Limit == nil || *options.Limit != 500 {
		t.Fatalf("second owner application page: skip=%v limit=%v", options.Skip, options.Limit)
	}
}
