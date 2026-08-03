package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/ishchibormi/bot/internal/envfile"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type userDoc struct {
	Phone      string `bson:"phone"`
	TelegramID int64  `bson:"telegramId"`
}

func main() {
	envfile.Load()
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		log.Fatal("TELEGRAM_BOT_TOKEN required")
	}
	mongoURI := getenv("MONGO_URI", "mongodb://localhost:27017")
	dbName := getenv("MONGO_DB", "ishchibormi")
	otpTTL := time.Duration(envInt("OTP_TTL_SECONDS", 180)) * time.Second
	otpLen := envInt("OTP_LENGTH", 6)

	// SIGINT/SIGTERM (docker compose stop) kelganda ctx bekor bo'ladi — quyida
	// updates kanali yopilib, sikl tugaydi va Mongo ulanishi toza uziladi.
	// Aks holda konteyner 10s kutib SIGKILL bilan o'lardi, yozuvlar chala qolardi.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	mc, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatalf("mongo: %v", err)
	}
	defer func() {
		// ctx bu paytda bekor bo'lgan bo'lishi mumkin — uzish uchun yangi muddat.
		dctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = mc.Disconnect(dctx)
	}()

	// mongo.Connect is lazy — it doesn't actually reach the server. Ping now so a
	// misconfigured/unreachable MONGO_URI fails loudly at startup instead of every
	// user silently getting "Xatolik yuz berdi" when they share their contact.
	pingCtx, cancelPing := context.WithTimeout(ctx, 10*time.Second)
	if err := mc.Ping(pingCtx, nil); err != nil {
		cancelPing()
		log.Fatalf("mongo unreachable (db=%q): %v — check MONGO_URI", dbName, err)
	}
	cancelPing()

	otpCol := mc.Database(dbName).Collection("otp_codes")
	usersCol := mc.Database(dbName).Collection("users")

	bot, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		log.Fatalf("bot: %v", err)
	}
	log.Printf("bot started: @%s", bot.Self.UserName)

	// Pending tokens per chatID (so /start <token>, then contact comes later)
	pending := map[int64]string{}

	upd := tgbotapi.NewUpdate(0)
	upd.Timeout = 30
	updates := bot.GetUpdatesChan(upd)
	go func() {
		<-ctx.Done()
		log.Println("shutdown signal — stopping updates")
		bot.StopReceivingUpdates() // updates kanalini yopadi, quyidagi for tugaydi
	}()
	for u := range updates {
		if u.Message == nil {
			continue
		}
		m := u.Message
		switch {
		case m.IsCommand() && m.Command() == "start":
			args := strings.TrimSpace(m.CommandArguments())

			// ── Known user shortcut ───────────────────────────────────
			// If we've seen this Telegram user before AND we have their
			// phone in the users collection, skip the contact-share step
			// and just issue a fresh code immediately.
			if phone, ok := findKnownPhone(ctx, usersCol, m.From.ID); ok {
				code, err := generateAndStore(ctx, otpCol, args, phone, m.From.ID, otpTTL, otpLen)
				if err != nil {
					log.Printf("otp store failed (known user tgID=%d): %v", m.From.ID, err)
					_, _ = bot.Send(tgbotapi.NewMessage(m.Chat.ID, "Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring."))
					continue
				}
				msg := tgbotapi.NewMessage(m.Chat.ID,
					fmt.Sprintf("Qaytib xush kelibsiz!\n\nTasdiqlash kodingiz: `%s`\n\n(Kodni nusxalash uchun ustiga bosing.)\nKodni saytda kiriting. Kod %d daqiqa amal qiladi.",
						code, int(otpTTL/time.Minute)))
				msg.ParseMode = "Markdown"
				msg.ReplyMarkup = tgbotapi.NewRemoveKeyboard(true)
				_, _ = bot.Send(msg)
				delete(pending, m.Chat.ID)
				continue
			}

			// ── First-time flow: ask for contact ──────────────────────
			if args != "" {
				pending[m.Chat.ID] = args
			}
			req := tgbotapi.NewMessage(m.Chat.ID, "Salom! \"Ishchi Bormi\" ga xush kelibsiz.\n\nIltimos, telefon raqamingizni ulashing.")
			kb := tgbotapi.NewReplyKeyboard(
				tgbotapi.NewKeyboardButtonRow(tgbotapi.KeyboardButton{Text: "📞 Telefon raqamni ulashish", RequestContact: true}),
			)
			kb.OneTimeKeyboard = true
			kb.ResizeKeyboard = true
			req.ReplyMarkup = kb
			_, _ = bot.Send(req)

		case m.Contact != nil:
			phone := normalizePhone(m.Contact.PhoneNumber)
			code, err := generateAndStore(ctx, otpCol, pending[m.Chat.ID], phone, m.From.ID, otpTTL, otpLen)
			if err != nil {
				log.Printf("otp store failed (contact tgID=%d): %v", m.From.ID, err)
				_, _ = bot.Send(tgbotapi.NewMessage(m.Chat.ID, "Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring."))
				continue
			}
			ack := tgbotapi.NewMessage(m.Chat.ID, fmt.Sprintf("Tasdiqlash kodingiz: `%s`\n\n(Kodni nusxalash uchun ustiga bosing.)\nKodni saytda kiriting. Kod %d daqiqa amal qiladi.", code, int(otpTTL/time.Minute)))
			ack.ParseMode = "Markdown"
			ack.ReplyMarkup = tgbotapi.NewRemoveKeyboard(true)
			_, _ = bot.Send(ack)
			delete(pending, m.Chat.ID)

		default:
			_, _ = bot.Send(tgbotapi.NewMessage(m.Chat.ID, "Iltimos, /start buyrug'idan boshlang."))
		}
	}
}

