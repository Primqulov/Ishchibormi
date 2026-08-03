// Command reviewaccount manages the sandboxed Google Play review account and
// the switch that lets a reviewer sign in without Telegram. See
// internal/auth/review.go for the mechanism itself.
//
// Run it inside the backend container, where .env is already in the environment:
//
//	docker compose exec backend /app/reviewaccount status
//	docker compose exec backend /app/reviewaccount create   # once, ever
//	docker compose exec backend /app/reviewaccount open     # before a submission
//	docker compose exec backend /app/reviewaccount close    # after approval
//	docker compose exec backend /app/reviewaccount purge    # drop demo residue
//
// The normal lifecycle is create once, then open/close around each submission —
// every app update gets reviewed again, so this is not a one-off. `open` always
// mints a NEW code; a code is never reused across submissions.
//
// Nothing here flips REVIEW_LOGIN_ENABLED by itself. It prints the env block for
// a human to apply, because turning the switch on must stay a deliberate act.
package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/pkg/db"
	"github.com/ishchibormi/backend/pkg/envfile"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// reviewPhone is the identity the review account holds. It is shaped like a
// phone number so the profile screen looks normal to a reviewer, but "00" is
// not an allocatable Uzbek operator code, so it can never collide with a real
// subscriber. The unique-sparse index on phone keeps it single.
const reviewPhone = "+998000000000"

// defaultWindow is how long `open` keeps the door open. Deliberately far below
// config.MaxReviewLoginWindow: a Play review takes days.
const defaultWindow = 7 * 24 * time.Hour

func main() {
	envfile.Load()
	cfg := config.Load()

	cmd := "status"
	if len(os.Args) > 1 {
		cmd = strings.ToLower(os.Args[1])
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	mdb, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo ulanmadi: %v", err)
	}
	users := mdb.Collection("users")

	switch cmd {
	case "status":
		status(ctx, cfg, mdb)
	case "create":
		create(ctx, cfg, users)
	case "open":
		open(ctx, cfg, users)
	case "close":
		closeReview(ctx, users)
	case "purge":
		purge(ctx, mdb)
	default:
		fmt.Printf("noma'lum buyruq %q\nmavjud: status | create | open | close | purge\n", cmd)
		os.Exit(2)
	}
}

