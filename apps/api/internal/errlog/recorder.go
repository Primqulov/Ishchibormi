package errlog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/ishchibormi/backend/internal/models"
	"github.com/ishchibormi/backend/pkg/tgsend"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Sozlamalar. Hammasi ataylab qattiq yozilgan: bular xatolik jurnalining
// o'zini himoya qiladigan chegaralar, ular ENV orqali o'zgartirilmasligi
// kerak — noto'g'ri qiymat butun bazani ko'chkiga ochib qo'yadi.
const (
	// bufSize — navbat sig'imi. To'lsa, yangi hodisalar JIMGINA tashlanadi:
	// xatolik jurnalining o'zi so'rovni sekinlashtirishi yoki xotirani
	// yeb qo'yishi mumkin emas.
	bufSize = 2048
	// flushEvery — yig'ish oynasi. Shu oyna ichidagi bir xil fingerprint
	// bitta yozuvga birlashadi.
	flushEvery = 3 * time.Second
	// maxGroupsPerFlush — bitta oynada nechta turli fingerprint yoziladi.
	// Chegara — "xatolik portlashi" paytida Mongo'ni himoya qilish uchun.
	maxGroupsPerFlush = 200
	// maxUserHashes — guruhda saqlanadigan noyob foydalanuvchi hash'lari
	// chegarasi. Undan keyin usersCount o'sishdan to'xtaydi ("500+").
	maxUserHashes = 500
	// alertGap — bitta guruh bo'yicha ogohlantirishlar orasidagi eng kam
	// vaqt. Bitta uzluksiz nosozlik tunda 500 ta Telegram xabari
	// yubormasligi kerak — aks holda ogohlantirish o'qilmay qoladi.
	alertGap = 15 * time.Minute
	// alertBudget — soatiga jami ogohlantirishlar soni (barcha guruhlar).
	alertBudget = 20
	// highAlertAt — "Yuqori" daraja necha hodisadan keyin eslatilishi
	// (Figma 3.12.2 · G · Bildirishnomalar: ">10 hodisa to'planganda").
	highAlertAt = 10
	// maxSamples — bitta guruhda saqlanadigan TO'LIQ namunalar soni
	// (stek, qadamlar, qurilma). Batafsil ko'rinishga 20 tasi ortig'i
	// bilan yetadi; cheklovsiz bo'lsa, sekundiga ming marta takrorlanadigan
	// bitta xatolik bazani stek izlari bilan to'ldirib yuborardi.
	maxSamples = 20
	// samplePruneEvery — necha namunadan keyin ortiqchasi tozalanadi.
	// Har yozuvda tozalash keraksiz: chegara 20 emas, 20…30 oralig'ida
	// suzib yursa ham hech narsa buzilmaydi.
	samplePruneEvery = 10
	// maxActivity — guruh yonidagi tasma uzunligi (catalog.go da eksport
	// qilingan: panel handlerlari ham AYNI shu chegarani qo'llaydi, aks
	// holda tarix ikki xil uzunlikda kesilardi).
	maxActivity = MaxActivity
	// maxStackLines / maxStepCount — mijozdan keladigan diagnostika
	// chegaralari. Ikkalasi ham TASHQI ma'lumot.
	maxStackLines = 30
	maxStackLine  = 200
	maxStepCount  = 20
	maxStepText   = 140
	// counterCap — xotiradagi yordamchi hisoblagichlar chegarasi. Jarayon
	// uzoq ishlaganda turli fingerprint'lar soni cheksiz o'smasligi kerak.
	counterCap = 10_000
)