// findKnownPhone looks up a user by telegramId in the users collection.
// Returns the verified phone if available.
func findKnownPhone(ctx context.Context, users *mongo.Collection, tgID int64) (string, bool) {
	if tgID == 0 {
		return "", false
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var u userDoc
	err := users.FindOne(ctx,
		bson.M{"telegramId": tgID, "phone": bson.M{"$ne": ""}},
		options.FindOne().SetProjection(bson.M{"phone": 1, "telegramId": 1}),
	).Decode(&u)
	if err != nil || u.Phone == "" {
		return "", false
	}
	return u.Phone, true
}

func generateAndStore(ctx context.Context, col *mongo.Collection, token, phone string, tgID int64, ttl time.Duration, length int) (string, error) {
	code, err := randDigits(length)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	now := time.Now()
	if token != "" {
		res := col.FindOneAndUpdate(ctx,
			bson.M{"tgToken": token, "used": false, "expiresAt": bson.M{"$gt": now}},
			bson.M{"$set": bson.M{
				"phone": phone, "telegramId": tgID, "code": code, "expiresAt": now.Add(ttl),
			}},
		)
		if res.Err() == nil {
			return code, nil
		}
	}
	// Fallback (bot opened directly, without a web token): keep one active
	// phone-based code per Telegram user. Upsert instead of insert so retrying
	// the contact-share updates the same record rather than piling up duplicates
	// — which also removes any chance of a unique-index collision. Web verifies
	// this via the code-only (phone) fallback.
	_, err = col.UpdateOne(ctx,
		bson.M{"telegramId": tgID, "tgToken": ""},
		bson.M{
			"$set": bson.M{
				"phone": phone, "code": code, "used": false,
				"attempts": 0, "expiresAt": now.Add(ttl),
			},
			"$setOnInsert": bson.M{"createdAt": now},
		},
		options.Update().SetUpsert(true),
	)
	return code, err
}

func normalizePhone(p string) string {
	p = strings.TrimSpace(p)
	if !strings.HasPrefix(p, "+") {
		p = "+" + p
	}
	return p
}

func randDigits(n int) (string, error) {
	const digits = "0123456789"
	out := make([]byte, n)
	b := make([]byte, 1)
	for i := 0; i < n; {
		if _, err := rand.Read(b); err != nil {
			return "", err
		}
		// Rejection sampling: 250..255 tashlab yuboriladi, aks holda 256%10=6
		// tufayli 0-5 raqamlari boshqalardan tez-tezroq chiqardi (modulo bias).
		if b[0] >= 250 {
			continue
		}
		out[i] = digits[int(b[0])%10]
		i++
	}
	return string(out), nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}