func findReviewUser(ctx context.Context, users *mongo.Collection) (*struct {
	ID        primitive.ObjectID `bson:"_id"`
	Phone     string             `bson:"phone"`
	IsBlocked bool               `bson:"isBlocked"`
	IsDeleted bool               `bson:"isDeleted"`
}, error) {
	var u struct {
		ID        primitive.ObjectID `bson:"_id"`
		Phone     string             `bson:"phone"`
		IsBlocked bool               `bson:"isBlocked"`
		IsDeleted bool               `bson:"isDeleted"`
	}
	err := users.FindOne(ctx, bson.M{"isReviewAccount": true}).Decode(&u)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func status(ctx context.Context, cfg config.Config, mdb *mongo.Database) {
	fmt.Printf("MONGO_DB=%s\n\n", cfg.MongoDB)

	fmt.Println("— Switch (environment) —")
	fmt.Printf("  REVIEW_LOGIN_ENABLED    = %v\n", cfg.ReviewLoginEnabled)
	fmt.Printf("  REVIEW_LOGIN_CODE       = %s\n", maskCode(cfg.ReviewLoginCode))
	fmt.Printf("  REVIEW_LOGIN_USER_ID    = %s\n", orDash(cfg.ReviewLoginUserID))
	if cfg.ReviewLoginExpiresAt.IsZero() {
		fmt.Printf("  REVIEW_LOGIN_EXPIRES_AT = -\n")
	} else {
		left := time.Until(cfg.ReviewLoginExpiresAt)
		state := fmt.Sprintf("%s left", left.Round(time.Minute))
		if left <= 0 {
			state = "CLOSED (login already inert)"
		}
		fmt.Printf("  REVIEW_LOGIN_EXPIRES_AT = %s  (%s)\n",
			cfg.ReviewLoginExpiresAt.Format(time.RFC3339), state)
	}

	fmt.Println("\n— Account —")
	u, err := findReviewUser(ctx, mdb.Collection("users"))
	switch {
	case err != nil:
		fmt.Println("  none (run: reviewaccount create)")
	default:
		fmt.Printf("  _id       = %s\n", u.ID.Hex())
		fmt.Printf("  phone     = %s\n", u.Phone)
		fmt.Printf("  isBlocked = %v", u.IsBlocked)
		if u.IsBlocked {
			fmt.Print("   <- cannot sign in (this is the wanted state outside a review)")
		}
		fmt.Println()
		if cfg.ReviewLoginUserID != "" && cfg.ReviewLoginUserID != u.ID.Hex() {
			fmt.Printf("  WARNING: REVIEW_LOGIN_USER_ID points at %s, not this account — login will fail closed\n",
				cfg.ReviewLoginUserID)
		}
	}

	fmt.Println("\n— Sandbox residue —")
	count := func(name string, filter bson.M) {
		n, _ := mdb.Collection(name).CountDocuments(ctx, filter)
		fmt.Printf("  %-14s %d\n", name, n)
	}
	count("elons", bson.M{"isReviewData": true})
	count("applications", bson.M{"isReviewData": true})
}

func create(ctx context.Context, cfg config.Config, users *mongo.Collection) {
	if u, err := findReviewUser(ctx, users); err == nil {
		fmt.Printf("Review hisobi allaqachon mavjud: %s\n", u.ID.Hex())
		fmt.Println("Yangi submission uchun: reviewaccount open")
		return
	}
	now := time.Now()
	res, err := users.InsertOne(ctx, bson.M{
		"phone":           reviewPhone,
		"firstName":       "Play",
		"lastName":        "Reviewer",
		"isReviewAccount": true,
		"isPhoneVerified": true,
		"isBlocked":       true, // create ochmaydi — ochish faqat `open` orqali
		"isDeleted":       false,
		// onboardingCompleted=false: reviewer to'liq birinchi-ishga-tushirish
		// oqimini ko'radi, Google aynan shuni ko'rishni xohlaydi.
		"onboardingCompleted": false,
		"rating":              0.0,
		"reviewsCount":        0,
		"completedJobsCount":  0,
		"langPref":            "latin",
		"themePref":           "light",
		"createdAt":           now,
		"updatedAt":           now,
	})
	if err != nil {
		log.Fatalf("review hisobini yaratib bo'lmadi: %v", err)
	}
	id := res.InsertedID.(primitive.ObjectID)
	fmt.Printf("Review hisobi yaratildi: %s\n", id.Hex())
	fmt.Println("Hozircha BLOKLANGAN — ochish uchun: reviewaccount open")
	_ = cfg
}

func open(ctx context.Context, cfg config.Config, users *mongo.Collection) {
	u, err := findReviewUser(ctx, users)
	if err != nil {
		log.Fatalf("review hisobi topilmadi — avval: reviewaccount create")
	}
	if _, err := users.UpdateOne(ctx,
		bson.M{"_id": u.ID},
		bson.M{"$set": bson.M{"isBlocked": false, "isDeleted": false, "updatedAt": time.Now()}},
	); err != nil {
		log.Fatalf("hisobni ochib bo'lmadi: %v", err)
	}

	code := generateCode(cfg.OTPLength)
	expires := time.Now().Add(defaultWindow).UTC().Truncate(time.Second)

	fmt.Printf("Hisob ochildi: %s\n\n", u.ID.Hex())
	fmt.Println("Serverdagi .env ga quyidagilarni qo'ying va backendni restart qiling:")
	fmt.Println("------------------------------------------------------------")
	fmt.Println("REVIEW_LOGIN_ENABLED=true")
	fmt.Printf("REVIEW_LOGIN_CODE=%s\n", code)
	fmt.Printf("REVIEW_LOGIN_USER_ID=%s\n", u.ID.Hex())
	fmt.Printf("REVIEW_LOGIN_EXPIRES_AT=%s\n", expires.Format(time.RFC3339))
	fmt.Println("------------------------------------------------------------")
	fmt.Printf("\nPlay Console -> App access:\n")
	fmt.Printf("  Username: %s\n", reviewPhone)
	fmt.Printf("  Password: %s\n", code)
	fmt.Println("  Instructions: Open the app. Do NOT tap the Telegram button.")
	fmt.Println("                Type the 6-digit code above into the code field and continue.")
	fmt.Printf("\nOyna %s da avtomatik yopiladi. Tasdiqlangach: reviewaccount close\n",
		expires.Format(time.RFC3339))
}

func closeReview(ctx context.Context, users *mongo.Collection) {
	u, err := findReviewUser(ctx, users)
	if err != nil {
		log.Fatalf("review hisobi topilmadi: %v", err)
	}
	if _, err := users.UpdateOne(ctx,
		bson.M{"_id": u.ID},
		bson.M{"$set": bson.M{"isBlocked": true, "updatedAt": time.Now()}},
	); err != nil {
		log.Fatalf("hisobni bloklab bo'lmadi: %v", err)
	}
	fmt.Printf("Review hisobi bloklandi: %s\n", u.ID.Hex())
	fmt.Println()
	fmt.Println("MUHIM — bu yetarli emas. Access token 3 kun yashaydi, lekin")
	fmt.Println("RequireActiveUser bloklangan hisobni har so'rovda rad etadi, ya'ni")
	fmt.Println("mavjud sessiya ham shu daqiqada o'ladi. Shunga qaramay .env dan")
	fmt.Println("REVIEW_LOGIN_ENABLED=false qo'ying va REVIEW_LOGIN_CODE ni tozalang,")
	fmt.Println("aks holda yangi sessiya ochish yo'li ochiq qoladi.")
}

func purge(ctx context.Context, mdb *mongo.Database) {
	del := func(name string, filter bson.M) {
		res, err := mdb.Collection(name).DeleteMany(ctx, filter)
		if err != nil {
			fmt.Printf("  %-14s XATO: %v\n", name, err)
			return
		}
		fmt.Printf("  %-14s %d o'chirildi\n", name, res.DeletedCount)
	}
	fmt.Println("Sandbox ma'lumotlari tozalanmoqda:")
	del("elons", bson.M{"isReviewData": true})
	del("applications", bson.M{"isReviewData": true})

	// Demo hisobga tushgan bildirishnomalar.
	if u, err := findReviewUser(ctx, mdb.Collection("users")); err == nil {
		del("notifications", bson.M{"userId": u.ID})
	}
	fmt.Println("\nHisobning o'zi saqlanib qoldi (bloklangan holda) — keyingi")
	fmt.Println("submission uchun qayta ishlatiladi.")
}

// generateCode returns an n-digit code from crypto/rand, retrying until it is
// not one of the trivially guessable shapes config rejects (all-same digits or
// a consecutive run).
func generateCode(n int) string {
	for {
		var sb strings.Builder
		for i := 0; i < n; i++ {
			d, err := rand.Int(rand.Reader, big.NewInt(10))
			if err != nil {
				log.Fatalf("crypto/rand ishlamadi: %v", err)
			}
			sb.WriteByte(byte('0' + d.Int64()))
		}
		if c := sb.String(); !weak(c) {
			return c
		}
	}
}

func weak(s string) bool {
	if len(s) < 2 {
		return true
	}
	same, asc, desc := true, true, true
	for i := 1; i < len(s); i++ {
		if s[i] != s[0] {
			same = false
		}
		if s[i] != s[i-1]+1 {
			asc = false
		}
		if s[i] != s[i-1]-1 {
			desc = false
		}
	}
	return same || asc || desc
}

func maskCode(c string) string {
	if c == "" {
		return "-"
	}
	return strings.Repeat("*", len(c)) + fmt.Sprintf(" (%d digits set)", len(c))
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
