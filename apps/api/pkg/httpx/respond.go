package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
)

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// Details — ixtiyoriy strukturali qo'shimcha. Klient uni modal oynada
	// ko'rsatish uchun ishlatadi (masalan ogohlantirish matni va qolgan
	// urinishlar soni). omitempty: mavjud xatolar javobi o'zgarmaydi.
	Details map[string]any `json:"details,omitempty"`
}

type errBody struct {
	Error APIError `json:"error"`
}

type HTTPError struct {
	Status  int
	Code    string
	Message string
	// Details — javobdagi error.details ga tushadi. Bo'sh bo'lsa chiqmaydi.
	Details map[string]any
}

func (e *HTTPError) Error() string { return e.Message }

func NewError(status int, code, msg string) *HTTPError {
	return &HTTPError{Status: status, Code: code, Message: msg}
}

// NewErrorWithDetails — NewError, lekin klient uchun strukturali qo'shimcha
// bilan. Modal oyna sabab va ogohlantirishni alohida ko'rsatishi uchun.
func NewErrorWithDetails(status int, code, msg string, details map[string]any) *HTTPError {
	return &HTTPError{Status: status, Code: code, Message: msg, Details: details}
}

// WithDetails — mavjud xatoga qo'shimcha biriktiradi (nusxa qaytaradi).
func (e *HTTPError) WithDetails(details map[string]any) *HTTPError {
	if e == nil {
		return nil
	}
	cp := *e
	cp.Details = details
	return &cp
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Err(w http.ResponseWriter, err error) {
	var he *HTTPError
	if errors.As(err, &he) {
		JSON(w, he.Status, errBody{Error: APIError{
			Code: he.Code, Message: he.Message, Details: he.Details,
		}})
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
	dec := json.NewDecoder(limited)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return NewError(http.StatusRequestEntityTooLarge, "too_large", "JSON body is too large")
		}
		return NewError(http.StatusBadRequest, "invalid_json", "invalid JSON body")
	}
	// A request must contain exactly one JSON value. Silently accepting a valid
	// object followed by arbitrary bytes creates parser discrepancies between
	// proxies, logs and the application.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return NewError(http.StatusBadRequest, "invalid_json", "invalid JSON body")
	}
	return nil
}
