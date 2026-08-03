package httpx

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func IssueUserToken(secret, userID string, ttl time.Duration) (string, error) {
	c := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return t.SignedString([]byte(secret))
}

func IssueAdminToken(secret, adminID, role string, ttl time.Duration) (string, error) {
	c := AdminClaims{
		AdminID: adminID,
		Role:    role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return t.SignedString([]byte(secret))
}

func ParseUserToken(secret, tok string) (string, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(tok, c,
		func(*jwt.Token) (any, error) { return []byte(secret), nil },
		jwt.WithValidMethods(allowedJWTMethods))
	if err != nil {
		return "", err
	}
	if c.UserID == "" {
		return "", jwt.ErrTokenInvalidClaims
	}
	return c.UserID, nil
}
