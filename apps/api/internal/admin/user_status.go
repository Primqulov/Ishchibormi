package admin

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/internal/moderation"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

/*
Hisob HOLATI tarixi — Figma "3.4 · Foydalanuvchi — batafsil sahifa"
dagi «Holatlar tarixi» bloki uchun.

# NEGA AUDIT LOGNING O'ZI YETMAYDI

`/admin/audit` butun panel bo'yicha barcha amallarni beradi va u boshqa
savolga javob beradi: "adminlar nima qildi?". Bu blok esa BITTA hisobning
o'z tarixi: qachon ro'yxatdan o'tgan, qachon tasdiqlangan, necha marta
bloklangan va nega. Admin bu sahifaga e'tirozni ko'rib chiqish uchun
kiradi va javobni audit logdan filtr terib qidirmasligi kerak.

# NEGA BU YERDA YIG'ILADI, ALOHIDA KOLLEKSIYA EMAS

Tarix uchun yangi jadval qo'shsak, u BIR PAYTDA ikki joyga yozilishi
kerak bo'lardi (audit + tarix) va ular ertaga bir-biridan farq qilib
qolardi. Manba bitta bo'lgani ma'qul: bu yerda mavjud yozuvlar —
`admin_audit`, `moderation_strikes` va hisobning o'z maydonlari — bitta
vaqt chizig'iga birlashtiriladi. Hech qanday yangi haqiqat o'ylab
chiqarilmaydi: sanasi yo'q hodisa tarixda ham yo'q.

# NIMA ATAYLAB YO'Q

Profil tahrirlari, kirishlar, e'lon/ariza harakatlari bu ro'yxatga
KIRMAYDI — faqat HISOB HOLATI o'zgarishi. Aks holda blok tarixi
o'ntalab "profilni yangiladi" yozuvlari ostida ko'rinmay ketardi.
Telefon raqamining SMS bilan avtomatik tasdiqlanishi ham yo'q: bazada
uning vaqti saqlanmaydi, taxminiy sana yozish esa e'tirozni ko'rayotgan
admin uchun yolg'on dalil bo'lardi.
*/

// Holat o'zgarishi turlari. Panel har birini o'z nishoniga aylantiradi
// (apps/web/app/admin/users/[id]/page.tsx · HOLAT_TUR).
const (
	statusKindSignup  = "signup"  // ro'yxatdan o'tdi
	statusKindVerify  = "verify"  // telefoni tasdiqlandi
	statusKindBlock   = "block"   // bloklandi
	statusKindUnblock = "unblock" // blokdan chiqarildi
	statusKindWarn    = "warn"    // moderatsiya ogohlantirishi (blokka olib kelmagan)
	statusKindDelete  = "delete"  // hisob o'chirildi
)

// statusAuditActions — hisob holatini o'zgartiradigan amallar.
//
// Ro'yxat YOPIQ va ataylab qisqa: `user_notify` bu yerda yo'q, chunki
// yuborilgan xabar hisob holatini o'zgartirmaydi va sahifada o'zining
// alohida bloki bor. `export_*`, `broadcast*` esa umuman bitta
// foydalanuvchiga tegishli emas.
var statusAuditActions = bson.A{
	"user_block", "user_unblock", "user_verify", "user_delete", "moderation_ban_lift",
	moderation.AuditActionBan,
}

// maxStatusEvents — javobdagi yozuvlar chegarasi.
//
// Bu tarix sahifasi emas, karta: panel oxirgi 3 tasini ko'rsatadi,
// oynada esa hammasi. Chegara kerak, chunki uzoq yashagan hisobda
// yuzlab yozuv yig'ilishi mumkin va ularning hammasini bitta javobda
// tashish (hamda oynada chizish) behuda.
const maxStatusEvents = 60

