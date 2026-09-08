package user

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/auth"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
	"github.com/ishchibormi/backend/internal/upload"
	"github.com/ishchibormi/backend/pkg/httpx"
	"github.com/ishchibormi/backend/pkg/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Handler struct {
	Users         *mongo.Collection
	Storage       *storage.Service
	AvatarUploads *mongo.Collection

	// Ixtiyoriy kontent tekshiruvi (AttachModerator orqali).
	guard *moderation.Guard
}

func NewHandler(db *mongo.Database, s *storage.Service) *Handler {
	return &Handler{Users: db.Collection("users"), Storage: s, AvatarUploads: db.Collection("avatar_uploads")}
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

// AttachModerator ixtiyoriy kontent tekshiruvini ulaydi. Guard o'chiq bo'lsa
// profilni saqlash oqimi bir zarracha o'zgarmaydi.
func (h *Handler) AttachModerator(g *moderation.Guard) { h.guard = g }

// profileReasonPrefix — rad etish sababining boshlanishi.
const profileReasonPrefix = "Profil saqlanmadi"

// moderateProfile — profilning ERKIN MATNLI maydonlarini tekshiradi.
//
// Faqat shu so'rovda O'ZGARTIRILAYOTGAN maydonlar tekshiriladi: bular
// ko'rsatkich (*string) bo'lgani uchun nil = "tegilmadi". Ya'ni faqat
// mintaqasini o'zgartirgan foydalanuvchi uchun tashqi chaqiruv bo'lmaydi.
//
// Region/District tekshirilmaydi — ular oldindan belgilangan ro'yxatdan
// tanlanadi, erkin matn emas. Avatar rasmi ham bu yerda tekshirilmaydi:
// u /api/uploads orqali yuklanadi va o'sha yerda ushlanishi kerak.
func (h *Handler) moderateProfile(ctx context.Context, uid primitive.ObjectID, req updateMeReq) (bool, error) {
	if !h.guard.On() {
		return false, nil
	}
	parts := make([]string, 0, 4)
	if req.FirstName != nil {
		parts = append(parts, *req.FirstName)
	}
	if req.LastName != nil {
		parts = append(parts, *req.LastName)
	}
	if req.Bio != nil {
		parts = append(parts, *req.Bio)
	}
	if req.Skills != nil {
		parts = append(parts, strings.Join(req.Skills, ", "))
	}
	out, err := h.guard.CheckText(ctx, uid, "profile", profileReasonPrefix, parts...)
	return out == moderation.OutcomeSkipped, err
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	uid, _ := primitive.ObjectIDFromHex(httpx.UserID(r))
	var req updateMeReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	// Avatars must be objects uploaded into this user's server-generated
	// namespace. Merely allowing arbitrary http(s) URLs would enable tracking
	// pixels and cross-user object references. Empty intentionally clears it.
	if req.AvatarURL != nil {
		avatar := strings.TrimSpace(*req.AvatarURL)
		if avatar != "" && (h.Storage == nil || !h.Storage.URLBelongsToUser(avatar, httpx.UserID(r))) {
			httpx.Err(w, httpx.NewError(400, "bad_avatar_url", "avatar must be uploaded by this account"))
			return
		}
		*req.AvatarURL = avatar
	}
	if err := validateProfileFields(req); err != nil {
		httpx.Err(w, err)
		return
	}
	// Kontent moderatsiyasi — arzon validatsiyalardan KEYIN, bazaga
	// yozishdan va eski avatarni o'chirishdan OLDIN: rad etilgan so'rov
	// hech qanday iz qoldirmasin.
	modSkipped, err := h.moderateProfile(r.Context(), uid, req)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	// Read the current avatar before changing it. The conditional write below
	// rejects a concurrent administrator deletion or a different replacement.
	var prev models.User
	var avatarMeta *models.AvatarMetadata
	if req.AvatarURL != nil {
		if err := h.Users.FindOne(r.Context(), bson.M{"_id": uid}).Decode(&prev); err != nil {
			httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
			return
		}
		if *req.AvatarURL != "" {
			if *req.AvatarURL != prev.AvatarURL && !strings.HasPrefix(h.Storage.KeyFromURL(*req.AvatarURL), "avatars/"+uid.Hex()+"/") {
				httpx.Err(w, httpx.NewError(400, "bad_avatar_url", "profil rasmi avatar sifatida yuklanishi kerak"))
				return
			}
			avatarMeta = &models.AvatarMetadata{URL: *req.AvatarURL, ModerationStatus: "unknown"}
			if prev.AvatarMetadata != nil && prev.AvatarMetadata.URL == *req.AvatarURL {
				avatarMeta = prev.AvatarMetadata
			}
			if h.AvatarUploads != nil {
				var record models.AvatarUpload
				err := h.AvatarUploads.FindOne(r.Context(), bson.M{"_id": *req.AvatarURL}).Decode(&record)
				if err == nil {
					if record.UserID != uid || record.DeletedAt != nil {
						httpx.Err(w, httpx.NewError(400, "bad_avatar_url", "rasm o'chirilgan yoki hisobga tegishli emas"))
						return
					}
					if prev.AvatarMetadata == nil || prev.AvatarURL != *req.AvatarURL {
						avatarMeta = &record.Metadata
					}
				} else if err != mongo.ErrNoDocuments {
					httpx.Err(w, httpx.NewError(503, "avatar_unavailable", "rasm ma'lumotlarini tekshirib bo'lmadi"))
					return
				}
			}
		}
	}
	// AI kvotasi tugagan paytda saqlangan profil — keyin qo'lda ko'riladi.
	// Foydalanuvchi buni bilmaydi (models.User.ModerationPending json:"-").
	set := bson.M{"updatedAt": time.Now(), "moderationPending": modSkipped}
	if req.FirstName != nil {
		set["firstName"] = strings.TrimSpace(*req.FirstName)
	}
	if req.LastName != nil {
		set["lastName"] = strings.TrimSpace(*req.LastName)
	}
	if req.AvatarURL != nil {
		set["avatarUrl"] = *req.AvatarURL
		set["avatarMetadata"] = avatarMeta
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
	filter := bson.M{"_id": uid}
	update := bson.M{"$set": set}
	if req.AvatarURL != nil {
		filter = avatarWriteFilter(uid, prev, *req.AvatarURL)
		update["$inc"] = bson.M{"avatarRevision": 1}
		if *req.AvatarURL != "" && *req.AvatarURL != prev.AvatarURL {
			update["$unset"] = bson.M{"avatarDeletedAt": "", "avatarDeletedBy": "", "avatarDeletedReason": ""}
		}
	}
	res := h.Users.FindOneAndUpdate(r.Context(),
		filter,
		update,
		options.FindOneAndUpdate().SetReturnDocument(options.After))
	var u models.User
	if err := res.Decode(&u); err != nil {
		if req.AvatarURL != nil && err == mongo.ErrNoDocuments {
			httpx.Err(w, httpx.NewError(409, "avatar_changed", "profil rasmi o'zgargan, qayta urinib ko'ring"))
			return
		}
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	if req.AvatarURL != nil && prev.AvatarURL != "" && prev.AvatarURL != *req.AvatarURL {
		go upload.DeleteByURL(h.Storage, prev.AvatarURL)
	}
	httpx.JSON(w, 200, u)
}

// The revision closes the window between metadata validation and the final
// write: completed deletion jobs may disappear, but that old snapshot remains
// invalid even if the current avatar is still empty.
func avatarWriteFilter(uid primitive.ObjectID, prev models.User, target string) bson.M {
	filter := bson.M{"_id": uid, "avatarRevision": prev.AvatarRevision}
	if prev.AvatarRevision == 0 {
		filter["avatarRevision"] = bson.M{"$in": []any{nil, int64(0)}}
	}
	if prev.AvatarURL == "" {
		filter["$or"] = []bson.M{{"avatarUrl": ""}, {"avatarUrl": nil}}
	} else {
		filter["avatarUrl"] = prev.AvatarURL
	}
	if target != "" {
		filter["avatarDeletionJobs.url"] = bson.M{"$ne": target}
	}
	return filter
}

func validateProfileFields(req updateMeReq) error {
	tooLong := func(v *string, max int) bool { return v != nil && len([]rune(strings.TrimSpace(*v))) > max }
	if tooLong(req.FirstName, 80) || tooLong(req.LastName, 80) {
		return httpx.NewError(400, "too_long", "name is too long")
	}
	if tooLong(req.Region, 100) || tooLong(req.District, 100) || tooLong(req.Bio, 1000) {
		return httpx.NewError(400, "too_long", "profile field is too long")
	}
	if len(req.Skills) > 30 {
		return httpx.NewError(400, "too_many_skills", "too many skills")
	}
	for _, skill := range req.Skills {
		if len([]rune(strings.TrimSpace(skill))) > 80 {
			return httpx.NewError(400, "too_long", "skill is too long")
		}
	}
	if req.LangPref != nil && *req.LangPref != "latin" && *req.LangPref != "cyrillic" {
		return httpx.NewError(400, "bad_language", "invalid language preference")
	}
	if req.ThemePref != nil && *req.ThemePref != "light" && *req.ThemePref != "dark" {
		return httpx.NewError(400, "bad_theme", "invalid theme preference")
	}
	return nil
}

func (h *Handler) GetPublic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad user id"))
		return
	}
	var u models.User
	if err := h.Users.FindOne(r.Context(), bson.M{
		"_id": oid, "isDeleted": bson.M{"$ne": true}, "isBlocked": bson.M{"$ne": true},
	}).Decode(&u); err != nil {
		httpx.Err(w, httpx.NewError(404, "not_found", "user not found"))
		return
	}
	httpx.JSON(w, 200, u.Public())
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 200 {
		httpx.Err(w, httpx.NewError(400, "query_too_long", "search query is too long"))
		return
	}
	// Google Play demo hisobi ommaviy qidiruvda ko'rinmaydi — real
	// foydalanuvchi uni topib, bog'lanishga urinmasligi kerak.
	filter := bson.M{
		"isDeleted":       bson.M{"$ne": true},
		"isBlocked":       bson.M{"$ne": true},
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
