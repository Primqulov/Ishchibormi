package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/ishchibormi/backend/config"
	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/db"
	"github.com/ishchibormi/backend/pkg/envfile"
	"github.com/ishchibormi/backend/pkg/httpx"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

var firstNames = []string{
	"Alisher", "Sardor", "Bekzod", "Jasur", "Davron", "Sherzod", "Otabek",
	"Akmal", "Rustam", "Shokhrux", "Aziz", "Murod", "Nodir", "Ulug'bek",
	"Doniyor", "Farrukh",
}
var firstNamesF = []string{
	"Malika", "Madina", "Nilufar", "Zilola", "Mavluda", "Sevara", "Dilshoda",
	"Munisa", "Shahnoza", "Gulchehra",
}
var lastNames = []string{
	"Rustamov", "Yusupov", "Karimov", "Akhmedov", "Tursunov", "Olimov",
	"Mahmudov", "Saidov", "Bekmirzayev", "Khojayev", "Norqulov", "Rasulov",
	"Toshpo'latov", "Egamberdiyev", "Mirzayev", "Soliyev",
}

var regions = []struct {
	Region, District string
	Lat, Lng         float64
}{
	{"Toshkent", "Chilonzor", 41.2755, 69.2031}, {"Toshkent", "Yunusobod", 41.3640, 69.2880}, {"Toshkent", "Sergeli", 41.2230, 69.2200},
	{"Toshkent", "Mirzo Ulug'bek", 41.3300, 69.3340}, {"Toshkent", "Yashnobod", 41.2880, 69.3110},
	{"Samarqand", "Bag'ishamol", 39.6542, 66.9597}, {"Samarqand", "Urgut", 39.4010, 67.2410},
	{"Buxoro", "Olot", 39.4140, 63.6760}, {"Buxoro", "Kogon", 39.7220, 64.5520},
	{"Farg'ona", "Marg'ilon", 40.4710, 71.7240}, {"Farg'ona", "Quvasoy", 40.2990, 71.9740},
	{"Namangan", "Pop", 40.8730, 71.1090}, {"Namangan", "Chust", 41.0000, 71.2360},
	{"Andijon", "Asaka", 40.6420, 72.2370}, {"Qashqadaryo", "Qarshi", 38.8610, 65.7890},
	{"Surxondaryo", "Termiz", 37.2240, 67.2780},
}

// platformSeeds — admin panelidagi "Platforma" ustunining HAMMA holati.
//
// Nega ro'yxat qo'lda yozilgan, tasodifiy emas: maqsad — dizaynni lokalda
// ko'rish. Tasodifiy tanlansa, ba'zi holatlar (masalan "Veb ChromeOS")
// umuman chiqmay qolishi mumkin edi va aynan o'sha ustun kengligini
// tekshirib bo'lmasdi.
//
// Qurilma FAQAT "web" da to'ldiriladi — ilovada platformaning o'zi qurilma
// OS'i (httpx.ClientDevice ga qarang). Bo'sh platforma — "Noma'lum": bu
// funksiyadan oldin ro'yxatdan o'tganlar.
var platformSeeds = []struct {
	Platform, Device string
}{
	{httpx.PlatformAndroid, ""},               // Android
	{httpx.PlatformWeb, httpx.DeviceAndroid},  // Veb Android
	{httpx.PlatformIOS, ""},                   // iOS
	{httpx.PlatformWeb, httpx.DeviceWindows},  // Veb Windows
	{httpx.PlatformWeb, httpx.DeviceIOS},      // Veb iOS
	{httpx.PlatformWeb, httpx.DeviceMacOS},    // Veb macOS
	{"", ""},                                  // Noma'lum
	{httpx.PlatformWeb, httpx.DeviceLinux},    // Veb Linux
	{httpx.PlatformWeb, httpx.DeviceChromeOS}, // Veb ChromeOS
	{httpx.PlatformWeb, ""},                   // Veb — brauzer, lekin OS tanilmagan
}

// platformaTanla — i-hisob uchun ro'yxat va oxirgi platforma/qurilma.
//
// Har 5-hisobda ro'yxat platformasi ataylab boshqacha: "ilovada ro'yxatdan
// o'tib, keyin brauzerga o'tgan" — bu real va batafsil sahifadagi ikkita
// alohida maydonni ("Ro'yxat platformasi" va "Oxirgi platforma") tekshirish
// uchun kerak. Bir xil bo'lsa, ular farq qilishini ko'rib bo'lmasdi.
func platformaTanla(i int) (signupP, signupD, lastP, lastD string) {
	p := platformSeeds[i%len(platformSeeds)]
	if i%5 == 0 {
		return httpx.PlatformAndroid, "", p.Platform, p.Device
	}
	return p.Platform, p.Device, p.Platform, p.Device
}

