package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// User -- platform user (both employer and worker)
type User struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TelegramID   int64              `bson:"telegramId,omitempty" json:"telegramId"`
	Phone        string             `bson:"phone" json:"phone"`
	FirstName    string             `bson:"firstName" json:"firstName"`
	LastName     string             `bson:"lastName" json:"lastName"`
	AvatarURL    string             `bson:"avatarUrl,omitempty" json:"avatarUrl"`
	Region       string             `bson:"region,omitempty" json:"region"`
	District     string             `bson:"district,omitempty" json:"district"`
	Bio          string             `bson:"bio,omitempty" json:"bio"`
	Skills       []string           `bson:"skills,omitempty" json:"skills"`
	Rating       float64            `bson:"rating" json:"rating"`
	ReviewsCount int                `bson:"reviewsCount" json:"reviewsCount"`
	// Ikki tomonlama reyting: ishchi sifatida va ish beruvchi sifatida alohida.
	WorkerRating         float64              `bson:"workerRating" json:"workerRating"`
	WorkerReviewsCount   int                  `bson:"workerReviewsCount" json:"workerReviewsCount"`
	EmployerRating       float64              `bson:"employerRating" json:"employerRating"`
	EmployerReviewsCount int                  `bson:"employerReviewsCount" json:"employerReviewsCount"`
	CompletedJobsCount   int                  `bson:"completedJobsCount" json:"completedJobsCount"`
	IsPhoneVerified      bool                 `bson:"isPhoneVerified" json:"isPhoneVerified"`
	IsBlocked            bool                 `bson:"isBlocked" json:"isBlocked"`
	IsDeleted            bool                 `bson:"isDeleted" json:"isDeleted"`
	LangPref             string               `bson:"langPref" json:"langPref"`
	ThemePref            string               `bson:"themePref" json:"themePref"`
	BlockedUserIDs       []primitive.ObjectID `bson:"blockedUserIds,omitempty" json:"blockedUserIds"`
	OnboardingCompleted  bool                 `bson:"onboardingCompleted" json:"onboardingCompleted"`
	CreatedAt            time.Time            `bson:"createdAt" json:"createdAt"`
	UpdatedAt            time.Time            `bson:"updatedAt" json:"updatedAt"`

	// Self-deletion releases the account's identity: phone and telegramId are
	// unset (freeing the unique indexes so the number can register again as a
	// fresh account) and archived here for support/audit. Only ever populated
	// on soft-deleted records — see internal/account.softDelete.
	DeletedPhone      string     `bson:"deletedPhone,omitempty" json:"deletedPhone,omitempty"`
	DeletedTelegramID int64      `bson:"deletedTelegramId,omitempty" json:"deletedTelegramId,omitempty"`
	DeletedAt         *time.Time `bson:"deletedAt,omitempty" json:"deletedAt,omitempty"`

	// IsReviewAccount marks the sandboxed Google Play review account (and the
	// demo counterparties seeded alongside it). It gates the write restrictions
	// in auth.DenyReviewAccount and keeps the account out of public listings,
	// admin analytics and the retention sweep.
	//
	// json:"-" is deliberate: serialising it would advertise to every client
	// that a review mode exists. Nothing outside the server ever sees it.
	IsReviewAccount bool `bson:"isReviewAccount,omitempty" json:"-"`
}

// PublicUser is a safe projection.
type PublicUser struct {
	ID                   primitive.ObjectID `json:"id"`
	FirstName            string             `json:"firstName"`
	LastName             string             `json:"lastName"`
	AvatarURL            string             `json:"avatarUrl"`
	Region               string             `json:"region"`
	District             string             `json:"district"`
	Bio                  string             `json:"bio"`
	Skills               []string           `json:"skills"`
	Rating               float64            `json:"rating"`
	ReviewsCount         int                `json:"reviewsCount"`
	WorkerRating         float64            `json:"workerRating"`
	WorkerReviewsCount   int                `json:"workerReviewsCount"`
	EmployerRating       float64            `json:"employerRating"`
	EmployerReviewsCount int                `json:"employerReviewsCount"`
	CompletedJobsCount   int                `json:"completedJobsCount"`
	IsPhoneVerified      bool               `json:"isPhoneVerified"`
}

func (u *User) Public() PublicUser {
	return PublicUser{
		ID: u.ID, FirstName: u.FirstName, LastName: u.LastName, AvatarURL: u.AvatarURL,
		Region: u.Region, District: u.District, Bio: u.Bio, Skills: u.Skills,
		Rating: u.Rating, ReviewsCount: u.ReviewsCount,
		WorkerRating: u.WorkerRating, WorkerReviewsCount: u.WorkerReviewsCount,
		EmployerRating: u.EmployerRating, EmployerReviewsCount: u.EmployerReviewsCount,
		CompletedJobsCount: u.CompletedJobsCount, IsPhoneVerified: u.IsPhoneVerified,
	}
}