// statusEvent — hisob holatining bitta o'zgarishi.
type statusEvent struct {
	// Kind — statusKind* dan biri. Nishon rangi va matni shundan.
	Kind string    `json:"kind"`
	At   time.Time `json:"at"`
	// Detail — inson o'qiy oladigan tafsilot. MA'NOSI turga bog'liq:
	// blokda — sabab matni, ogohlantirishda — buzilish turi kodi
	// (moderation.Kind*), tasdiqlashda bo'sh. Panel har turni o'zicha
	// o'qiydi, shuning uchun bu yerda matnga aylantirilmaydi.
	Detail string `json:"detail,omitempty"`
	// Actor — amalni bajargan adminning username'i (superadmin ko'rsa
	// roli ham). Bo'sh bo'lsa — tizim bajargan (Auto).
	Actor string `json:"actor,omitempty"`
	// Auto — o'zgarishni tizim qildi (avtomatik moderatsiya, ro'yxatdan
	// o'tish). `Actor` bo'sh bo'lishining sababi shu — o'chirilgan admin
	// bilan chalkashmasligi uchun alohida belgi.
	Auto bool `json:"auto,omitempty"`
	// Until — blok qachongacha (faqat muddatli avtomatik blokda).
	Until *time.Time `json:"until,omitempty"`
	// A moderation-only lift does not release a simultaneous manual block.
	moderationOnly bool
}

// statusHistory — hisobning holat o'zgarishlari, yangisidan boshlab.
//
// `showRoles` — natijada admin roli ko'rsatilsinmi (faqat superadmin
// uchun; sababi adminBrief.label izohida).
func (h *Handler) statusHistory(
	ctx context.Context,
	u *models.User,
	rec *moderation.StrikeRecord,
	showRoles bool,
) []statusEvent {
	return h.statusHistoryAt(ctx, u, rec, showRoles, time.Now())
}

func (h *Handler) statusHistoryAt(
	ctx context.Context,
	u *models.User,
	rec *moderation.StrikeRecord,
	showRoles bool,
	now time.Time,
) []statusEvent {
	out := make([]statusEvent, 0, 12)

	// 1) Ro'yxatdan o'tish — tarixning boshlanish nuqtasi. Panel qaysi
	//    klientdan kelganini `user.signupPlatform` dan o'zi chizadi.
	if !u.CreatedAt.IsZero() {
		out = append(out, statusEvent{Kind: statusKindSignup, At: u.CreatedAt, Auto: true})
	}

	// 2) Admin amallari va saqlangan avtomatik bloklar.
	out = append(out, h.statusFromAudit(ctx, u.ID, showRoles)...)

	// 3) Eski serverdan qolgan, hali auditga yozilmagan avtomatik blok.
	//    Faqat ma'lum vaqt va sabab ishlatiladi; tozalangan o'tmish taxmin
	//    qilinmaydi. Yangi audit yozuvi bo'lsa bir blok ikki marta chiqmaydi.
	if u.BlockSource == moderation.BlockSourceModeration && u.BlockedAt != nil &&
		!u.BlockedAt.IsZero() && !hasAutomaticBlock(out, *u.BlockedAt) {
		out = append(out, statusEvent{
			Kind:   statusKindBlock,
			At:     *u.BlockedAt,
			Detail: u.BlockReason,
			Auto:   true,
			Until:  u.ModerationBannedUntil,
		})
	}
	// Muddati o'tgan blok hech qanday login yoki fon vazifasisiz kuchini
	// yo'qotadi. Hodisa vaqti — ko'rish vaqti emas, saqlangan muddatning o'zi.
	// Oldinroq qo'lda ochilgan yoki boshqa blok kuchda qolgan bo'lsa bu
	// muddat umumiy "Blokdan chiqarildi" hodisasini anglatmaydi.
	out = append(out, automaticExpirations(out, u, now)...)

	// 4) Moderatsiya ogohlantirishlari — nomaqbul kontent urinishlari.
	//
	//    Yozuv TELEFON bo'yicha saqlanadi, ya'ni hisob o'chirilib qayta
	//    ochilgan bo'lsa ham qoladi. Bu ataylab shunday (moderation/strikes.go)
	//    va panel buni sahifadagi izohda aytadi — bu yerda ma'lumot
	//    yashirilmaydi, chunki blok sababini aynan shu tushuntiradi.
	if rec != nil {
		for _, ev := range rec.Events {
			out = append(out, statusEvent{
				Kind:   statusKindWarn,
				At:     ev.At,
				Detail: ev.Kind,
				Auto:   true,
			})
		}
	}

	// Yangisidan boshlab. `SliceStable` — bir xil sekundda yozilgan
	// hodisalar (masalan oxirgi ogohlantirish va shu zahoti qo'yilgan blok)
	// har so'rovda o'rin almashib turmasligi kerak.
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	if len(out) > maxStatusEvents {
		out = out[:maxStatusEvents]
	}
	return out
}