type catSeed struct {
	Name, Slug, Icon string
	SystemDefault    bool
}

var categories = []catSeed{
	{"Tozalash", "tozalash", "🧹", true},
	{"Yuk tashish", "yuk-tashish", "🚚", true},
	{"Maxsus", "maxsus", "🔧", true},
}

type elonSeed struct {
	Title, Description string
	CategoryName       string
	WorkersNeeded      int
	PricingType        string // per_worker|total|negotiable
	PriceAmount        int64
	Status             string // draft|recruiting|filled|in_progress|completed|cancelled
	// StartsInDays — startDate bugundan necha kun nariga qo'yilishi.
	// Manfiy = vaqti o'tgan e'lon.
	//
	// Ilgari hammasi bugunga (09:00) qo'yilardi — ya'ni soat 15:00 dan keyin
	// (09:00 + 6 soatlik feed grace) seed qilingan BARCHA e'lon vaqti o'tgan
	// bo'lib qolar, feed bo'shab, kategoriya sanoqlari nolga tushardi. Endi
	// ma'lumot ataylab aralash: bir qismi faol, bir qismi o'tgan — feed
	// filtrini va kategoriya sanoqlarini lokal tekshirish uchun.
	StartsInDays int
}

// Faol (recruiting + kelasi kun) e'lonlar kategoriya bo'yicha:
// Yuk tashish — 2, Tozalash — 1, Maxsus — 1.
var elonSeeds = []elonSeed{
	{"Ofis tozalash", "Ofisdagi har kungi umumiy tozalash.", "Tozalash", 2, "per_worker", 90000, "recruiting", 1},
	{"Hovli tozalash", "Katta hovlini yig'ishtirish va xashagini chiqarish.", "Tozalash", 2, "per_worker", 100000, "recruiting", -1},
	{"Deraza yuvish", "Ofisdagi 20 ta derazani tozalash.", "Tozalash", 2, "per_worker", 80000, "completed", -3},
	{"Ta'mirdan keyin tozalash", "Ta'mirdan keyin kvartirani umumiy tozalash.", "Tozalash", 3, "per_worker", 120000, "filled", 1},
	{"Mebel tashishga ishchilar kerak", "3 xonali kvartiradan yangi uyga mebel tashish.", "Yuk tashish", 3, "per_worker", 150000, "recruiting", 1},
	{"Uy ko'chirish", "1 xonali uyni Sergeli tumaniga ko'chirish.", "Yuk tashish", 2, "negotiable", 0, "recruiting", 2},
	{"Yuk mashinada ko'chirish", "Buyumlarni boshqa shaharga olib borish.", "Yuk tashish", 4, "total", 1200000, "completed", -3},
	{"Kuryer kerak (1 kunlik)", "Shahar bo'ylab paket yetkazib berish.", "Yuk tashish", 1, "per_worker", 120000, "in_progress", 0},
	{"Santexnika xizmati", "Hammomdagi kran va lavabo ta'mirlash.", "Maxsus", 1, "total", 250000, "recruiting", 1},
	{"Elektrik xizmati", "Uydagi rozetka va simlarni ta'mirlash.", "Maxsus", 1, "total", 180000, "recruiting", -1},
	{"Mebel yig'ish", "IKEA tipidagi mebellarni yig'ish.", "Maxsus", 2, "per_worker", 120000, "completed", -3},
	{"Devorlarni bo'yash", "Yangi yotoq xonasi devorlarini bo'yash.", "Maxsus", 2, "per_worker", 200000, "filled", 2},
}