// Category
type Category struct {
	ID              primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name            string             `bson:"name" json:"name"`
	Slug            string             `bson:"slug" json:"slug"`
	Icon            string             `bson:"icon,omitempty" json:"icon"`
	CreatedBy       primitive.ObjectID `bson:"createdBy,omitempty" json:"createdBy"`
	IsSystemDefault bool               `bson:"isSystemDefault" json:"isSystemDefault"`
	IsActive        bool               `bson:"isActive" json:"isActive"`
	UsageCount      int                `bson:"usageCount" json:"usageCount"`
	CreatedAt       time.Time          `bson:"createdAt" json:"createdAt"`
}

// Elon (job listing)
type Elon struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	OwnerID      primitive.ObjectID `bson:"ownerId" json:"ownerId"`
	Title        string             `bson:"title" json:"title"`
	CategoryID   primitive.ObjectID `bson:"categoryId" json:"categoryId"`
	CategoryName string             `bson:"categoryName" json:"categoryName"`
	Description  string             `bson:"description" json:"description"`
	LocationURL  string             `bson:"locationUrl,omitempty" json:"locationUrl"`
	LocationText string             `bson:"locationText,omitempty" json:"locationText"`
	// Aniq ish joyi koordinatalari (xaritadan tanlanadi).
	Lat             float64 `bson:"lat,omitempty" json:"lat"`
	Lng             float64 `bson:"lng,omitempty" json:"lng"`
	Region          string  `bson:"region,omitempty" json:"region"`
	District        string  `bson:"district,omitempty" json:"district"`
	WorkersNeeded   int     `bson:"workersNeeded" json:"workersNeeded"`
	PricingType     string  `bson:"pricingType" json:"pricingType"` // per_worker|total|negotiable
	PriceAmount     int64   `bson:"priceAmount" json:"priceAmount"`
	PerWorkerAmount int64   `bson:"perWorkerAmount" json:"perWorkerAmount"`
	StartDate       string  `bson:"startDate,omitempty" json:"startDate"`
	WorkTimeFrom    string  `bson:"workTimeFrom,omitempty" json:"workTimeFrom"`
	WorkTimeTo      string  `bson:"workTimeTo,omitempty" json:"workTimeTo"`
	ContactPhone    string  `bson:"contactPhone,omitempty" json:"contactPhone"`
	// Ishga kimlar kerak: male (erkaklar) | female (ayollar) | mixed (aralash).
	// Bo'sh/eski e'lonlar "aralash" deb hisoblanadi (feed filtriga qarang).
	Gender        string     `bson:"gender,omitempty" json:"gender"`
	Status        string     `bson:"status" json:"status"` // draft|recruiting|filled|in_progress|completed|cancelled
	AcceptedCount int        `bson:"acceptedCount" json:"acceptedCount"`
	ViewsCount    int        `bson:"viewsCount" json:"viewsCount"`
	IsDeleted     bool       `bson:"isDeleted" json:"isDeleted"`
	PublishedAt   *time.Time `bson:"publishedAt,omitempty" json:"publishedAt,omitempty"`
	CreatedAt     time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt     time.Time  `bson:"updatedAt" json:"updatedAt"`
	// Denormalized owner info for fast feed
	OwnerName         string  `bson:"ownerName,omitempty" json:"ownerName"`
	OwnerRating       float64 `bson:"ownerRating,omitempty" json:"ownerRating"`
	OwnerReviewsCount int     `bson:"ownerReviewsCount,omitempty" json:"ownerReviewsCount"`
	OwnerAvatarURL    string  `bson:"ownerAvatarUrl,omitempty" json:"ownerAvatarUrl"`
	// Image URLs (stored on S3).
	Images []string `bson:"images,omitempty" json:"images"`

	// IsReviewData marks an elon created by the review account. Such elons are
	// filtered out of the public feed, search and sitemap, so a real user never
	// sees one. See internal/auth/review.go. Never serialised — see
	// User.IsReviewAccount.
	IsReviewData bool `bson:"isReviewData,omitempty" json:"-"`
}

