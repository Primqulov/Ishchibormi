package category

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/elonquery"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type Handler struct {
	Col           *mongo.Collection
	Elons         *mongo.Collection
	Notifications *mongo.Collection
	Admins        *mongo.Collection
}

func NewHandler(db *mongo.Database) *Handler {
	return &Handler{
		Col:           db.Collection("categories"),
		Elons:         db.Collection("elons"),
		Notifications: db.Collection("notifications"),
		Admins:        db.Collection("admins"),
	}
}

// List — faol kategoriyalar, har biri uchun HOZIR feedda ko'rinib turgan
// e'lonlar soni bilan.
//
// Ilgari bu yerda `usageCount` qaytarilardi va ro'yxat ham shu bo'yicha
// saralanardi. `usageCount` — kategoriyada tarixan joylangan barcha e'lonlar
// hisoblagichi: e'lon o'chirilsa, yakunlansa yoki vaqti o'tsa ham kamaymaydi,
// shuning uchun UI'dagi son "kategoriyani ochsam nechta ish ko'raman" degan
// savolga javob bermasdi. Endi sanoq `elons` ustidan feed filtri bilan
// hisoblanadi — foydalanuvchi kategoriyaga kirganda ko'radigan e'lonlar soniga
// aynan teng bo'ladi.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Col.Find(r.Context(), bson.M{"isActive": true})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Category{}
	for cur.Next(r.Context()) {
		var c models.Category
		if err := cur.Decode(&c); err == nil {
			out = append(out, c)
		}
	}

	counts, err := ActiveCounts(r.Context(), h.Elons)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	for i := range out {
		n := counts[out[i].ID]
		out[i].ActiveCount = n
		// Eski klientlar (jumladan chiqarib bo'lingan mobil ilova versiyalari)
		// hali `usageCount` ni ko'rsatadi — ular ham to'g'ri sonni ko'rsin.
		// Tarixiy jami faqat admin endpointida qoladi.
		out[i].UsageCount = n
	}
	// Saralash Mongo'da emas, shu yerda: tartib endi hisoblangan maydonga
	// bog'liq. Ko'p faol e'lonli kategoriya oldinda (dashboard/landing faqat
	// dastlabki 6-8 tasini ko'rsatadi), teng bo'lsa — nom bo'yicha.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].ActiveCount != out[j].ActiveCount {
			return out[i].ActiveCount > out[j].ActiveCount
		}
		return out[i].Name < out[j].Name
	})
	httpx.JSON(w, 200, out)
}

// ActiveCounts — kategoriya ID -> faol e'lonlar soni. Bitta aggregate so'rovi
// (N+1 emas). Xaritada yo'q kategoriya uchun 0 qaytadi. Ommaviy ro'yxat ham,
// admin paneli ham shu funksiyadan foydalanadi — sonlar hech qachon farq
// qilmasligi uchun.
func ActiveCounts(ctx context.Context, elons *mongo.Collection) (map[primitive.ObjectID]int, error) {
	cur, err := elons.Aggregate(ctx, mongo.Pipeline{
		bson.D{{Key: "$match", Value: elonquery.ActiveFilter(time.Now(), false)}},
		bson.D{{Key: "$group", Value: bson.M{"_id": "$categoryId", "n": bson.M{"$sum": 1}}}},
	})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	counts := map[primitive.ObjectID]int{}
	for cur.Next(ctx) {
		var row struct {
			ID primitive.ObjectID `bson:"_id"`
			N  int                `bson:"n"`
		}
		if err := cur.Decode(&row); err == nil {
			counts[row.ID] = row.N
		}
	}
	return counts, cur.Err()
}

type createReq struct {
	Name string `json:"name" validate:"required"`
	Icon string `json:"icon"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req createReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpx.Err(w, httpx.NewError(400, "bad_request", "name required"))
		return
	}
	slug := Slugify(name)
	// idempotent by slug
	existing := models.Category{}
	if err := h.Col.FindOne(r.Context(), bson.M{"slug": slug}).Decode(&existing); err == nil {
		httpx.JSON(w, 200, existing)
		return
	}
	c := models.Category{
		Name:      name,
		Slug:      slug,
		Icon:      req.Icon,
		CreatedBy: uid,
		IsActive:  true,
		CreatedAt: time.Now(),
	}
	res, err := h.Col.InsertOne(r.Context(), c)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	c.ID = res.InsertedID.(primitive.ObjectID)
	// Notify all admins (fire-and-forget, but with its own context).
	go h.notifyAdmins(context.Background(), name)
	httpx.JSON(w, 201, c)
}

func (h *Handler) notifyAdmins(ctx context.Context, name string) {
	cur, err := h.Admins.Find(ctx, bson.M{"isActive": true})
	if err != nil || cur == nil {
		return
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Admin
		if err := cur.Decode(&a); err == nil {
			_, _ = h.Notifications.InsertOne(ctx, models.Notification{
				UserID:    a.ID,
				Type:      "category_added",
				Title:     "Yangi turkum qo'shildi",
				Body:      name,
				IsRead:    false,
				CreatedAt: time.Now(),
			})
		}
	}
}

// Slugify converts an Uzbek name into a URL-safe slug.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var sb strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			sb.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				sb.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(sb.String(), "-")
	if out == "" {
		out = "cat"
	}
	return out
}

// IncrementUsage bumps usageCount when an elon is created.
func IncrementUsage(ctx context.Context, col *mongo.Collection, id primitive.ObjectID) {
	_, _ = col.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$inc": bson.M{"usageCount": 1}})
}
