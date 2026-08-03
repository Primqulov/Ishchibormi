# Ishchi Bormi — Telegram Mini App

`@Ishchibormibot` ichida ochiladigan, telefon uchun mo'ljallangan ilova.
Dizayni veb sayt bilan bir xil (Figma "Ishchi Bormi — Web Dizayn"), ma'lumotni
esa mavjud API'dan oladi — yangi baza ham, parallel biznes-mantiq ham yo'q.

---

## 1. Tuzilma

```
apps/
├── bots/miniapp/   # Go — /start va Mini App tugmasi. Bazaga TEGMAYDI.
│   └── cmd/bot/main.go
└── miniapp/        # Vite + React + TS + Tailwind — ilovaning o'zi
    └── src/
        ├── lib/        telegram.ts · api.ts · format.ts · cat-color.ts
        │               leaflet.ts (dinamik) · cluster.ts
        ├── components/ JobCard · TabBar · LocationPicker · ui · icons
        └── screens/    Feed · MapView · JobDetail · MyApplications
                        PostJob · MyElons · Notifications
                        Profile · ProfileEdit · History · Register
```

Navigatsiya ikki qavatli: pastda to'rt tab (**Ishlar · Arizalarim ·
Xabarlar · Profil**) va o'rtada ko'tarilgan **E'lon** tugmasi; ustida esa
overlay steki (e'lon tafsiloti, e'lon berish, profil tahriri, ...). Tuzilishi
mobil ilovanikidan ko'chirilgan (`flutter-app` →
`core/widgets/app_bottom_nav_bar.dart`) — bir mahsulotning ikki klienti bir
xil amalni bir xil joydan taklif qilishi kerak.

Servislar ildizdagi `docker-compose.yml` da, `miniapp` **profili** ortida —
`docker compose up` ularni ko'tarmaydi (Mini App hali prod'ga chiqarilmagan).
`.env` ham bitta: repo ildizida, backend bilan umumiy.

Kirish (`initData` tekshiruvi) esa **backend'da**:
`apps/api/internal/auth/webapp.go` → `POST /api/auth/telegram/webapp`.
Nima uchun u yerda — 4-bo'limga qarang.

---

## 2. Kirish qanday ishlaydi

| Kim | Nima bo'ladi |
|---|---|
| **Qaytgan foydalanuvchi** | Ilova ochiladi → `initData` backend'ga yuboriladi → imzo tekshiriladi → JWT. Hech narsa bosilmaydi, kod kiritilmaydi. |
| **Yangi foydalanuvchi** | Backend `409 need_contact` qaytaradi → `Register` ekrani → OTP botiga o'tadi → kontakt ulashadi → 6 xonali kod → ichkarida. Keyingi kirishlar avtomatik. |