func main() {
	reset := flag.Bool("reset", false, "delete existing development data before seeding")
	flag.Parse()

	envfile.Load()
	cfg := config.Load()
	// This command creates synthetic users and can erase whole collections with
	// --reset. Production administration has a separate, narrowly-scoped
	// resetadmin command; never allow the demo seeder against a prod config.
	if cfg.IsProd() {
		log.Fatal("seed is disabled when APP_ENV=production")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	mdb, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo: %v", err)
	}
	if err := db.EnsureIndexes(ctx, mdb); err != nil {
		log.Printf("indexes: %v", err)
	}

	// Safe by default: seeding must never erase a populated database unless the
	// operator explicitly opts in with --reset. Categories are excluded from
	// this guard because the API creates the three system defaults on startup.
	cols := []string{"users", "categories", "elons", "applications", "reviews",
		"notifications", "reports", "feedback",
		"admins", "admin_audit", "otp_codes"}
	if !*reset {
		populated := false
		for _, c := range cols {
			if c == "categories" {
				continue
			}
			n, err := mdb.Collection(c).CountDocuments(ctx, bson.M{}, options.Count().SetLimit(1))
			if err != nil {
				log.Fatalf("check %s: %v", c, err)
			}
			if n > 0 {
				log.Printf("existing data: %s", c)
				populated = true
			}
		}
		if populated {
			log.Fatal("database is not empty; no changes made (use --reset only for a development database)")
		}
	} else {
		for _, c := range cols {
			if _, err := mdb.Collection(c).DeleteMany(ctx, bson.M{}); err != nil {
				log.Fatalf("clear %s: %v", c, err)
			}
		}
	}
	rand.Seed(time.Now().UnixNano())
	now := time.Now()

	// ---- categories ----
	catIDs := map[string]primitive.ObjectID{}
	for _, c := range categories {
		var category models.Category
		err := mdb.Collection("categories").FindOneAndUpdate(
			ctx,
			bson.M{"slug": c.Slug},
			bson.M{
				"$set": bson.M{
					"name": c.Name, "icon": c.Icon,
					"isSystemDefault": c.SystemDefault, "isActive": true,
				},
				"$setOnInsert": bson.M{
					"usageCount": rand.Intn(20), "createdAt": now,
				},
			},
			options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
		).Decode(&category)
		if err != nil {
			log.Printf("category %s: %v", c.Name, err)
			continue
		}
		catIDs[c.Name] = category.ID
	}
	fmt.Printf("categories: %d\n", len(catIDs))

	// ---- users ----
	users := []models.User{}
	for i := 0; i < 18; i++ {
		var fn string
		if i%4 == 0 {
			fn = pick(firstNamesF)
		} else {
			fn = pick(firstNames)
		}
		ln := pick(lastNames)
		reg := regions[i%len(regions)]
		u := models.User{
			ID:                  primitive.NewObjectID(),
			TelegramID:          int64(1000000 + i),
			Phone:               fmt.Sprintf("+998 9%d %03d %02d %02d", 0+(i%5), rand.Intn(1000), rand.Intn(100), rand.Intn(100)),
			FirstName:           fn,
			LastName:            ln,
			Region:              reg.Region,
			District:            reg.District,
			AvatarURL:           "",
			Bio:                 "Tajribali ishchi, Toshkent va atrofdagi viloyatlarda ish bajaraman.",
			Skills:              []string{pick([]string{"Mebel tashish", "Tozalash", "Qurilish", "Santexnika", "Elektr", "Bog'dorchilik"})},
			Rating:              roundTo1(3.5 + rand.Float64()*1.5),
			ReviewsCount:        2 + rand.Intn(15),
			CompletedJobsCount:  1 + rand.Intn(20),
			IsPhoneVerified:     true,
			OnboardingCompleted: true,
			LangPref:            "latin",
			ThemePref:           "light",
			CreatedAt:           now.Add(-time.Duration(rand.Intn(60)) * 24 * time.Hour),
			UpdatedAt:           now,
		}
		users = append(users, u)
	}
	{
		docs := make([]any, len(users))
		for i, u := range users {
			docs[i] = u
		}
		if _, err := mdb.Collection("users").InsertMany(ctx, docs); err != nil {
			log.Printf("users: %v", err)
		}
	}
	fmt.Printf("users: %d\n", len(users))

	// ---- elons ----
	elons := []models.Elon{}
	for i, e := range elonSeeds {
		owner := users[i%len(users)]
		cid, ok := catIDs[e.CategoryName]
		if !ok {
			cid = catIDs["Tozalash"]
		}
		pType := e.PricingType
		per := e.PriceAmount
		total := per * int64(e.WorkersNeeded)
		if pType == "total" {
			total = e.PriceAmount
			if e.WorkersNeeded > 0 {
				per = total / int64(e.WorkersNeeded)
			}
		}
		if pType == "negotiable" {
			per, total = 0, 0
		}
		var publishedAt *time.Time
		if e.Status != "draft" {
			t := now.Add(-time.Duration(rand.Intn(40)) * time.Hour)
			publishedAt = &t
		}
		reg := regions[i%len(regions)]
		el := models.Elon{
			ID:              primitive.NewObjectID(),
			OwnerID:         owner.ID,
			Title:           e.Title,
			CategoryID:      cid,
			CategoryName:    e.CategoryName,
			Description:     e.Description,
			LocationURL:     fmt.Sprintf("https://www.google.com/maps?q=%f,%f", reg.Lat, reg.Lng),
			Lat:             reg.Lat,
			Lng:             reg.Lng,
			Region:          reg.Region,
			District:        reg.District,
			WorkersNeeded:   e.WorkersNeeded,
			PricingType:     pType,
			PriceAmount:     total,
			PerWorkerAmount: per,
			StartDate:       now.AddDate(0, 0, e.StartsInDays).Format("2006-01-02"),
			WorkTimeFrom:    "09:00",
			WorkTimeTo:      "18:00",
			ContactPhone:    owner.Phone,
			Status:          e.Status,
			AcceptedCount:   0,
			PublishedAt:     publishedAt,
			CreatedAt:       now.Add(-time.Duration(rand.Intn(60)) * time.Hour),
			UpdatedAt:       now,
			OwnerName:       owner.FirstName + " " + owner.LastName,
			OwnerRating:     owner.Rating,
		}
		elons = append(elons, el)
	}
	{
		docs := make([]any, len(elons))
		for i, e := range elons {
			docs[i] = e
		}
		if _, err := mdb.Collection("elons").InsertMany(ctx, docs); err != nil {
			log.Printf("elons: %v", err)
		}
		// usageCount already initialized above; nothing else needed.
	}
	fmt.Printf("elons: %d\n", len(elons))

	// ---- applications ----
	apps := []models.Application{}
	statuses := []string{"pending", "accepted", "rejected", "cancelled", "completed", "completed", "pending", "accepted"}
	for i := 0; i < 20; i++ {
		e := elons[i%len(elons)]
		worker := users[(i+3)%len(users)]
		if worker.ID == e.OwnerID {
			worker = users[(i+4)%len(users)]
		}
		st := statuses[i%len(statuses)]
		a := models.Application{
			ID:           primitive.NewObjectID(),
			ElonID:       e.ID,
			ElonTitle:    e.Title,
			WorkerID:     worker.ID,
			EmployerID:   e.OwnerID,
			WorkerPhone:  worker.Phone,
			Amount:       e.PerWorkerAmount,
			IsNegotiable: e.PricingType == "negotiable",
			Status:       st,
			AppliedAt:    now.Add(-time.Duration(rand.Intn(120)) * time.Hour),
		}
		switch st {
		case "completed":
			c := a.AppliedAt.Add(time.Duration(12+rand.Intn(48)) * time.Hour)
			a.DecidedAt = &c
			a.CompletedAt = &c
			a.EmployerConfirmedDone = true
			a.WorkerConfirmedDone = true
		case "accepted":
			d := a.AppliedAt.Add(time.Duration(2+rand.Intn(20)) * time.Hour)
			a.DecidedAt = &d
		case "rejected", "cancelled":
			d := a.AppliedAt.Add(time.Duration(1+rand.Intn(8)) * time.Hour)
			a.DecidedAt = &d
			if st == "cancelled" {
				a.CancelledBy = "worker"
			}
		}
		apps = append(apps, a)
	}
	{
		docs := make([]any, len(apps))
		for i, a := range apps {
			docs[i] = a
		}
		if _, err := mdb.Collection("applications").InsertMany(ctx, docs); err != nil {
			log.Printf("applications: %v", err)
		}
	}
	fmt.Printf("applications: %d\n", len(apps))

	// ---- notifications ----
	notifs := []any{}
	types := []string{"new_application", "application_accepted", "application_rejected",
		"job_completed_request", "job_completed", "system"}
	for i := 0; i < 20; i++ {
		t := types[i%len(types)]
		u := users[i%len(users)]
		notifs = append(notifs, models.Notification{
			UserID: u.ID, Type: t,
			Title:     titleFor(t),
			Body:      "Tafsilotlar uchun bosing.",
			IsRead:    i%3 == 0,
			CreatedAt: now.Add(-time.Duration(rand.Intn(120)) * time.Hour),
		})
	}
	if _, err := mdb.Collection("notifications").InsertMany(ctx, notifs); err != nil {
		log.Printf("notifs: %v", err)
	}
	fmt.Printf("notifications: %d\n", len(notifs))

	// ---- reports ----
	reports := []any{}
	reasons := []string{"Spam", "Yolg'on ma'lumot", "Haqorat", "Mos kelmaydigan kontent", "Boshqa"}
	statusesR := []string{"open", "open", "open", "resolved", "dismissed"}
	for i := 0; i < 16; i++ {
		r := users[i%len(users)]
		t := users[(i+2)%len(users)]
		reports = append(reports, models.Report{
			ReporterID: r.ID, TargetType: "user", TargetID: t.ID,
			Reason: reasons[i%len(reasons)], Description: "Sinov shikoyati.",
			Status: statusesR[i%len(statusesR)], CreatedAt: now.Add(-time.Duration(rand.Intn(240)) * time.Hour),
		})
	}
	if _, err := mdb.Collection("reports").InsertMany(ctx, reports); err != nil {
		log.Printf("reports: %v", err)
	}
	fmt.Printf("reports: %d\n", len(reports))

	// ---- feedback (taklif va shikoyatlar) ----
	feedbacks := []any{}
	fbSamples := []struct {
		Type, Subject, Message string
	}{
		{"suggestion", "Xarita qulayligi", "Ish joyini xaritadan tanlash juda qulay bo'libdi, rahmat!"},
		{"complaint", "Bildirishnoma ko'p", "Ba'zida bir xil bildirishnoma ikki marta keladi."},
		{"suggestion", "To'lov tarixi", "To'lovlar tarixini PDF qilib yuklab olish imkoni bo'lsa yaxshi bo'lardi."},
		{"suggestion", "Til", "Qoraqalpoq tili ham qo'shilsa zo'r bo'lardi."},
		{"complaint", "Qidiruv", "Qidiruvda viloyat bo'yicha filtr yetishmayapti."},
		{"suggestion", "Reyting", "Ishchi va ish beruvchi reytingi alohida ko'rsatilsa aniqroq bo'ladi."},
	}
	for i, s := range fbSamples {
		u := users[i%len(users)]
		status := "open"
		if i%3 == 0 {
			status = "resolved"
		}
		feedbacks = append(feedbacks, models.Feedback{
			UserID: u.ID, UserName: u.FirstName + " " + u.LastName, UserPhone: u.Phone,
			Type: s.Type, Subject: s.Subject, Message: s.Message, Status: status,
			CreatedAt: now.Add(-time.Duration(rand.Intn(200)) * time.Hour),
		})
	}
	if _, err := mdb.Collection("feedback").InsertMany(ctx, feedbacks); err != nil {
		log.Printf("feedback: %v", err)
	}
	fmt.Printf("feedback: %d\n", len(feedbacks))

	// ---- admins ----
	admins := []models.Admin{}
	pw, _ := bcrypt.GenerateFromPassword([]byte(cfg.AdminSeedPass), bcrypt.DefaultCost)
	admins = append(admins, models.Admin{
		Username: cfg.AdminSeedUser, PasswordHash: string(pw),
		Role: "superadmin", IsActive: true, CreatedAt: now,
	})
	pw2, _ := bcrypt.GenerateFromPassword([]byte("Moder123!"), bcrypt.DefaultCost)
	admins = append(admins, models.Admin{
		Username: "moderator", PasswordHash: string(pw2),
		Role: "moderator", IsActive: true, CreatedAt: now,
	})
	for _, a := range admins {
		_, err := mdb.Collection("admins").InsertOne(ctx, a)
		if err != nil && !mongo.IsDuplicateKeyError(err) {
			log.Printf("admin %s: %v", a.Username, err)
		}
	}
	fmt.Printf("admins: %d\n", len(admins))

	fmt.Println("seed done")
}

func pick(s []string) string { return s[rand.Intn(len(s))] }

func roundTo1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

func titleFor(t string) string {
	switch t {
	case "new_application":
		return "Yangi ariza"
	case "application_accepted":
		return "Arizangiz qabul qilindi"
	case "application_rejected":
		return "Arizangiz rad etildi"
	case "job_completed_request":
		return "Tasdiqlash so'rovi"
	case "job_completed":
		return "Ish yakunlandi"
	case "new_review":
		return "Yangi baho"
	case "system":
		return "Tizim xabari"
	}
	return "Bildirishnoma"
}