// Application
type Application struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ElonID      primitive.ObjectID `bson:"elonId" json:"elonId"`
	ElonTitle   string             `bson:"elonTitle" json:"elonTitle"`
	WorkerID    primitive.ObjectID `bson:"workerId" json:"workerId"`
	EmployerID  primitive.ObjectID `bson:"employerId" json:"employerId"`
	WorkerPhone string             `bson:"workerPhone" json:"workerPhone"`
	// Ushbu ariza bilan nechta kishi ishga kelmoqchi (guruh bo'lib ariza).
	// Kamida 1. Ish beruvchi qabul qilganda e'lonning acceptedCount shu songa
	// oshadi.
	PeopleCount int `bson:"peopleCount" json:"peopleCount"`
	// Denormalized worker snapshot (ariza tushgan paytdagi holat) — ish beruvchi
	// nomzodlar ro'yxatini ko'rsatishi uchun.
	WorkerName         string  `bson:"workerName,omitempty" json:"workerName"`
	WorkerRating       float64 `bson:"workerRating,omitempty" json:"workerRating"`
	WorkerReviewsCount int     `bson:"workerReviewsCount,omitempty" json:"workerReviewsCount"`
	WorkerAvatarURL    string  `bson:"workerAvatarUrl,omitempty" json:"workerAvatarUrl"`
	WorkerVerified     bool    `bson:"workerVerified,omitempty" json:"workerVerified"`
	// Denormalized elon snapshot — ishchi o'z arizalari ro'yxatini ko'rsatishi uchun.
	ElonCategoryName      string  `bson:"elonCategoryName,omitempty" json:"elonCategoryName"`
	ElonRegion            string  `bson:"elonRegion,omitempty" json:"elonRegion"`
	ElonDistrict          string  `bson:"elonDistrict,omitempty" json:"elonDistrict"`
	OwnerName             string  `bson:"ownerName,omitempty" json:"ownerName"`
	OwnerRating           float64 `bson:"ownerRating,omitempty" json:"ownerRating"`
	OwnerAvatarURL        string  `bson:"ownerAvatarUrl,omitempty" json:"ownerAvatarUrl"`
	Amount                int64   `bson:"amount" json:"amount"`
	IsNegotiable          bool    `bson:"isNegotiable" json:"isNegotiable"`
	Status                string  `bson:"status" json:"status"` // pending|accepted|rejected|cancelled|completed
	EmployerConfirmedDone bool    `bson:"employerConfirmedDone" json:"employerConfirmedDone"`
	WorkerConfirmedDone   bool    `bson:"workerConfirmedDone" json:"workerConfirmedDone"`
	// AutoCompleted — ish ikki tomon tasdig'isiz, belgilangan vaqtdan 18 soat
	// o'tgach avtomatik yakunlangan bo'lsa true. Tarix (arxiv) yozuvi qanday
	// yopilganini ajratish uchun.
	AutoCompleted bool       `bson:"autoCompleted" json:"autoCompleted"`
	CancelledBy   string     `bson:"cancelledBy,omitempty" json:"cancelledBy"`
	CancelReason  string     `bson:"cancelReason,omitempty" json:"cancelReason,omitempty"`
	AppliedAt     time.Time  `bson:"appliedAt" json:"appliedAt"`
	DecidedAt     *time.Time `bson:"decidedAt,omitempty" json:"decidedAt,omitempty"`
	CompletedAt   *time.Time `bson:"completedAt,omitempty" json:"completedAt,omitempty"`

	// IsReviewData marks an application submitted by the review account. The
	// employer is never notified about it and never sees it in their candidate
	// list, so a reviewer can exercise the full apply flow against a real elon
	// without any real user noticing. Never serialised — see
	// User.IsReviewAccount.
	IsReviewData bool `bson:"isReviewData,omitempty" json:"-"`
}

// Eslatma: User'dagi WorkerRating/EmployerRating/ReviewsCount maydonlari
// kelajakdagi "sharh va baho" funksiyasi uchun ajratilgan — hozircha ularni
// to'ldiradigan endpoint YO'Q (hech qayerda yozilmaydi, doim 0 turadi).

// Notification
type Notification struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID        primitive.ObjectID `bson:"userId" json:"userId"`
	Type          string             `bson:"type" json:"type"`
	Title         string             `bson:"title" json:"title"`
	Body          string             `bson:"body" json:"body"`
	RelatedEntity *RelatedEntity     `bson:"relatedEntity,omitempty" json:"relatedEntity,omitempty"`
	IsRead        bool               `bson:"isRead" json:"isRead"`
	CreatedAt     time.Time          `bson:"createdAt" json:"createdAt"`
}
type RelatedEntity struct {
	Type string             `bson:"type" json:"type"`
	ID   primitive.ObjectID `bson:"id" json:"id"`
}

