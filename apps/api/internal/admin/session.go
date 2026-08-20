package admin

import (
	"net/http"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type sessionAdmin struct {
	Role         string `bson:"role"`
	IsActive     bool   `bson:"isActive"`
	TokenVersion int    `bson:"tokenVersion"`
}

// RequireActiveAdmin validates the mutable part of an admin session against
// Mongo on every privileged request. JWT signatures alone cannot notice that
// an account was disabled, logged out, had its password reset, or was demoted.
func RequireActiveAdmin(admins *mongo.Collection) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			oid, err := primitive.ObjectIDFromHex(httpx.AdminID(r))
			if err != nil {
				httpx.Err(w, httpx.NewError(http.StatusUnauthorized, "bad_token", "invalid admin session"))
				return
			}
			var a sessionAdmin
			err = admins.FindOne(r.Context(), bson.M{"_id": oid}, options.FindOne().SetProjection(bson.M{
				"role": 1, "isActive": 1, "tokenVersion": 1,
			})).Decode(&a)
			if err != nil || !a.IsActive || a.TokenVersion != httpx.AdminTokenVersion(r) {
				httpx.Err(w, httpx.NewError(http.StatusUnauthorized, "session_revoked", "admin session revoked"))
				return
			}
			ctx := httpx.WithAdminRole(r.Context(), a.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