func hasAutomaticBlock(history []statusEvent, at time.Time) bool {
	for _, ev := range history {
		if ev.Kind == statusKindBlock && ev.Auto && ev.At.UnixMilli() == at.UnixMilli() {
			return true
		}
	}
	return false
}

func automaticExpirations(history []statusEvent, user *models.User, now time.Time) []statusEvent {
	out := []statusEvent{}
	seen := map[int64]bool{}
	for _, ban := range history {
		if ban.Kind != statusKindBlock || !ban.Auto || ban.Until == nil ||
			!ban.Until.After(ban.At) || ban.Until.After(now) {
			continue
		}
		until := *ban.Until
		if seen[until.UnixMilli()] || automaticBanReleased(history, ban.At, until) ||
			otherBlockActiveAt(history, user, until) {
			continue
		}
		seen[until.UnixMilli()] = true
		out = append(out, statusEvent{
			Kind: statusKindUnblock, At: until, Auto: true,
			Detail: "Blok muddati tugadi — o'z-o'zidan ochildi",
		})
	}
	return out
}

// Both manual unblock actions release an automatic ban. Audit timestamps
// share Mongo's millisecond precision, so an unblock in the same millisecond
// as a ban also suppresses a later automatic expiry.
func automaticBanReleased(history []statusEvent, from, through time.Time) bool {
	for _, ev := range history {
		if ev.Kind == statusKindUnblock && !ev.Auto &&
			!ev.At.Before(from) && !ev.At.After(through) {
			return true
		}
	}
	return false
}

func otherBlockActiveAt(history []statusEvent, user *models.User, at time.Time) bool {
	if user.IsDeleted && (user.DeletedAt == nil || !user.DeletedAt.After(at)) {
		return true
	}
	var manual *statusEvent
	for i := range history {
		ev := &history[i]
		if ev.At.After(at) {
			continue
		}
		if ev.Kind == statusKindBlock && ev.Auto && ev.Until != nil &&
			ev.Until.After(at) && !automaticBanReleased(history, ev.At, at) {
			return true
		}
		if ev.Auto || (ev.Kind != statusKindBlock &&
			(ev.Kind != statusKindUnblock || ev.moderationOnly)) {
			continue
		}
		// Audit rows are newest first; ties retain that order.
		if manual == nil || ev.At.After(manual.At) {
			manual = ev
		}
	}
	if manual != nil && manual.Kind == statusKindBlock {
		return true
	}
	// Old accounts may have a manual flag without a retained audit event.
	// Do not claim such an account opened while its known block remains.
	return user.IsBlocked && (user.BlockSource != moderation.BlockSourceAdmin ||
		user.BlockedAt == nil || !user.BlockedAt.After(at))
}

// statusFromAudit — audit jurnalidagi holat amallari.
func (h *Handler) statusFromAudit(
	ctx context.Context,
	userID primitive.ObjectID,
	showRoles bool,
) []statusEvent {
	out := []statusEvent{}
	if h.AuditCol == nil {
		return out
	}
	// `target` audit yozuvida HEX satr sifatida saqlanadi (Handler.audit),
	// shuning uchun solishtirish ham satr bo'yicha.
	cur, err := h.AuditCol.Find(ctx,
		bson.M{"target": userID.Hex(), "action": bson.M{"$in": statusAuditActions}},
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetLimit(maxStatusEvents),
	)
	if err != nil {
		return out
	}
	defer cur.Close(ctx)

	rows := []models.AdminAudit{}
	adminIDs := map[primitive.ObjectID]bool{}
	for cur.Next(ctx) {
		var a models.AdminAudit
		if cur.Decode(&a) != nil {
			continue
		}
		rows = append(rows, a)
		if !a.AdminID.IsZero() {
			adminIDs[a.AdminID] = true
		}
	}

	briefs := h.adminBriefs(ctx, adminIDs)
	for _, a := range rows {
		kind, detail := statusFromAction(a.Action, a.Detail)
		if kind == "" {
			continue
		}
		out = append(out, statusEvent{
			Kind:           kind,
			At:             a.CreatedAt,
			Detail:         detail,
			Actor:          briefs[a.AdminID].label(showRoles),
			Auto:           a.Action == moderation.AuditActionBan,
			Until:          a.Until,
			moderationOnly: a.Action == "moderation_ban_lift",
		})
	}
	return out
}