Ikkinchi qator nega kerak: Telegram `initData` **telefon raqamini bermaydi**,
platformada esa telefon majburiy (ish beruvchi ishchi bilan bog'lanishi kerak).
Shu bitta holat uchun yangi mexanizm yozilmagan — saytda va mobil ilovada
ishlab turgan OTP oqimi qayta ishlatiladi.

### `initData` imzosi

Telegram beradigan `initData` botning tokeni bilan imzolangan. Backend uni
qayta hisoblab solishtiradi (`hmac.Equal` — doimiy vaqtda) va `auth_date`
yoshini tekshiradi (standart 24 soat, replay'ga qarshi).

> **Muhim:** imzo Mini App **qaysi botda ochilsa, o'sha botning tokeni** bilan
> hisoblanadi. Backend (imzoni tekshiradi) va bot (oynani ochadi) shuning
> uchun bir xil `TELEGRAM_MINIAPP_BOT_TOKEN` ni ko'rishi shart — aks holda
> har bir kirish 401 bo'ladi. Ikkovi ildizdagi bitta `.env` dan o'qigani
> uchun bu endi tuzilma darajasida kafolatlangan.

---

## 3. Ishga tushirish (lokal + tunnel)

Telegram Mini App uchun **HTTPS** manzil talab qiladi, shuning uchun lokal
ishlashda tunnel kerak.

### 3.1 `.env` ni tayyorlash

Repo ildizidagi **bitta** `.env` (backend ham, bot ham shundan o'qiydi):

```
TELEGRAM_MINIAPP_BOT_TOKEN=<@Ishchibormibot tokeni>
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://<tunnel>
```

> Ilgari Mini App alohida papkada, alohida `.env` bilan turgani uchun token
> ikki joyda qo'lda mos qilinardi — mos kelmasa har bir kirish 401 bo'lardi.
> Endi manba bitta, bu xato sinfi yo'q.

`CORS_ORIGINS` ni unutmang — Mini App boshqa origin'dan so'rov yuboradi va
allowlist'da bo'lmasa brauzer so'rovni to'sib qo'yadi. (`make dev` /
`make miniapp` localhost:5173 ni allaqachon qo'shadi — tunnel manzilini
qo'lda qo'shasiz.)

### 3.2 Ishga tushirish

Webapp:

```bash
cd apps/miniapp && npm install && npm run dev     # http://localhost:5173
```

Boshqa terminalda tunnel oching:

```bash
cloudflared tunnel --url http://localhost:5173
# yoki:  ngrok http 5173
```

Chiqqan HTTPS manzilni **uch joyga** qo'ying:

1. `.env` → `MINIAPP_URL=https://...`
2. `.env` → `CORS_ORIGINS` ga qo'shing va backend'ni qayta ishga tushiring
3. @BotFather → `/setmenubutton` → botni tanlang → manzilni bering

So'ng botni yuriting:

```bash
cd apps/bots/miniapp && go run ./cmd/bot
```

Telegram'da `@Ishchibormibot` → `/start` → **«🔎 Ishlarni ochish»**.

### 3.3 Docker bilan

Mini App `miniapp` profili ortida — oddiy `docker compose up` uni ko'tarmaydi
(sabab: hali prod'ga chiqarilmagan, `docker-compose.yml` dagi izohga qarang):

```bash
make miniapp
# yoki to'liq shaklda, repo ILDIZIDAN:
docker compose -f docker-compose.yml -f deploy/docker-compose.dev.yml \
  --profile miniapp up --build -d
```

`VITE_*` qiymatlari **build vaqtida** bundle ichiga yoziladi — ularni
o'zgartirsangiz `docker compose build --no-cache miniapp` qiling.

---

## 4. Arxitektura qarorlari

**Nega auth backend'da, `apps/bots/miniapp` da emas.** `initData`ni tekshirib JWT
chiqarish uchun xizmatga `JWT_ACCESS_SECRET` va Mongo kerak. Uni alohida
servisga chiqarish JWT sirini ikkinchi egaga berardi va foydalanuvchi
qidirishdagi tekshiruvlarni (bloklangan / o'chirilgan hisob) takrorlashga
majbur qilardi. Shuning uchun kirish mavjud `issueSession` ustiga qurildi —
qo'shilgani bitta endpoint.

**Nega bot bazaga ulanmaydi.** U faqat oynani ochadi. Shu tufayli bot tokeni
sizib ketsa ham hujumchi qo'liga na baza, na JWT siri tushadi.

**Nega Next.js emas, Vite.** Mini App'ga SSR va marshrutlash kerak emas,
foydalanuvchilar mobil internetda. Natija: **~66 KB gzip** (JS) + 5 KB CSS.
Dizayn bir xilligi build tool'ga bog'liq emas — `tailwind.config.ts` va
`index.css` dagi tokenlar `apps/web` dan ko'chirilgan.

**Nega leaflet dinamik yuklanadi.** Xarita kutubxonasi ~44 KB gzip, ya'ni
ilovaning qolgan qismidan kattaroq. Foydalanuvchilarning ko'pchiligi xaritani
ochmaydi — ro'yxat va qidiruv yetarli. `lib/leaflet.ts` uni `import()` bilan
alohida chunk qiladi va u faqat xarita birinchi marta ochilganda tortiladi:
xarita ochmagan odam uning hajmini to'lamaydi.

**Nega xarita pinlari rasm emas, HTML.** Leaflet'ning standart markeri
`marker-icon.png` ni nisbiy yo'ldan qidiradi va bundler bilan deyarli har
doim sinadi. `divIcon` bu bog'liqlikni butunlay yo'q qiladi va pin rangini
dizayn tokenidan olish imkonini beradi.

**Nega router kutubxonasi yo'q.** Ekranlar beshta, manzil qatori yo'q. Oddiy
holat + `history.pushState` ishlatiladi, chunki tarix Telegram'ning
BackButton'i va Android'ning tizim "orqaga" tugmasi bilan tabiiy bog'lanadi.

---

## 5. Mobil uchun nima qilingan

- **Pastki tab bar** (tepa navbar emas) — barmoq bir qo'lda yetadi;
  `env(safe-area-inset-bottom)` bilan iPhone home indikatori hisobga olingan.
- **Balandlik `100vh` emas, `viewportStableHeight`** — Telegram'da klaviatura
  ochilganda `100vh` haqiqiy balandlikdan katta bo'lib, pastki panel ekrandan
  tushib ketadi.
- **Input shrifti 16px** — kichikroq bo'lsa iOS Safari inputga bosilganda
  sahifani avtomatik kattalashtiradi.
- **Teginish maydoni ≥44px**, uzun bosishdagi ko'k tanlash foni o'chirilgan.
- **`disableVerticalSwipes()`** — ro'yxatni aylantirayotganda ilova
  tasodifan yopilib ketmaydi.
- **Rasmlar `aspect-ratio` qutilarda**, `loading="lazy"` — ro'yxat sakramaydi
  (layout shift); rasm yuklanmasa element yashiriladi.
- **Karusel `scroll-snap` bilan** — JS kutubxonasiz.
- **Skeletonlar**, qidiruvda 300 ms debounce, `IntersectionObserver` bilan
  cheksiz scroll — sekin tarmoq uchun.
- **Haptika** (bosish, tanlash, muvaffaqiyat/xato) va **MainButton** — asosiy
  amal Telegram'ning o'z tugmasida.
- **Mavzu Telegram'dan** — foydalanuvchi kun/tun rejimini almashtirsa ilova
  darhol o'zgaradi (`themeChanged`).

---

## 6. Tekshirish

```bash
# Backend — initData imzosi, replay, bloklangan hisob
cd apps/api && go vet ./... && go test ./internal/auth/...

# Bot
cd apps/bots/miniapp && go vet ./... && go build ./...

# Webapp (TypeScript + bundle)
cd apps/miniapp && npm run build
```

Telefonda qo'lda tekshirish kerak bo'lganlar: klaviatura ochilganda layout,
scroll'da ilova yopilmasligi, qorong'i rejimga o'tish, BackButton va tab
bar'ning safe-area'si. Qo'shimcha: xaritada pin/klaster bosilishi, rasm
yuklash (kamera va galereya), GPS ruxsati rad etilgan holat.

---

## 7. Nima bor va nima yo'q

Bor: ishlar ro'yxati va qidiruv, **xarita ko'rinishi** (klasterli),
e'lon tafsiloti va ariza berish, arizalarim, **bildirishnomalar**,
**e'lon berish** (rasm yuklash + xaritadan joy tanlash), **e'lonlarim**
(bekor qilish bilan), **ish tarixi**, **profilni tahrirlash** (avatar,
ism, hudud, bio, ko'nikmalar).

Hali yo'q — ataylab:

- **E'lonni tahrirlash.** Yaratish bor, tahrirlash yo'q: `PATCH /api/elons/{id}`
  tayyor, lekin ariza berilgan e'londa narx/sana o'zgarsa ishchi bilan
  kelishuv buziladi. Avval "o'zgarish bo'ldi" bildirishnomasi kerak.
- **Arizani qabul qilish/rad etish.** Ish beruvchi e'loniga kelgan arizalarni
  Mini App'da ko'ra olmaydi (`/api/my/elons/applications` tayyor). Bu qaror
  ishchining ishga chiqishini belgilaydi va noto'g'ri bosilsa qaytarib
  bo'lmaydi — alohida tasdiqlash oqimi bilan qilinishi kerak.
- **Baho/izoh qoldirish** (`/api/applications/{id}/review`).
- **Hisobni o'chirish** — tasdiqlash oqimini talab qiladi, saytda va mobil
  ilovada bor.

---

## 8. Xavfsizlik

Bot tokeni **faqat** `.env` da yashaydi; `.env` `.gitignore` da va repoga
tushmaydi. `.env.example` da qiymatlar bo'sh.

Token biror joyda (chat, skrinshot, log) ochilib qolsa — @BotFather →
`/revoke` bilan darhol almashtiring va yangi qiymatni ildizdagi `.env` ga
qo'ying (bitta joy — backend ham, bot ham shundan o'qiydi).
