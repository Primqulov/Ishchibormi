// Ishchi Bormi — Telegram Mini App boti.
//
// Bu botning yagona vazifasi — Mini App'ni ochib berish. U ataylab juda
// yupqa qilingan:
//
//   - bazaga ULANMAYDI;
//   - JWT sirini, Mongo parolini yoki boshqa hech qanday ilova sirini
//     bilmaydi;
//   - foydalanuvchi ma'lumotini saqlamaydi.
//
// Sabab: haqiqiy kirish Mini App ichida `initData` imzosi orqali bo'ladi va uni
// backend tekshiradi (apps/api/internal/auth/webapp.go). Bot faqat oynani
// ochadi. Shu tufayli bot buzilsa ham hujumchi qo'liga tokendan boshqa hech
// narsa tushmaydi.
//
// Telefoni hali bog'lanmagan foydalanuvchi Mini App ichida OTP botiga
// yo'naltiriladi — u oqim allaqachon mavjud va sinovdan o'tgan (Web/bot).
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/ishchibormi/miniapp-bot/internal/envfile"
)

// DIQQAT — nega bu yerda xom API chaqiruvlari bor.
//
// Loyiha bo'ylab ishlatiladigan go-telegram-bot-api/v5 (v5.5.1 — uning eng
// so'nggi relizi) Bot API 6.0 dan OLDIN to'xtab qolgan, ya'ni unda WebAppInfo
// tipi umuman yo'q. Mini App tugmasi esa aynan o'sha versiyada paydo bo'lgan.
//
// Butun loyihada Telegram kutubxonasini almashtirish o'rniga (OTP boti shu
// kutubxonada ishlab turibdi) faqat shu ikki chaqiruv — sendMessage va
// setChatMenuButton — MakeRequest orqali xom JSON bilan yuboriladi. Yangilanish
// sikli, qayta urinishlar va xatolarni ishlash kutubxonanikiligicha qoladi.
// Kutubxona Web App'ni qo'llab-quvvatlagan kuni bu joyni oddiy tipli tuzilmaga
// almashtirish mumkin.

const (
	openButtonText = "🔎 Ishlarni ochish"

	welcomeText = "👋 <b>Ishchi Bormi</b>ga xush kelibsiz!\n\n" +
		"Bu yerda yaqin atrofdagi kunlik ishlarni topasiz yoki o'zingiz ishchi " +
		"yollaysiz — hammasi Telegram ichida, hech narsa o'rnatmasdan.\n\n" +
		"Boshlash uchun pastdagi tugmani bosing 👇"

	helpText = "ℹ️ <b>Yordam</b>\n\n" +
		"• /start — ilovani ochish\n" +
		"• Ilova chatdagi pastki menyu tugmasidan ham ochiladi\n\n" +
		"Savol yoki muammo bo'lsa: @Ishchi_bormi_support"
)

func main() {
	envfile.Load()

	token := strings.TrimSpace(os.Getenv("TELEGRAM_MINIAPP_BOT_TOKEN"))
	if token == "" {
		log.Fatal("TELEGRAM_MINIAPP_BOT_TOKEN required")
	}
	appURL := strings.TrimSpace(os.Getenv("MINIAPP_URL"))
	if appURL == "" {
		log.Fatal("MINIAPP_URL required (Mini App ochiladigan HTTPS manzil)")
	}
	// Telegram faqat HTTPS ni qabul qiladi. Buni shu yerda ushlamasak, xato
	// faqat foydalanuvchi tugmani bosganda — "Bad Request: unsupported URL" —
	// ko'rinadi va sababi umuman tushunarsiz bo'ladi.
	if u, err := url.Parse(appURL); err != nil || u.Scheme != "https" || u.Host == "" {
		log.Fatalf("MINIAPP_URL to'liq HTTPS manzil bo'lishi kerak (masalan https://app.example.com), berilgani: %q", appURL)
	}

	// SIGINT/SIGTERM (docker compose stop) kelganda ctx bekor bo'ladi va
	// quyidagi sikl toza tugaydi — konteyner SIGKILL kutib turmaydi.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	bot, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		log.Fatalf("bot: %v", err)
	}
	log.Printf("mini app bot started: @%s → %s", bot.Self.UserName, appURL)

	// Chatdagi doimiy menyu tugmasi ham ilovani ochsin: foydalanuvchi har safar
	// /start yozib o'tirmasligi kerak.
	setMenuButton(bot, appURL)
	keyboard := openKeyboardJSON(appURL)

	upd := tgbotapi.NewUpdate(0)
	upd.Timeout = 30
	updates := bot.GetUpdatesChan(upd)

	// ctx bekor bo'lishi bilan uzun so'rov to'xtatiladi va kanal yopiladi.
	go func() {
		<-ctx.Done()
		bot.StopReceivingUpdates()
	}()

	for u := range updates {
		m := u.Message
		if m == nil {
			continue
		}
		switch {
		case m.IsCommand() && m.Command() == "help":
			send(bot, m.Chat.ID, helpText, keyboard)
		default:
			// /start va boshqa har qanday xabar — bir xil javob. Bot bilan
			// suhbatlashish ko'zda tutilmagan: butun mahsulot ilovaning ichida.
			send(bot, m.Chat.ID, welcomeText, keyboard)
		}
	}
	log.Println("mini app bot stopped")
}

// openKeyboardJSON — xabar ostidagi "Ishlarni ochish" tugmasi, reply_markup
// uchun tayyor JSON. Inline WebApp tugmasi ataylab tanlangan: u ilovani xuddi
// shu chatning ichida ochadi.
//
// Manzil o'zgarmagani uchun JSON bir marta — ishga tushishda — quriladi.
func openKeyboardJSON(appURL string) string {
	markup := map[string]any{
		"inline_keyboard": [][]map[string]any{{
			{
				"text":    openButtonText,
				"web_app": map[string]string{"url": appURL},
			},
		}},
	}
	b, err := json.Marshal(markup)
	if err != nil {
		// Faqat konstantalardan tuzilgan xarita — bu amalda imkonsiz, lekin
		// jimgina tugmasiz qolgandan ko'ra darhol to'xtagan yaxshi.
		log.Fatalf("reply_markup: %v", err)
	}
	return string(b)
}

func send(bot *tgbotapi.BotAPI, chatID int64, text, replyMarkup string) {
	params := tgbotapi.Params{
		"chat_id":      strconv.FormatInt(chatID, 10),
		"text":         text,
		"parse_mode":   tgbotapi.ModeHTML,
		"reply_markup": replyMarkup,
	}
	if _, err := bot.MakeRequest("sendMessage", params); err != nil {
		// Foydalanuvchi botni bloklagan bo'lishi mumkin — bu kutilgan hol,
		// shuning uchun log'dan nariga o'tmaydi.
		log.Printf("send to %d: %v", chatID, err)
	}
}

// setMenuButton chat oynasining pastki chap burchagidagi doimiy tugmani Mini
// App'ga bog'laydi. Xatosi halokatli emas: tugma bo'lmasa ham /start ishlaydi,
// shuning uchun faqat log qilinadi.
func setMenuButton(bot *tgbotapi.BotAPI, appURL string) {
	params := tgbotapi.Params{}
	if err := params.AddInterface("menu_button", map[string]any{
		"type": "web_app",
		"text": "Ishlar",
		"web_app": map[string]string{
			"url": appURL,
		},
	}); err != nil {
		log.Printf("setChatMenuButton (params): %v", err)
		return
	}
	if _, err := bot.MakeRequest("setChatMenuButton", params); err != nil {
		log.Printf("setChatMenuButton: %v", err)
	}
}