// Event — yozishga topshiriladigan hodisa. Faqat Code majburiy; qolgani
// bo'lsa yaxshi, bo'lmasa ham hodisa yo'qolmaydi.
type Event struct {
	Code string
	// Where — "fayl.funksiya" yoki "paket.Funksiya". Fingerprintning bir
	// qismi: bir xil kod turli joyda chiqsa, ular alohida guruh bo'ladi.
	Where   string
	Message string
	Method  string
	Path    string
	Status  int
	// UserID — guruh va hodisa darajasida xom holda YOZILMAYDI, faqat
	// hash'lanadi. Namunada (ErrorSample) esa ObjectID bo'lib saqlanadi —
	// sabab va chegaralar models.ErrorSample izohida.
	UserID string
	// IsAdmin — UserID admin id'simi. Namunada ular alohida maydonlarga
	// tushadi: admin ilovasi xatosini foydalanuvchi xatosidan ajratish
	// "kim duch keldi" panelining butun ma'nosi.
	IsAdmin    bool
	Platform   string
	AppVersion string
	Origin     Origin
	At         time.Time

	// ── Batafsil ko'rinish uchun (Figma 3.12.1 va 3.12.3) ───────────────
	// Device — X-Client-Device / User-Agent dan tozalab olingan qurilma.
	Device models.ErrorDevice
	// Stack — stek izi qatorlari. Mijozdan kelsa Text() dan o'tkaziladi.
	Stack []string
	// Steps — xatolikdan oldingi qadamlar (breadcrumbs).
	Steps []models.ErrorStep
	// RequestID — so'rov identifikatori (chi middleware.RequestID).
	RequestID string
	// DurationMs — so'rov qancha davom etdi.
	DurationMs int
}

type key struct {
	fp   string
	code string
}

type bucket struct {
	ev    Event
	n     int
	users map[string]struct{}
	// sample — oynadagi ENG BOY hodisa (steki va qadamlari borrog'i).
	// Oynaga bitta namuna yoziladi: 3 soniyada ming marta takrorlangan
	// xatolik ming dona bir xil stek izini qoldirmasligi kerak.
	sample Event
}

// Recorder — asinxron, "best-effort" yozuvchi.
//
// # NEGA ASINXRON
//
// Xatolikni yozish so'rov yo'lida turmasligi kerak. Aks holda MongoDB
// sekinlashgan paytda har bir 500 javob yana bitta sekin Mongo yozuvini
// kutadi — ya'ni nosozlik o'zini o'zi kuchaytiradi. Shu sababli Record()
// hech qachon bloklanmaydi, xato qaytarmaydi va navbat to'lsa hodisani
// jimgina tashlaydi.
type Recorder struct {
	groups  *mongo.Collection
	events  *mongo.Collection
	samples *mongo.Collection
	log     *slog.Logger
	tg      *tgsend.Client
	chatID  int64
	// salt — foydalanuvchi ID hash'i uchun. Sirdan hosil qilinadi, ya'ni
	// hash'ni lug'at bo'yicha qaytarib bo'lmaydi (ID'lar to'plami kichik).
	salt []byte

	ch   chan Event
	done chan struct{}
	once sync.Once

	mu        sync.Mutex
	dropped   int64
	knownUsrs map[string]int // fingerprint → saqlangan hash'lar soni
	sampleN   map[string]int // fingerprint → yozilgan namunalar sanog'i
	alerts    []time.Time    // oxirgi soatdagi ogohlantirishlar
}

// New — yozuvchini yaratadi va fon oqimini ishga tushiradi.
// db nil bo'lsa (testlar) Recorder baribir ishlaydi: hodisalar shunchaki
// hech qayerga yozilmaydi.
func New(db *mongo.Database, lg *slog.Logger, tg *tgsend.Client, chatID int64, secret string) *Recorder {
	sum := sha256.Sum256([]byte("errlog:v1:" + secret))
	r := &Recorder{
		log:       lg,
		tg:        tg,
		chatID:    chatID,
		salt:      sum[:],
		ch:        make(chan Event, bufSize),
		done:      make(chan struct{}),
		knownUsrs: map[string]int{},
		sampleN:   map[string]int{},
	}
	if db != nil {
		r.groups = db.Collection("error_groups")
		r.events = db.Collection("error_events")
		r.samples = db.Collection("error_samples")
	}
	go r.loop()
	return r
}

// Record — hodisani navbatga qo'yadi. Bloklanmaydi.
//
// Katalogda yo'q kod jimgina tashlanadi: "Xatoliklar" sahifasi yopiq
// ro'yxat bilan ishlaydi (catalog.go), begona kod u yerda darajasiz va
// tarjimasiz qator bo'lib chiqardi.
func (r *Recorder) Record(e Event) {
	if r == nil {
		return
	}
	if _, ok := Catalog[e.Code]; !ok {
		return
	}
	if e.At.IsZero() {
		e.At = time.Now()
	}
	select {
	case r.ch <- e:
	default:
		// Navbat to'la — hodisa yo'qoladi. Bu ataylab: jurnal to'lib
		// qolgani xizmatni to'xtatishga sabab emas.
		r.mu.Lock()
		r.dropped++
		r.mu.Unlock()
	}
}