// statusFromAction — audit amalini holat turiga va o'qiladigan tafsilotga
// aylantiradi. Tanimagan amal uchun bo'sh tur qaytaradi (yozuv tashlanadi).
//
// Nega tafsilot bu yerda normallashtiriladi: `user_unblock` ning detali
// ("unblock", "unblock (+moderatsiya bloki)") — kod ichidagi texnik belgi,
// admin uchun yozilgan matn emas. Uni panelga xomligicha yuborsak, sahifada
// ingliz tilidagi ichki qiymat chiqib turardi.
func statusFromAction(action, detail string) (kind, out string) {
	switch action {
	case "user_block", moderation.AuditActionBan:
		// Blok sababi — adminning o'zi yozgan matn, tegilmaydi.
		return statusKindBlock, detail
	case "user_unblock":
		if strings.Contains(detail, "moderatsiya") {
			return statusKindUnblock, "Avtomatik moderatsiya bloki ham ochildi"
		}
		return statusKindUnblock, ""
	case "moderation_ban_lift":
		return statusKindUnblock, "Avtomatik moderatsiya bloki bekor qilindi"
	case "user_verify":
		return statusKindVerify, ""
	case "user_delete":
		// Detal allaqachon o'zbekcha va aniq ("hidden — …", "purge — …").
		return statusKindDelete, detail
	}
	return "", ""
}

// adminBrief — amalni bajargan admin haqidagi qisqa ma'lumot.
type adminBrief struct {
	Username string
	Role     string
}

// label — tarixdagi «kim» ustuni: "nodira" yoki "nodira · moderator".
//
// XAVFSIZLIK: rol FAQAT superadminga ko'rsatiladi. Adminlar ro'yxati ham
// faqat superadmin uchun ochiq (cmd/api/main.go dagi RequireRole()), ya'ni
// moderator hamkasblarining vakolat darajasini bilishi shart emas — bu
// ma'lumot "kimni ko'ndirsam blok ochiladi" degan savolga javob beradi.
// Ism esa qoladi: kimning qarori ekani javobgarlikning o'zi, va u audit
// logda moderatorga allaqachon ko'rinadi.
//
// Admin bazadan o'chirilgan bo'lsa bo'sh satr qaytadi — yozuv qoladi,
// muallifi esa endi noma'lum. Panel bunda "Admin (o'chirilgan)" deb
// ko'rsatadi, hodisani "avtomatik" deb ko'rsatmaydi.
func (b adminBrief) label(withRole bool) string {
	if b.Username == "" {
		return ""
	}
	if withRole && b.Role != "" {
		return b.Username + " · " + b.Role
	}
	return b.Username
}

// adminBriefs — id -> username/rol. Bitta so'rov: tarixda bir necha
// admin uchrashi odatiy hol, har biriga alohida so'rov behuda.
//
// Proyeksiya ataylab qisqa: parol xeshi, TOTP siri va sessiya versiyasi
// bu yerga tushmasligi kerak — ular hech qachon javobga chiqmasa ham,
// o'qilmagan maydon oqib ketolmaydi.
func (h *Handler) adminBriefs(ctx context.Context, ids map[primitive.ObjectID]bool) map[primitive.ObjectID]adminBrief {
	out := map[primitive.ObjectID]adminBrief{}
	if len(ids) == 0 || h.Admins == nil {
		return out
	}
	list := make([]primitive.ObjectID, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	cur, err := h.Admins.Find(ctx, bson.M{"_id": bson.M{"$in": list}},
		options.Find().SetProjection(bson.M{"username": 1, "role": 1}))
	if err != nil {
		return out
	}
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		var a models.Admin
		if cur.Decode(&a) == nil {
			out[a.ID] = adminBrief{Username: a.Username, Role: a.Role}
		}
	}
	return out
}
