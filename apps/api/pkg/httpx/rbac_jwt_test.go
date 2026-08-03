package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-please-ignore-0123456789"

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// TestRequireRole locks in the RBAC matrix: superadmin is always allowed, every
// other role passes only when explicitly listed, and an empty allow-list admits
// only superadmin. This is the guard that closed the "any admin could hit any
// endpoint" gap, so it is worth pinning precisely.
func TestRequireRole(t *testing.T) {
	cases := []struct {
		name     string
		role     string
		allowed  []string
		wantCode int
	}{
		{"superadmin allowed with empty list", "superadmin", nil, 200},
		{"superadmin allowed despite restrictive list", "superadmin", []string{"support"}, 200},
		{"moderator allowed when listed", "moderator", []string{"moderator"}, 200},
		{"moderator denied when not listed", "moderator", []string{"support"}, 403},
		{"support allowed when listed", "support", []string{"moderator", "support"}, 200},
		{"support denied on moderator-only", "support", []string{"moderator"}, 403},
		{"empty role denied", "", []string{"moderator"}, 403},
		{"no args admits only superadmin: moderator denied", "moderator", nil, 403},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := RequireRole(c.allowed...)(okHandler())
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(context.WithValue(req.Context(), CtxAdminRole, c.role))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.wantCode {
				t.Errorf("role=%q allowed=%v: got %d, want %d", c.role, c.allowed, rec.Code, c.wantCode)
			}
		})
	}
}

func TestUserTokenRoundTrip(t *testing.T) {
	tok, err := IssueUserToken(testSecret, "user-123", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	uid, err := ParseUserToken(testSecret, tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if uid != "user-123" {
		t.Errorf("uid=%q, want user-123", uid)
	}
}

func TestParseUserTokenWrongSecret(t *testing.T) {
	tok, _ := IssueUserToken(testSecret, "user-123", time.Hour)
	if _, err := ParseUserToken("a-different-secret-0123456789abcd", tok); err == nil {
		t.Error("expected error for token verified with the wrong secret")
	}
}

func TestParseUserTokenExpired(t *testing.T) {
	tok, _ := IssueUserToken(testSecret, "user-123", -time.Minute) // already expired
	if _, err := ParseUserToken(testSecret, tok); err == nil {
		t.Error("expected error for an expired token")
	}
}

// TestJWTMethodPinningRejectsNonHS256 proves the alg-confusion defense: a token
// with a valid signature but a different algorithm (HS384) is rejected because
// ParseWithClaims pins WithValidMethods(HS256).
func TestJWTMethodPinningRejectsNonHS256(t *testing.T) {
	claims := Claims{UserID: "user-123", RegisteredClaims: jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS384, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseUserToken(testSecret, tok); err == nil {
		t.Error("HS384 token should be rejected by HS256 method pinning")
	}
}

func TestUserAuthMiddleware(t *testing.T) {
	valid, _ := IssueUserToken(testSecret, "user-abc", time.Hour)
	var seen string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = UserID(r)
		w.WriteHeader(200)
	})
	h := UserAuth(testSecret)(inner)

	t.Run("valid token passes and injects uid", func(t *testing.T) {
		seen = ""
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+valid)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("got %d, want 200", rec.Code)
		}
		if seen != "user-abc" {
			t.Errorf("injected uid=%q, want user-abc", seen)
		}
	})
	t.Run("missing token 401", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != 401 {
			t.Errorf("got %d, want 401", rec.Code)
		}
	})
	t.Run("garbage token 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer not.a.jwt")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 401 {
			t.Errorf("got %d, want 401", rec.Code)
		}
	})
	t.Run("token signed with wrong secret 401", func(t *testing.T) {
		bad, _ := IssueUserToken("attacker-secret-0123456789abcdef", "user-abc", time.Hour)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+bad)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 401 {
			t.Errorf("got %d, want 401", rec.Code)
		}
	})
}

func TestAdminAuthPropagatesRole(t *testing.T) {
	tok, _ := IssueAdminToken(testSecret, "admin-1", "moderator", time.Hour)
	var gotID, gotRole string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID, gotRole = AdminID(r), AdminRole(r)
		w.WriteHeader(200)
	})
	h := AdminAuth(testSecret)(inner)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("got %d, want 200", rec.Code)
	}
	if gotID != "admin-1" || gotRole != "moderator" {
		t.Errorf("id=%q role=%q, want admin-1/moderator", gotID, gotRole)
	}
}

// TestAdminAuthWithRequireRoleChain exercises the real end-to-end guard: a JWT
// flows through AdminAuth, its role lands in context, and RequireRole enforces
// it — a moderator is blocked from a superadmin-only route while a superadmin
// passes.
func TestAdminAuthWithRequireRoleChain(t *testing.T) {
	h := AdminAuth(testSecret)(RequireRole()(okHandler())) // no args -> superadmin only

	modTok, _ := IssueAdminToken(testSecret, "a1", "moderator", time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+modTok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Errorf("moderator on superadmin-only route: got %d, want 403", rec.Code)
	}

	superTok, _ := IssueAdminToken(testSecret, "a2", "superadmin", time.Hour)
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("Authorization", "Bearer "+superTok)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Errorf("superadmin on superadmin-only route: got %d, want 200", rec2.Code)
	}
}
