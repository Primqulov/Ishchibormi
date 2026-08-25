package gemini

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Bu testlar HAQIQIY Gemini API'ga chiqmaydi — httptest serveri javob
// beradi. Kalit ham, tarmoq ham kerak emas. Jonli tekshiruv uchun quyidagi
// TestIntegrationLiveGemini ga qarang (u ataylab o'chirilgan).

func stubServer(t *testing.T, status int, body string, capture *http.Request, captureBody *[]byte) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			*capture = *r.Clone(context.Background())
		}
		if captureBody != nil {
			b, _ := io.ReadAll(r.Body)
			*captureBody = b
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// classificationBody — modelning structured JSON javobini o'rab beradi.
// Shakl jonli API'dan olingan.
func classificationBody(levels map[string]string) string {
	inner, _ := json.Marshal(levels)
	outer, _ := json.Marshal(map[string]any{
		"candidates": []any{map[string]any{
			"content":      map[string]any{"parts": []any{map[string]any{"text": string(inner)}}},
			"finishReason": "STOP",
		}},
	})
	return string(outer)
}

func allNegligible() map[string]string {
	m := map[string]string{}
	for _, c := range Categories {
		m[c] = ProbNegligible
	}
	return m
}

// TestClassifyRequestShape — so'rov Gemini hujjatidagi formatga mos
// tuzilishini va kalit FAQAT sarlavhada ketishini tekshiradi.
func TestClassifyRequestShape(t *testing.T) {
	var got http.Request
	var body []byte
	srv := stubServer(t, 200, classificationBody(allNegligible()), &got, &body)

	c := New("AIza-test-secret-value", srv.URL, "", 5*time.Second)
	if _, err := c.Classify(context.Background(), Input{
		Text: "salom", ImageMIME: "image/png", Image: []byte{0x89, 0x50, 0x4e, 0x47},
	}); err != nil {
		t.Fatalf("Classify: %v", err)
	}

	if want := "/models/" + DefaultModel + ":generateContent"; got.URL.Path != want {
		t.Errorf("path = %q, want %q", got.URL.Path, want)
	}
	if h := got.Header.Get("x-goog-api-key"); h != "AIza-test-secret-value" {
		t.Errorf("x-goog-api-key = %q", h)
	}
	// Kalit URL query'da BO'LMASLIGI kerak — url.Error xato matniga URL'ni
	// qo'shadi, ya'ni kalit logga tushardi.
	if got.URL.RawQuery != "" {
		t.Errorf("URL query = %q, bo'sh bo'lishi kerak (kalit sarlavhada)", got.URL.RawQuery)
	}

	var req struct {
		SystemInstruction *struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"systemInstruction"`
		Contents []struct {
			Role  string `json:"role"`
			Parts []struct {
				Text       string `json:"text"`
				InlineData *struct {
					MIMEType string `json:"mime_type"`
					Data     string `json:"data"`
				} `json:"inline_data"`
			} `json:"parts"`
		} `json:"contents"`
		SafetySettings []struct {
			Category  string `json:"category"`
			Threshold string `json:"threshold"`
		} `json:"safetySettings"`
		GenerationConfig struct {
			ResponseMIMEType string `json:"responseMimeType"`
			ResponseSchema   struct {
				Type       string `json:"type"`
				Properties map[string]struct {
					Type string   `json:"type"`
					Enum []string `json:"enum"`
				} `json:"properties"`
			} `json:"responseSchema"`
		} `json:"generationConfig"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("so'rov tanasi yaroqsiz JSON: %v (%s)", err, body)
	}
	if req.SystemInstruction == nil || len(req.SystemInstruction.Parts) == 0 {
		t.Error("systemInstruction yo'q")
	}
	if len(req.Contents) != 1 || req.Contents[0].Role != "user" {
		t.Fatalf("contents = %+v, bitta 'user' navbati kutilgan", req.Contents)
	}
	var sawText, sawImage bool
	for _, p := range req.Contents[0].Parts {
		if strings.Contains(p.Text, "salom") {
			sawText = true
		}
		if p.InlineData != nil {
			sawImage = true
			if p.InlineData.MIMEType != "image/png" {
				t.Errorf("mime_type = %q, want image/png", p.InlineData.MIMEType)
			}
			if _, err := base64.StdEncoding.DecodeString(p.InlineData.Data); err != nil {
				t.Errorf("inline_data.data base64 emas: %v", err)
			}
		}
	}
	if !sawText || !sawImage {
		t.Errorf("matn va rasm qismlari kutilgan: %+v", req.Contents[0].Parts)
	}
	if req.GenerationConfig.ResponseMIMEType != "application/json" {
		t.Errorf("responseMimeType = %q", req.GenerationConfig.ResponseMIMEType)
	}
	if len(req.GenerationConfig.ResponseSchema.Properties) != len(Categories) {
		t.Errorf("responseSchema %d ta kategoriya, want %d",
			len(req.GenerationConfig.ResponseSchema.Properties), len(Categories))
	}
	for _, cat := range Categories {
		p, ok := req.GenerationConfig.ResponseSchema.Properties[cat]
		if !ok {
			t.Errorf("sxemada %s yo'q", cat)
			continue
		}
		if len(p.Enum) != 4 {
			t.Errorf("%s enum = %v, 4 ta daraja kutilgan", cat, p.Enum)
		}
	}
	if len(req.SafetySettings) != len(Categories) {
		t.Errorf("safetySettings = %+v", req.SafetySettings)
	}
	for _, ss := range req.SafetySettings {
		if ss.Threshold != "BLOCK_NONE" {
			t.Errorf("%s threshold = %q, want BLOCK_NONE (bizga baho kerak, blok emas)", ss.Category, ss.Threshold)
		}
	}
	if strings.Contains(string(body), "AIza-test") {
		t.Error("API kalit so'rov tanasiga tushib qolgan")
	}
}

func TestClassifyParsesStructuredOutput(t *testing.T) {
	levels := allNegligible()
	levels["HARM_CATEGORY_SEXUALLY_EXPLICIT"] = ProbHigh
	srv := stubServer(t, 200, classificationBody(levels), nil, nil)

	v, err := New("AIza-x", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{Text: "x"})
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if v.BlockReason != "" {
		t.Errorf("BlockReason = %q, want empty", v.BlockReason)
	}
	if got := v.Ratings["HARM_CATEGORY_SEXUALLY_EXPLICIT"]; got != ProbHigh {
		t.Errorf("SEXUALLY_EXPLICIT = %q, want HIGH", got)
	}
	if len(v.Ratings) != len(Categories) {
		t.Errorf("Ratings = %v, %d ta kategoriya kutilgan", v.Ratings, len(Categories))
	}
}

// TestClassifyPromptBlocked — Gemini kirishning o'zini bloklasa
// (promptFeedback.blockReason) bu rad etish signali sifatida qaytariladi.
func TestClassifyPromptBlocked(t *testing.T) {
	body := `{"promptFeedback":{"blockReason":"IMAGE_SAFETY","safetyRatings":[
		{"category":"HARM_CATEGORY_SEXUALLY_EXPLICIT","probability":"HIGH"}]}}`
	srv := stubServer(t, 200, body, nil, nil)

	v, err := New("AIza-x", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{Image: []byte{1}})
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if v.BlockReason != "IMAGE_SAFETY" {
		t.Errorf("BlockReason = %q, want IMAGE_SAFETY", v.BlockReason)
	}
	if v.Ratings["HARM_CATEGORY_SEXUALLY_EXPLICIT"] != ProbHigh {
		t.Errorf("Ratings = %v", v.Ratings)
	}
}

// TestClassifyFinishReasonSafety — model javobi SAFETY sababli to'xtatilsa
// ham rad etish signali qaytadi.
func TestClassifyFinishReasonSafety(t *testing.T) {
	body := `{"candidates":[{"finishReason":"SAFETY","safetyRatings":[
		{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","probability":"MEDIUM"}]}]}`
	srv := stubServer(t, 200, body, nil, nil)

	v, err := New("AIza-x", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{Text: "x"})
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if v.BlockReason != "SAFETY" {
		t.Errorf("BlockReason = %q, want SAFETY", v.BlockReason)
	}
}

func TestClassifyNotConfigured(t *testing.T) {
	c := New("", "", "", 0)
	if c.Configured() {
		t.Fatal("Configured() = true bo'sh kalit uchun")
	}
	if _, err := c.Classify(context.Background(), Input{Text: "x"}); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("err = %v, want ErrNotConfigured", err)
	}
}