// DeviceToken — mobil qurilmaning FCM push tokeni. Bitta token har doim bitta
// foydalanuvchiga tegishli: qurilmada akkaunt almashsa, token yangi egasiga
// ko'chiriladi (internal/push.Handler.Register upsert'i).
type DeviceToken struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID    primitive.ObjectID `bson:"userId" json:"userId"`
	Token     string             `bson:"token" json:"token"`
	Platform  string             `bson:"platform" json:"platform"` // android|ios
	CreatedAt time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time          `bson:"updatedAt" json:"updatedAt"`
}

// Report
type Report struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ReporterID  primitive.ObjectID `bson:"reporterId" json:"reporterId"`
	TargetType  string             `bson:"targetType" json:"targetType"` // user|elon|message
	TargetID    primitive.ObjectID `bson:"targetId" json:"targetId"`
	Reason      string             `bson:"reason" json:"reason"`
	Description string             `bson:"description,omitempty" json:"description"`
	Status      string             `bson:"status" json:"status"` // open|resolved|dismissed
	ReviewedBy  primitive.ObjectID `bson:"reviewedBy,omitempty" json:"reviewedBy,omitempty"`
	ReviewedAt  *time.Time         `bson:"reviewedAt,omitempty" json:"reviewedAt,omitempty"`
	CreatedAt   time.Time          `bson:"createdAt" json:"createdAt"`
}

// Feedback — foydalanuvchilardan kelgan taklif va shikoyatlar.
type Feedback struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID     primitive.ObjectID `bson:"userId" json:"userId"`
	UserName   string             `bson:"userName,omitempty" json:"userName"`
	UserPhone  string             `bson:"userPhone,omitempty" json:"userPhone"`
	Type       string             `bson:"type" json:"type"` // suggestion|complaint
	Subject    string             `bson:"subject,omitempty" json:"subject"`
	Message    string             `bson:"message" json:"message"`
	Status     string             `bson:"status" json:"status"` // open|resolved
	ReviewedBy primitive.ObjectID `bson:"reviewedBy,omitempty" json:"reviewedBy,omitempty"`
	ReviewedAt *time.Time         `bson:"reviewedAt,omitempty" json:"reviewedAt,omitempty"`
	CreatedAt  time.Time          `bson:"createdAt" json:"createdAt"`
}

// Admin
type Admin struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Username     string             `bson:"username" json:"username"`
	Name         string             `bson:"name,omitempty" json:"name"`
	PasswordHash string             `bson:"passwordHash" json:"-"`
	Role         string             `bson:"role" json:"role"`
	IsActive     bool               `bson:"isActive" json:"isActive"`
	// Two-factor (TOTP). TOTPSecret is never serialized to clients. TOTPEnabled
	// is true only after the admin verifies a code during enrollment.
	TOTPSecret  string    `bson:"totpSecret,omitempty" json:"-"`
	TOTPEnabled bool      `bson:"totpEnabled" json:"totpEnabled"`
	CreatedAt   time.Time `bson:"createdAt" json:"createdAt"`
}

// Broadcast — admin ommaviy bildirishnomasi tarixi. Yuborish fon jarayonida
// bajariladi; SentCount va Status yuborish tugagach yangilanadi.
type Broadcast struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Title       string             `bson:"title" json:"title"`
	Body        string             `bson:"body" json:"body"`
	Region      string             `bson:"region,omitempty" json:"region"`
	ActiveOnly  bool               `bson:"activeOnly" json:"activeOnly"`
	SentCount   int                `bson:"sentCount" json:"sentCount"`
	Status      string             `bson:"status" json:"status"` // scheduled|sending|done
	ScheduledAt *time.Time         `bson:"scheduledAt,omitempty" json:"scheduledAt,omitempty"`
	CreatedBy   primitive.ObjectID `bson:"createdBy,omitempty" json:"createdBy"`
	CreatedAt   time.Time          `bson:"createdAt" json:"createdAt"`
}

// AdminAuditLog
type AdminAudit struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	AdminID   primitive.ObjectID `bson:"adminId" json:"adminId"`
	Action    string             `bson:"action" json:"action"`
	Target    string             `bson:"target,omitempty" json:"target"`
	Detail    string             `bson:"detail,omitempty" json:"detail"`
	CreatedAt time.Time          `bson:"createdAt" json:"createdAt"`
}

// OTPCode
type OTPCode struct {
	ID         primitive.ObjectID `bson:"_id,omitempty"`
	TGToken    string             `bson:"tgToken"`
	Phone      string             `bson:"phone,omitempty"`
	TelegramID int64              `bson:"telegramId,omitempty"`
	Code       string             `bson:"code,omitempty"`
	Attempts   int                `bson:"attempts"`
	ExpiresAt  time.Time          `bson:"expiresAt"`
	Used       bool               `bson:"used"`
	CreatedAt  time.Time          `bson:"createdAt"`
}
