package admin

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

/*
Kadr hisoblari — Figma "3.9 · Adminlar" ekranining serverdagi tomoni.

# NEGA BU YERDA CHEGARALAR QATTIQ

Bu to'plamdagi har bir yozuv PANEL KALITINI tarqatadi: yangi admin —
yangi kirish nuqtasi, rol o'zgarishi — yangi ruxsatlar, parol tiklash —
begona hisobga kirish imkoni. Shuning uchun bu fayldagi tekshiruvlar
klientga ishonmaydi va har biri alohida test bilan qoplangan
(admins_validate_test.go).
*/

const (
	// Username otpauth URI ichiga tushadi (totp.URI) va audit jurnalida
	// ko'rinadi. Shu bois ASCII bilan cheklangan: bo'shliq, `?`, `&` yoki
	// ko'rinmas Unicode belgisi URI'ni buzardi va jurnalni chalg'itardi.
	adminUserMin = 3
	adminUserMax = 32
	adminNameMax = 100
	// Parolning yuqori chegarasi 72 BAYT — bu bcrypt'ning o'z chegarasi.
	// Undan uzun parolning oxiri jimgina tashlab yuboriladi, ya'ni admin
	// "128 belgilik parol qo'ydim" deb o'ylab, aslida 72 baytlik parol
	// bilan qolardi. Yolg'on xavfsizlik hissi berishdan ko'ra rad etgan
	// ma'qul.
	adminPassMin = 12
	adminPassMax = 72
	// Ro'yxatda sahifalash yo'q (Figma 3.9a). "Yo'q" degani "cheksiz"
	// degani emas: to'plam kutilmaganda o'sib ketsa ham javob va panel
	// jadvali chegarada qoladi.
	adminListMax = 500
)

