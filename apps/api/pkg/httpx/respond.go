package httpx

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errBody struct {
	Error APIError `json:"error"`
}

type HTTPError struct {
	Status  int
	Code    string
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

func NewError(status int, code, msg string) *HTTPError {
	return &HTTPError{Status: status, Code: code, Message: msg}
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Err(w http.ResponseWriter, err error) {
	var he *HTTPError
	if errors.As(err, &he) {
		JSON(w, he.Status, errBody{Error: APIError{Code: he.Code, Message: he.Message}})
		return
	}
	// Don't leak internal error details (driver/DB messages, stack info) to
	// clients. Log server-side, return a generic message.
	log.Printf("internal error: %v", err)
	JSON(w, http.StatusInternalServerError, errBody{Error: APIError{Code: "internal", Message: "internal server error"}})
}

// maxJSONBody caps JSON request bodies to guard against memory-exhaustion DoS.
// File uploads use ParseMultipartForm with their own larger limits and never
// go through Decode, so they are unaffected.
const maxJSONBody = 1 << 20 // 1 MiB

func Decode(r *http.Request, v any) error {
	limited := http.MaxBytesReader(nil, r.Body, maxJSONBody)
	if err := json.NewDecoder(limited).Decode(v); err != nil {
		return NewError(http.StatusBadRequest, "invalid_json", "invalid JSON body")
	}
	return nil
}