func TestClassifyEmptyInput(t *testing.T) {
	srv := stubServer(t, 200, classificationBody(allNegligible()), nil, nil)
	if _, err := New("AIza-x", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{}); err == nil {
		t.Error("bo'sh kirish uchun xato kutilgan")
	}
}

func TestClassifyAPIError(t *testing.T) {
	cases := []struct {
		name          string
		status        int
		body          string
		wantRPC       string
		wantRetryable bool
		wantUnauth    bool
	}{
		{"kvota", 429, `{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}`, "RESOURCE_EXHAUSTED", true, false},
		{"unauthenticated", 401, `{"error":{"code":401,"message":"API key not valid","status":"UNAUTHENTICATED"}}`, "UNAUTHENTICATED", false, true},
		{"permission", 403, `{"error":{"code":403,"message":"denied","status":"PERMISSION_DENIED"}}`, "PERMISSION_DENIED", false, true},
		{"yaroqsiz", 400, `{"error":{"code":400,"message":"bad image","status":"INVALID_ARGUMENT"}}`, "INVALID_ARGUMENT", false, false},
		{"model yo'q", 404, `{"error":{"code":404,"message":"not found","status":"NOT_FOUND"}}`, "NOT_FOUND", false, false},
		{"server", 503, `{"error":{"code":503,"message":"overloaded","status":"UNAVAILABLE"}}`, "UNAVAILABLE", true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := stubServer(t, c.status, c.body, nil, nil)
			_, err := New("AIza-x", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{Text: "x"})
			var apiErr *APIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("err = %T (%v), want *APIError", err, err)
			}
			if apiErr.Status != c.status || apiErr.RPCStatus != c.wantRPC {
				t.Errorf("status=%d rpc=%q, want %d/%q", apiErr.Status, apiErr.RPCStatus, c.status, c.wantRPC)
			}
			if apiErr.Retryable() != c.wantRetryable {
				t.Errorf("Retryable() = %v, want %v", apiErr.Retryable(), c.wantRetryable)
			}
			if apiErr.Unauthorized() != c.wantUnauth {
				t.Errorf("Unauthorized() = %v, want %v", apiErr.Unauthorized(), c.wantUnauth)
			}
		})
	}
}