// Close — navbatni yopadi va qolgan hodisalarni yozib tugatadi.
func (r *Recorder) Close(ctx context.Context) {
	if r == nil {
		return
	}
	r.once.Do(func() { close(r.ch) })
	select {
	case <-r.done:
	case <-ctx.Done():
	}
}

func (r *Recorder) loop() {
	defer close(r.done)
	// Fon goroutine'idagi panic butun jarayonni o'ldiradi — xatolik
	// yozuvchisining o'zi shunday qilishi mumkin emas.
	defer func() {
		if rec := recover(); rec != nil && r.log != nil {
			r.log.Error("errlog recorder panic", "err", rec)
		}
	}()

	t := time.NewTicker(flushEvery)
	defer t.Stop()
	pend := map[key]*bucket{}

	for {
		select {
		case e, ok := <-r.ch:
			if !ok {
				r.flush(pend)
				return
			}
			r.collect(pend, e)
		case <-t.C:
			if len(pend) > 0 {
				r.flush(pend)
				pend = map[key]*bucket{}
			}
			r.reportDrops()
		}
	}
}

func (r *Recorder) collect(pend map[key]*bucket, e Event) {
	e.Message = Text(e.Message)
	e.Where = Clip(Text(e.Where), MaxWhere)
	e.Path = Path(e.Path)
	e.Platform = Clip(Text(e.Platform), 32)
	e.AppVersion = Clip(Text(e.AppVersion), 32)
	e.RequestID = Clip(Text(e.RequestID), 64)
	e.Stack = cleanStack(e.Stack)
	e.Steps = cleanSteps(e.Steps)
	if e.DurationMs < 0 {
		e.DurationMs = 0
	}

	k := key{fp: Fingerprint(e.Code, e.Where, e.Path), code: e.Code}
	b := pend[k]
	if b == nil {
		if len(pend) >= maxGroupsPerFlush {
			r.mu.Lock()
			r.dropped++
			r.mu.Unlock()
			return
		}
		b = &bucket{ev: e, users: map[string]struct{}{}, sample: e}
		pend[k] = b
	}
	b.n++
	// Oxirgi hodisa vaqti — eng yangisi.
	if e.At.After(b.ev.At) {
		b.ev.At = e.At
	}
	// Ishonchli manba oynadagi ishonchsizidan ustun: ogohlantirish qarori
	// shunga qarab qabul qilinadi.
	if e.Origin < b.ev.Origin {
		b.ev.Origin = e.Origin
	}
	if h := r.userHash(e.UserID); h != "" {
		b.users[h] = struct{}{}
	}
	if richer(e, b.sample) {
		b.sample = e
	}
}

// richer — namuna uchun qaysi hodisa foydaliroq. Stek va qadamlar bor
// hodisa har doim ustun: aynan ular batafsil ko'rinishni to'ldiradi.
func richer(a, b Event) bool {
	score := func(e Event) int {
		n := 0
		if len(e.Stack) > 0 {
			n += 4
		}
		if len(e.Steps) > 0 {
			n += 2
		}
		if e.Device.Model != "" || e.Device.Browser != "" {
			n++
		}
		return n
	}
	sa, sb := score(a), score(b)
	if sa != sb {
		return sa > sb
	}
	// Teng bo'lsa — yangirog'i.
	return a.At.After(b.At)
}

