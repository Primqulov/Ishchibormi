package user

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/auth"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Users   *mongo.Collection
	Storage *storage.Service
}

func NewHandler(db *mongo.Database, s *storage.Service) *Handler {
	return &Handler{Users: db.Collection("users"), Storage: s}
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r)
	u, err := auth.LoadUser(r.Context(), h.Users, uid)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, u)
}

type updateMeReq struct {
	FirstName *string  `json:"firstName"`
	LastName  *string  `json:"lastName"`
	AvatarURL *string  `json:"avatarUrl"`
	Region    *string  `json:"region"`
	District  *string  `json:"district"`
	Bio       *string  `json:"bio"`
	Skills    []string `json:"skills"`
	LangPref  *string  `json:"langPref"`
	ThemePref *string  `json:"themePref"`
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req updateMeReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	// avatarUrl is rendered on other users' browsers — reject non-http(s) values
	// so a javascript:/data: payload can't be stored.
	if req.AvatarURL != nil && !httpx.IsSafeHTTPURL(*req.AvatarURL) {
		httpx.Err(w, httpx.NewError(400, "bad_avatar_url", "avatar url must be http(s)"))
		return
	}
	// If avatar is changing, delete the previous file from S3 (best-effort).
	if req.AvatarURL != nil {
		var prev models.User
		if err := h.Users.FindOne(r.Context(), bson.M{"_id": uid}).Decode(&prev); err == nil {
			if prev.AvatarURL != "" && prev.AvatarURL != *req.AvatarURL {
				go upload.DeleteByURL(h.Storage, prev.AvatarURL)
			}
		}
	}
	set := bson.M{"updatedAt": time.Now()}
	if req.FirstName != nil {
		set["firstName"] = strings.TrimSpace(*req.FirstName)
	}
	if req.LastName != nil {
		set["lastName"] = strings.TrimSpace(*req.LastName)
	}
	if req.AvatarURL != nil {
		set["avatarUrl"] = *req.AvatarURL
	}
	if req.Region != nil {
		set["region"] = *req.Region
	}
	if req.District != nil {
		set["district"] = *req.District
	}
	if req.Bio != nil {
		set["bio"] = *req.Bio
	}
	if req.Skills != nil {
		set["skills"] = req.Skills
	}
	if req.LangPref != nil {
		set["langPref"] = *req.LangPref
	}
	if req.ThemePref != nil {
		set["themePref"] = *req.ThemePref
	}
	// Mark onboarding completed once name + region are present.
	if (req.FirstName != nil && *req.FirstName != "") && (req.Region != nil && *req.Region != "") {
		set["onboardingCompleted"] = true
	}
	res := h.Users.FindOneAndUpdate(r.Context(),
		bson.M{"_id": uid},
		bson.M{"$set": set},
		options.FindOneAndUpdate().SetReturnDocument(options.After))
	var u models.User
	if err := res.Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	httpx.JSON(w, 200, u)
}

func (h *Handler) GetPublic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad user id"))
		return
	}
	var u models.User
	if err := h.Users.FindOne(r.Context(), bson.M{"_id": oid, "isDeleted": bson.M{"$ne": true}}).Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	httpx.JSON(w, 200, u.Public())
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	// Google Play demo hisobi ommaviy qidiruvda ko'rinmaydi — real
	// foydalanuvchi uni topib, bog'lanishga urinmasligi kerak.
	filter := bson.M{
		"isDeleted":       bson.M{"$ne": true},
		"isReviewAccount": bson.M{"$ne": true},
	}
	if q != "" {
		rx := primitive.Regex{Pattern: regexpEscape(q), Options: "i"}
		filter["$or"] = []bson.M{
			{"firstName": rx},
			{"lastName": rx},
			{"skills": rx},
			{"region": rx},
		}
	}
	cur, err := h.Users.Find(r.Context(), filter, options.Find().SetLimit(50))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.PublicUser{}
	for cur.Next(r.Context()) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			out = append(out, u.Public())
		}
	}
	httpx.JSON(w, 200, out)
}

func (h *Handler) Block(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	tid, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if uid == tid {
		httpx.Err(w, httpx.NewError(400, "self_block", "cannot block yourself"))
		return
	}
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": uid}, bson.M{"$addToSet": bson.M{"blockedUserIds": tid}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (h *Handler) Unblock(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	tid, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	_, err = h.Users.UpdateOne(r.Context(), bson.M{"_id": uid}, bson.M{"$pull": bson.M{"blockedUserIds": tid}})
	if err != nil {
		httpx.Err(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// regexpEscape: minimal escape so user input cannot inject regex metacharacters.
func regexpEscape(s string) string {
	r := strings.NewReplacer(
		".", `\.`, "*", `\*`, "+", `\+`, "?", `\?`, "(", `\(`,
		")", `\)`, "[", `\[`, "]", `\]`, "{", `\{`, "}", `\}`,
		"|", `\|`, "^", `\^`, "$", `\$`, `\`, `\\`,
	)
	return r.Replace(s)
}

// FindByIDs loads users by hex IDs.
func FindByIDs(ctx context.Context, col *mongo.Collection, ids []primitive.ObjectID) (map[primitive.ObjectID]models.User, error) {
	out := map[primitive.ObjectID]models.User{}
	if len(ids) == 0 {
		return out, nil
	}
	cur, err := col.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var u models.User
		if err := cur.Decode(&u); err == nil {
			out[u.ID] = u
		}
	}
	return out, nil
}