// TestAPIErrorRedactsKey — Google xato matnida kalitni qaytarib yuborsa ham
// u bizning xatomizga (demak logga) tushmasligi kerak.
func TestAPIErrorRedactsKey(t *testing.T) {
	body := `{"error":{"code":400,"message":"API key not valid: AIzaSyDUMMYKEY123456 please pass a valid key","status":"INVALID_ARGUMENT"}}`
	srv := stubServer(t, 400, body, nil, nil)

	_, err := New("AIzaSyDUMMYKEY123456", srv.URL, "", 5*time.Second).Classify(context.Background(), Input{Text: "x"})
	if err == nil {
		t.Fatal("xato kutilgan")
	}
	if strings.Contains(err.Error(), "AIzaSyDUMMYKEY123456") {
		t.Errorf("kalit xato matniga tushdi: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "[REDACTED]") {
		t.Errorf("redaction belgisi kutilgan: %s", err.Error())
	}
}

func TestClassifyTimeout(t *testing.T) {
	// Ikkinchi shox kerak: Windows'da klient timeout'idan keyin so'rov
	// konteksti darrov bekor bo'lmaydi va Close() bloklanib qolardi.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer srv.Close()

	start := time.Now()
	if _, err := New("AIza-x", srv.URL, "", 150*time.Millisecond).
		Classify(context.Background(), Input{Text: "x"}); err == nil {
		t.Fatal("timeout xatosi kutilgan")
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Errorf("%v ketdi — klient timeout'i ishlamadi", elapsed)
	}
}

func TestProbAtLeast(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{ProbHigh, ProbMedium, true},
		{ProbMedium, ProbMedium, true},
		{ProbLow, ProbMedium, false},
		{ProbNegligible, ProbMedium, false},
		{"high", ProbMedium, true},           // katta-kichik harf muhim emas
		{"SOMETHING_NEW", ProbMedium, false}, // noma'lum daraja hech qachon bloklamaydi
		{ProbHigh, "SOMETHING_NEW", false},
	}
	for _, c := range cases {
		if got := ProbAtLeast(c.a, c.b); got != c.want {
			t.Errorf("ProbAtLeast(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestRedactString(t *testing.T) {
	cases := []struct{ in, want string }{
		{"no secrets here", "no secrets here"},
		{"key AIzaSyABC123 used", "key [REDACTED] used"},
		{"token AQ.Ab8RN6xyz used", "token [REDACTED] used"},
		{`{"key":"AIzaSyXYZ","n":1}`, `{"key":"[REDACTED]","n":1}`},
	}
	for _, c := range cases {
		if got := redactString(c.in); got != c.want {
			t.Errorf("redactString(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