// cleanStack — stek izini tozalaydi va cheklaydi. Har bir qator Text() dan
// o'tadi: Flutter steki ichida so'rov qiymatlari (token, telefon) uchrashi
// odatiy hol.
func cleanStack(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, maxStackLines)
	for _, ln := range in {
		ln = Clip(Text(ln), maxStackLine)
		if ln == "" {
			continue
		}
		out = append(out, ln)
		if len(out) >= maxStackLines {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// stepKinds — qadam turlarining yopiq ro'yxati (Figma 3.12.3 · I).
// Notanish tur "action" ga tushadi: panel har bir turga o'z rangi va
// belgisini beradi, begona satr esa u yerda uslubsiz qolardi.
var stepKinds = map[string]bool{
	"nav": true, "screen": true, "action": true,
	"request": true, "response": true, "crash": true,
}

func cleanSteps(in []models.ErrorStep) []models.ErrorStep {
	if len(in) == 0 {
		return nil
	}
	// Oxirgi maxStepCount tasi — xatolikka eng yaqinlari.
	if len(in) > maxStepCount {
		in = in[len(in)-maxStepCount:]
	}
	out := make([]models.ErrorStep, 0, len(in))
	for _, s := range in {
		s.Text = Clip(Text(s.Text), maxStepText)
		if s.Text == "" {
			continue
		}
		if !stepKinds[s.Kind] {
			s.Kind = "action"
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (r *Recorder) flush(pend map[key]*bucket) {
	if r.groups == nil || len(pend) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for k, b := range pend {
		r.write(ctx, k.fp, b)
	}
}

// write — bitta fingerprint uchun guruhni yangilaydi va yig'ma hodisani
// yozadi.
func (r *Recorder) write(ctx context.Context, fp string, b *bucket) {
	t, ok := Catalog[b.ev.Code]
	if !ok {
		return
	}
	now := b.ev.At

	// `severity` bu yerda ATAYLAB yo'q: uni holat belgilaydi (regressiya
	// darajani bir pog'ona ko'taradi). Katalogdagi asl qiymat
	// `baseSeverity` bo'lib yuradi va quyidagi ikkinchi yangilanish
	// ikkovini muvofiqlashtiradi.
	set := bson.M{
		"code":         b.ev.Code,
		"module":       t.Module,
		"baseSeverity": t.Severity,
		"runtime":      t.Runtime,
		"title":        t.Title,
		"lastSeenAt":   now,
	}
	// Bo'sh qiymat mavjudini o'chirmasin: birinchi hodisada `where` bo'lib,
	// keyingisida bo'lmasligi mumkin.
	if b.ev.Where != "" {
		set["where"] = b.ev.Where
	}
	if b.ev.Message != "" {
		set["message"] = b.ev.Message
	}
	if b.ev.Path != "" {
		set["path"] = b.ev.Path
	}
	// Ro'yxatdagi "Qurilma" va "Ilova versiyasi" ustunlari (Figma 3.12.3 · N).
	// Ular oynadagi eng boy namunadan olinadi — o'sha namunaning o'zi
	// batafsil ekranda ko'rinadigan hodisa bo'ladi, ya'ni ro'yxat va
	// batafsil ko'rinish bir xil qurilmani ko'rsatadi.
	if d := DeviceLabel(b.sample.Device); d != "" {
		set["lastDevice"] = d
	}
	if v := AppVersionLabel(b.sample.Device, b.ev.AppVersion); v != "" {
		set["lastAppVersion"] = v
	}

	upd := bson.M{
		"$set": set,
		"$inc": bson.M{"count": int64(b.n)},
		"$setOnInsert": bson.M{
			"fingerprint": fp,
			"ref":         Ref(fp),
			"status":      StatusNew,
			"severity":    t.Severity,
			"sevRank":     SeverityRank[t.Severity],
			"firstSeenAt": now,
			"usersCount":  int64(0),
		},
	}
	// Hash'lar chegaraga yetgan guruhga yangi hash qo'shmaymiz: hujjat
	// cheksiz o'smasligi kerak (Figma · G · "hajm chegarasi").
	r.mu.Lock()
	known := r.knownUsrs[fp]
	r.mu.Unlock()
	if len(b.users) > 0 && known < maxUserHashes {
		hs := make([]string, 0, len(b.users))
		for h := range b.users {
			hs = append(hs, h)
		}
		upd["$addToSet"] = bson.M{"userHashes": bson.M{"$each": hs}}
	}

	var g models.ErrorGroup
	err := r.groups.FindOneAndUpdate(ctx, bson.M{"fingerprint": fp}, upd,
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&g)
	if err != nil {
		if r.log != nil {
			r.log.Error("errlog group upsert", "err", err, "code", b.ev.Code)
		}
		return
	}

	// Ikkinchi (shartli) yangilanish: usersCount, regressiya va daraja.
	fix := bson.M{}
	if n := int64(len(g.UserHashes)); n != g.UsersCount {
		fix["usersCount"] = n
		r.mu.Lock()
		r.knownUsrs[fp] = len(g.UserHashes)
		r.mu.Unlock()
	}

	// Figma 3.12.3 · J: "Bartaraf etildi" holatidagi xatolik qayta
	// takrorlansa REGRESSIYA bo'ladi — "Yangi" emas.
	//
	// Farqi muhim: yangi xatolikni hech kim ko'rmagan, regressiya esa
	// tuzatilgan deb yopilgan va shu sababli endi hech kim kuzatmayapti.
	// Shuning uchun u alohida nishon oladi va darajasi bir pog'ona
	// ko'tariladi. "E'tiborsiz" holati esa qaytmaydi — u ongli qaror,
	// aks holda e'tiborsiz qoldirishning ma'nosi yo'qolardi.
	regressed := false
	if g.Status == StatusResolved {
		regressed = true
		fix["status"] = StatusRegressed
		fix["reopenedAt"] = now
		// resolvedAt / fixedVersion ATAYLAB o'chirilmaydi: "qaysi versiyada
		// yopilgan edi" savoliga javob aynan o'sha maydonlarda qoladi.
		g.Status = StatusRegressed
	}

	// Amaldagi daraja: regressiyada ko'tarilgan, qolgan hollarda katalogniki.
	eff := t.Severity
	if g.Status == StatusRegressed {
		eff = BumpSeverity(t.Severity)
	}
	if g.Severity != eff {
		fix["severity"] = eff
		fix["sevRank"] = SeverityRank[eff]
		g.Severity = eff
	}

	if len(fix) > 0 {
		upd2 := bson.M{"$set": fix}
		if regressed {
			// Tasmaga tizim yozuvi: kim yopgani va nima qaytgani ko'rinib
			// tursin (aktyor bo'sh => tizim).
			line := "Qayta paydo bo'ldi (regressiya) — daraja " + eff + " ga ko'tarildi"
			if g.FixedVersion != "" {
				line += " · avval " + g.FixedVersion + " da yopilgan edi"
			}
			upd2["$push"] = bson.M{"activity": bson.M{
				"$each":  bson.A{models.ErrorActivity{Kind: "regressed", Text: Clip(line, MaxNote), At: now}},
				"$slice": -maxActivity,
			}}
		}
		if _, err := r.groups.UpdateOne(ctx, bson.M{"_id": g.ID}, upd2); err != nil && r.log != nil {
			r.log.Error("errlog group fix", "err", err)
		}
	}

	// Yig'ma hodisa: oyna ichidagi n ta takrorlanish uchun bitta hujjat.
	if r.events != nil {
		var uh string
		for h := range b.users {
			uh = h
			break
		}
		_, err := r.events.InsertOne(ctx, models.ErrorEvent{
			Fingerprint: fp,
			Code:        b.ev.Code,
			Severity:    t.Severity,
			Module:      t.Module,
			Where:       b.ev.Where,
			Message:     b.ev.Message,
			Method:      b.ev.Method,
			Path:        b.ev.Path,
			Status:      b.ev.Status,
			N:           b.n,
			UserHash:    uh,
			Platform:    firstNonEmpty(b.sample.Device.Platform, b.ev.Platform),
			AppVersion:  firstNonEmpty(b.sample.Device.AppVersion, b.ev.AppVersion),
			Brand:       b.sample.Device.Brand,
			OS:          strings.TrimSpace(b.sample.Device.OS + " " + b.sample.Device.OSVersion),
			At:          now,
		})
		if err != nil && r.log != nil {
			r.log.Error("errlog event insert", "err", err)
		}
	}

	r.writeSample(ctx, fp, b)
	r.maybeAlert(ctx, &g, b.ev.Origin, now)
}

// writeSample — oynadagi eng boy hodisani to'liq namuna sifatida yozadi
// (Figma 3.12.1 · "So'nggi hodisalar", 3.12.3 · H va I).
func (r *Recorder) writeSample(ctx context.Context, fp string, b *bucket) {
	if r.samples == nil {
		return
	}
	e := b.sample
	s := models.ErrorSample{
		Fingerprint: fp,
		Code:        e.Code,
		At:          e.At,
		Method:      e.Method,
		Path:        Path(e.Path),
		Status:      e.Status,
		DurationMs:  e.DurationMs,
		RequestID:   e.RequestID,
		UserHash:    r.userHash(e.UserID),
		Device:      e.Device,
		Message:     e.Message,
		Stack:       e.Stack,
		Steps:       e.Steps,
	}
	// Qurilma bo'sh bo'lsa — hech bo'lmasa platforma va versiya qolsin:
	// "So'nggi hodisalar" jadvalining ikkita ustuni aynan shular.
	if s.Device.Platform == "" {
		s.Device.Platform = e.Platform
	}
	if s.Device.AppVersion == "" {
		s.Device.AppVersion = e.AppVersion
	}
	if oid, err := primitive.ObjectIDFromHex(e.UserID); err == nil {
		if e.IsAdmin {
			s.AdminID = oid
		} else {
			s.UserID = oid
		}
	}
	if _, err := r.samples.InsertOne(ctx, s); err != nil {
		if r.log != nil {
			r.log.Error("errlog sample insert", "err", err)
		}
		return
	}

	r.mu.Lock()
	if len(r.sampleN) > counterCap {
		r.sampleN = map[string]int{}
	}
	r.sampleN[fp]++
	due := r.sampleN[fp]%samplePruneEvery == 0
	r.mu.Unlock()
	if due {
		r.pruneSamples(ctx, fp)
	}
}

// pruneSamples — guruhda maxSamples tadan ortiq namuna qolmasin.
// TTL indeksi (30 kun) faqat VAQT bo'yicha cheklaydi; bu esa HAJM bo'yicha:
// tinimsiz takrorlanadigan bitta xatolik 30 kun ichida ham o'n minglab
// stek izini qoldira olardi.
func (r *Recorder) pruneSamples(ctx context.Context, fp string) {
	cur, err := r.samples.Find(ctx, bson.M{"fingerprint": fp},
		options.Find().
			SetSort(bson.D{{Key: "at", Value: -1}}).
			SetSkip(maxSamples).
			SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return
	}
	defer cur.Close(ctx)
	var ids []primitive.ObjectID
	for cur.Next(ctx) {
		var row struct {
			ID primitive.ObjectID `bson:"_id"`
		}
		if cur.Decode(&row) == nil {
			ids = append(ids, row.ID)
		}
	}
	if len(ids) > 0 {
		_, _ = r.samples.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": ids}})
	}
}

// maybeAlert — Figma 3.12.2 · A va G dagi bildirishnoma qoidasi:
// Kritik → darhol, Yuqori → 10 hodisadan keyin, O'rta/Past → faqat panelda.
//
// # NEGA ISHONCHSIZ MANBA OGOHLANTIRMAYDI
//
// Kritik kodlarning bir qismi (flutter.uncaught_exception, auth_bounce_loop)
// mijozdan keladi. Agar har bir mijoz xabari Telegram'ga chiqsa,
// autentifikatsiyalangan har qanday foydalanuvchi tugmani bosib turib
// jamoani tunda uyg'otishi mumkin bo'lardi — arzon va shovqinli hujum.
// Shuning uchun panelda hammasi ko'rinadi, jiringlatadigani esa faqat
// serverning o'zi va admin ilovasi yozganlari.
func (r *Recorder) maybeAlert(ctx context.Context, g *models.ErrorGroup, origin Origin, now time.Time) {
	if r.tg == nil || !r.tg.Configured() || r.chatID == 0 {
		return
	}
	if origin == OriginClient {
		return
	}
	if g.Status == StatusIgnored || g.Status == StatusResolved {
		return
	}
	switch g.Severity {
	case SevCritical:
	case SevHigh:
		if g.Count < highAlertAt {
			return
		}
		// Keyingi eslatma — yana 10 hodisadan keyin.
		if g.AlertedCount > 0 && g.Count < g.AlertedCount+highAlertAt {
			return
		}
	default:
		return
	}
	if g.AlertedAt != nil && now.Sub(*g.AlertedAt) < alertGap {
		return
	}
	if !r.takeBudget(now) {
		return
	}

	sev := map[string]string{SevCritical: "🔴 KRITIK", SevHigh: "🟠 Yuqori"}[g.Severity]
	var b strings.Builder
	if g.Status == StatusRegressed {
		// Regressiya alohida belgilanadi: "yopilgan edi, qaytdi" — bu
		// yangi nosozlikdan boshqacha, chunki uni hech kim kutmayapti.
		b.WriteString("<b>♻️ QAYTA PAYDO BO'LDI · " + sev + "</b>\n")
	} else {
		b.WriteString("<b>" + sev + " xatolik</b>\n")
	}
	b.WriteString(tgsend.EscapeHTML(g.Title) + "\n")
	b.WriteString("<code>" + tgsend.EscapeHTML(g.Code) + "</code>")
	if g.Where != "" {
		b.WriteString(" · " + tgsend.EscapeHTML(g.Where))
	}
	b.WriteString("\n" + tgsend.EscapeHTML(g.Ref))
	b.WriteString(" · hodisalar: " + itoa(g.Count))
	if g.UsersCount > 0 {
		b.WriteString(" · foydalanuvchi: " + itoa(g.UsersCount))
	}
	if g.Assignee != "" {
		// Mas'ul biriktirilgan bo'lsa u xabarda ko'rinadi — ayniqsa
		// regressiyada: xatolikni yopgan odam uning qaytganini bilishi kerak.
		b.WriteString("\nMas'ul: " + tgsend.EscapeHTML(g.Assignee))
	}
	if g.Message != "" {
		b.WriteString("\n<i>" + tgsend.EscapeHTML(Clip(g.Message, 200)) + "</i>")
	}

	if err := r.tg.SendHTML(ctx, r.chatID, b.String()); err != nil {
		if r.log != nil {
			r.log.Warn("errlog telegram alert", "err", err, "ref", g.Ref)
		}
		return
	}
	_, _ = r.groups.UpdateOne(ctx, bson.M{"_id": g.ID},
		bson.M{"$set": bson.M{"alertedAt": now, "alertedCount": g.Count}})
}

// takeBudget — soatiga alertBudget ta xabar. Chegara global: yuzta turli
// xatolik bir vaqtda portlasa ham chat o'qib bo'lmas holga kelmaydi.
func (r *Recorder) takeBudget(now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	cut := now.Add(-time.Hour)
	kept := r.alerts[:0]
	for _, t := range r.alerts {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	r.alerts = kept
	if len(r.alerts) >= alertBudget {
		return false
	}
	r.alerts = append(r.alerts, now)
	return true
}

func (r *Recorder) reportDrops() {
	r.mu.Lock()
	n := r.dropped
	r.dropped = 0
	r.mu.Unlock()
	if n > 0 && r.log != nil {
		r.log.Warn("errlog navbati to'ldi — hodisalar tashlandi", "count", n)
	}
}

// userHash — foydalanuvchi ID'sini qaytarib bo'lmaydigan qiymatga
// aylantiradi. Sir bilan tuzlanadi: ID'lar to'plami kichik (ObjectID)
// bo'lgani uchun tuzsiz hash lug'at hujumiga ochiq bo'lardi.
func (r *Recorder) userHash(id string) string {
	if id == "" {
		return ""
	}
	h := sha256.New()
	h.Write(r.salt)
	h.Write([]byte(id))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// Fingerprint — guruhlash kaliti (Figma · G: "bir xil kod + fayl + qator").
// Yo'l ham kiradi: `internal` xatosi har bir endpoint uchun alohida
// muammo, ularni bitta qatorga qo'shish diagnostikani yo'qotardi.
func Fingerprint(code, where, path string) string {
	h := sha256.Sum256([]byte(code + "|" + where + "|" + path))
	return hex.EncodeToString(h[:])[:16]
}

// Ref — panelda ko'rinadigan qisqa yorliq (ERR-2F91C4). Fingerprint'dan
// hosil bo'ladi, ya'ni guruh o'chib qayta yaratilsa ham o'zgarmaydi.
func Ref(fp string) string {
	if len(fp) < 6 {
		return "ERR-" + strings.ToUpper(fp)
	}
	return "ERR-" + strings.ToUpper(fp[:6])
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
