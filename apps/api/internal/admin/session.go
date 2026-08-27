package admin

import (
	"context"
	"net/http"
	"time"

	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// activityWriteInterval — Admin.LastActivityAt qanchalik tez-tez yozilishi.
//
// Har so'rovda yozish panelning har bir ro'yxat/statistika chaqiruvini
// qo'shimcha yozuvga aylantirardi. Oyna 3 kunlik bo'lgani uchun daqiqalik
// aniqlik ortig'i bilan yetadi.
const activityWriteInterval = time.Minute

type sessionAdmin struct {
	Role           string    `bson:"role"`
	IsActive       bool      `bson:"isActive"`
	TokenVersion   int       `bson:"tokenVersion"`
	LastActivityAt time.Time `bson:"lastActivityAt"`
}

// RequireActiveAdmin validates the mutable part of an admin session against
// Mongo on every privileged request. JWT signatures alone cannot notice that
// an account was disabled, logged out, had its password reset, or was demoted.
//
// Shu yerda "foydalanilmasa chiqarish" oynasi ham yuritiladi: har bir
// himoyalangan so'rov oynani boshidan boshlaydi (touchActivity), oyna
// yopilgan bo'lsa esa hisobning barcha sessiyalari — veb ham, mobil ham —
// bekor qilinadi.
func (h *Handler) RequireActiveAdmin() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			oid, err := primitive.ObjectIDFromHex(httpx.AdminID(r))
			if err != nil {
				httpx.Err(w, httpx.NewError(http.StatusUnauthorized, "bad_token", "invalid admin session"))
				return
			}
			var a sessionAdmin
			err = h.Admins.FindOne(r.Context(), bson.M{"_id": oid}, options.FindOne().SetProjection(bson.M{
				"role": 1, "isActive": 1, "tokenVersion": 1, "lastActivityAt": 1,
			})).Decode(&a)
			if err != nil || !a.IsActive || a.TokenVersion != httpx.AdminTokenVersion(r) {
				httpx.Err(w, httpx.NewError(http.StatusUnauthorized, "session_revoked", "admin session revoked"))
				return
			}

			// Zaxira tekshiruv. Amalda access token qisqa umr ko'rgani uchun
			// bu yerga oyna yopilganidan keyin kelib bo'lmaydi — refresh
			// undan ancha oldin rad etadi. Lekin JWT_ADMIN_TTL_MIN
			// ko'tarilsa, qoida faqat shu tekshiruv tufayli kuchda qoladi.
			now := time.Now()
			if h.isIdle(a.LastActivityAt, now) {
				h.revokeSessions(r.Context(), oid)
				httpx.Err(w, httpx.NewError(http.StatusUnauthorized, "session_idle_expired",
					"session closed after inactivity, sign in again"))
				return
			}
			h.touchActivity(r.Context(), oid, a.LastActivityAt, now)

			ctx := httpx.WithAdminRole(r.Context(), a.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isIdle — hisob AdminIdleTTL davomida umuman ishlatilmaganmi.
//
// Nol qiymat "cheksiz eski" EMAS: bu maydon shu funksiya bilan birga
// qo'shildi, ya'ni undan oldin ochilgan har bir sessiyada u bo'sh. Bo'shni
// eskirgan deb hisoblash deploy paytida hamma adminni chiqarib yuborardi.
// O'rniga birinchi so'rovning o'zi hisobni "hozir faol" deb yozib qo'yadi.
func (h *Handler) isIdle(last, now time.Time) bool {
	if last.IsZero() {
		return false
	}
	return now.Sub(last) > h.Cfg.AdminIdleTTL
}

// touchActivity — oynani boshidan boshlaydi. Yozuv activityWriteInterval dan
// tez-tez takrorlanmaydi.
func (h *Handler) touchActivity(ctx context.Context, id primitive.ObjectID, last, now time.Time) {
	if !last.IsZero() && now.Sub(last) < activityWriteInterval {
		return
	}
	_, _ = h.Admins.UpdateOne(ctx, bson.M{"_id": id},
		bson.M{"$set": bson.M{"lastActivityAt": now}})
}