// Username: kichik lotin harflari, raqamlar va `. _ -`. Chekkalarida
// ajratgich turolmaydi — "@.aziza." kabi ismlar jurnalda ham, oynalarda
// ham o'qib bo'lmas ko'rinadi.
var adminUsernameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$`)

// adminUsername normalizes and validates a login name.
func adminUsername(raw string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(raw))
	if len(u) < adminUserMin || len(u) > adminUserMax || !adminUsernameRe.MatchString(u) {
		return "", httpx.NewError(400, "bad_username",
			"username must be 3-32 chars of a-z, 0-9, dot, underscore or hyphen")
	}
	return u, nil
}

// adminName trims the display name and bounds it by RUNE count (an Uzbek
// or Cyrillic name is multi-byte; a byte limit would reject a legal name).
func adminName(raw string) (string, error) {
	n := strings.TrimSpace(raw)
	if len([]rune(n)) > adminNameMax {
		return "", httpx.NewError(400, "name_too_long", "name is too long")
	}
	return n, nil
}

// adminPassword bounds a new password. Length is counted in BYTES on
// purpose: bcrypt's limit is a byte limit, not a character limit.
func adminPassword(raw string) (string, error) {
	if len(raw) < adminPassMin || len(raw) > adminPassMax {
		return "", httpx.NewError(400, "weak_password", "password must be 12-72 bytes")
	}
	return raw, nil
}

// ListAdmins returns all staff accounts (password hashes and TOTP secrets
// are never serialized — see models.Admin).
func (h *Handler) ListAdmins(w http.ResponseWriter, r *http.Request) {
	cur, err := h.Admins.Find(r.Context(), bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}).SetLimit(adminListMax))
	if err != nil {
		httpx.Err(w, err)
		return
	}
	defer cur.Close(r.Context())
	out := []models.Admin{}
	for cur.Next(r.Context()) {
		var a models.Admin
		if err := cur.Decode(&a); err == nil {
			out = append(out, a)
		}
	}
	httpx.JSON(w, 200, out)
}

type createAdminReq struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *Handler) CreateAdmin(w http.ResponseWriter, r *http.Request) {
	var req createAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	username, err := adminUsername(req.Username)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	name, err := adminName(req.Name)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if _, err := adminPassword(req.Password); err != nil {
		httpx.Err(w, err)
		return
	}
	if !validRoles[req.Role] {
		httpx.Err(w, httpx.NewError(400, "bad_role", "role must be superadmin, moderator or support"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	a := models.Admin{
		Username: username, Name: name, PasswordHash: string(hash),
		Role: req.Role, IsActive: true, CreatedAt: time.Now(),
	}
	res, err := h.Admins.InsertOne(r.Context(), a)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			httpx.Err(w, httpx.NewError(409, "duplicate", "username already exists"))
			return
		}
		httpx.Err(w, err)
		return
	}
	a.ID = res.InsertedID.(primitive.ObjectID)
	h.audit(r, "admin_create", a.ID.Hex(), username+"/"+req.Role)
	httpx.JSON(w, 201, a)
}

type updateAdminReq struct {
	Role             string  `json:"role"`
	Name             *string `json:"name"`
	IsActive         *bool   `json:"isActive"`
	Password         string  `json:"password"`
	DisableTwoFactor bool    `json:"disableTwoFactor"` // superadmin resets a locked-out admin
}

// UpdateAdmin changes another admin's role/active state, renames them, resets
// their password or clears their second factor.
//
// # NEGA AVVAL O'QIYMIZ
//
// Har bir yozuv `tokenVersion` ni oshirishi mumkin, bu esa o'sha adminning
// BARCHA sessiyalarini o'ldiradi. Klient oynadagi hamma maydonni birga
// yuboradi (Figma 3.9a · D), shuning uchun "faqat ismni to'g'irladim" ham
// rol va holatni qayta yozardi — va begona adminni ish o'rtasida paneldan
// chiqarib yuborardi. Joriy hujjatni o'qib, HAQIQATAN o'zgargan maydonni
// ajratamiz: sessiya faqat kuchsizlantiruvchi o'zgarishda uziladi.
func (h *Handler) UpdateAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	var req updateAdminReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Err(w, err)
		return
	}
	var cur models.Admin
	if err := h.Admins.FindOne(r.Context(), bson.M{"_id": id}).Decode(&cur); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			httpx.Err(w, httpx.NewError(404, "not_found", "admin not found"))
			return
		}
		httpx.Err(w, err)
		return
	}

	self := httpx.AdminID(r) == id.Hex()
	set := bson.M{}
	unset := bson.M{}
	// `revokeSessions` faqat hisobni KUCHSIZLANTIRADIGAN o'zgarishda
	// yoqiladi: rol, faollik, parol, 2FA. Ism — ko'rinish, ruxsat emas.
	revokeSessions := false
	var ozgargan []string

	if req.Role != "" && req.Role != cur.Role {
		if !validRoles[req.Role] {
			httpx.Err(w, httpx.NewError(400, "bad_role", "invalid role"))
			return
		}
		if self {
			// O'z rolini pasaytirish — panelni superadminsiz qoldirishning
			// eng oson yo'li. `req.Role != cur.Role` sharti tufayli bu yerga
			// faqat HAQIQIY o'zgarish yetib keladi, ya'ni superadmin o'ziga
			// "superadmin" yozib yuborsa xato chiqmaydi.
			httpx.Err(w, httpx.NewError(400, "self_role", "cannot change your own role"))
			return
		}
		set["role"] = req.Role
		revokeSessions = true
		ozgargan = append(ozgargan, "role="+req.Role)
	}
	if req.Name != nil {
		name, err := adminName(*req.Name)
		if err != nil {
			httpx.Err(w, err)
			return
		}
		if name != cur.Name {
			set["name"] = name
			ozgargan = append(ozgargan, "name")
		}
	}
	if req.IsActive != nil && *req.IsActive != cur.IsActive {
		if self {
			httpx.Err(w, httpx.NewError(400, "self_lockout", "cannot deactivate your own account"))
			return
		}
		set["isActive"] = *req.IsActive
		revokeSessions = true
		ozgargan = append(ozgargan, "active="+activeLabel(*req.IsActive))
	}
	if req.Password != "" {
		if _, err := adminPassword(req.Password); err != nil {
			httpx.Err(w, err)
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			httpx.Err(w, err)
			return
		}
		set["passwordHash"] = string(hash)
		revokeSessions = true
		// Parolning O'ZI jurnalga hech qachon tushmaydi — faqat fakti.
		ozgargan = append(ozgargan, "password")
	}
	if req.DisableTwoFactor {
		// # NEGA O'ZINGIZGA MUMKIN EMAS
		//
		// `POST /2fa/disable` tirik TOTP kodini so'raydi. Agar shu yerda
		// o'z hisobiga ham ruxsat bersak, o'g'irlangan sessiya (ochiq
		// qolgan noutbuk, XSS) ikkinchi omilni kodsiz yechib tashlardi —
		// ya'ni bu endpoint o'sha tekshiruvni chetlab o'tuvchi eshik
		// bo'lardi. Boshqa admin uchun esa bu ataylab qilingan amal:
		// telefonini yo'qotgan adminni superadmin qaytaradi.
		if self {
			httpx.Err(w, httpx.NewError(400, "self_2fa",
				"disable your own 2FA from the security page with a live code"))
			return
		}
		if cur.TOTPEnabled || cur.TOTPSecret != "" {
			set["totpEnabled"] = false
			unset["totpSecret"] = ""
			unset["totpLastCounter"] = ""
			revokeSessions = true
			ozgargan = append(ozgargan, "2fa-reset")
		}
	}

	if len(set) == 0 && len(unset) == 0 {
		httpx.Err(w, httpx.NewError(400, "no_changes", "nothing to update"))
		return
	}
	update := bson.M{}
	if len(set) > 0 {
		update["$set"] = set
	}
	if len(unset) > 0 {
		update["$unset"] = unset
	}
	if revokeSessions {
		update["$inc"] = bson.M{"tokenVersion": 1}
	}
	res, err := h.Admins.UpdateOne(r.Context(), bson.M{"_id": id}, update)
	if err != nil {
		httpx.Err(w, err)
		return
	}
	if res.MatchedCount == 0 {
		// O'qish bilan yozish orasida hisob o'chirilgan — jadval eskirgan.
		httpx.Err(w, httpx.NewError(404, "not_found", "admin not found"))
		return
	}
	if revokeSessions {
		// Parol almashdi yoki 2FA o'chirildi — bu hisobning saqlangan refresh
		// sessiyalari (veb va mobil) endi kuchsiz; ularni darhol o'chiramiz.
		h.revokeSessions(r.Context(), id)
	}
	h.audit(r, "admin_update", id.Hex(), cur.Username+": "+strings.Join(ozgargan, ", "))
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// DeleteAdmin removes a staff account. An admin cannot delete themselves.
func (h *Handler) DeleteAdmin(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Err(w, httpx.NewError(400, "bad_id", "bad id"))
		return
	}
	if httpx.AdminID(r) == id.Hex() {
		httpx.Err(w, httpx.NewError(400, "self_delete", "cannot delete your own account"))
		return
	}
	// `FindOneAndDelete` — o'chirilgan hisobning username'i jurnalga tushsin:
	// keyinchalik "kim o'chirilgan edi?" degan savolga ObjectID javob
	// bermaydi, chunki hujjatning o'zi qolmaydi.
	var eski models.Admin
	if err := h.Admins.FindOneAndDelete(r.Context(), bson.M{"_id": id}).Decode(&eski); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			httpx.Err(w, httpx.NewError(404, "not_found", "admin not found"))
			return
		}
		httpx.Err(w, err)
		return
	}
	// Hisob yo'q bo'ldi — uning sessiya hujjatlari ham qolmasin.
	h.revokeSessions(r.Context(), id)
	h.audit(r, "admin_delete", id.Hex(), eski.Username+"/"+eski.Role)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
