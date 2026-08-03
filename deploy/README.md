# deploy/

Ishga tushirish bilan bog'liq fayllar. Ilova kodi bu yerda emas — u `apps/` da.

| Fayl | Vazifasi |
|------|----------|
| `docker-compose.dev.yml` | Lokal dev overlay (APP_ENV=dev, OTP_DEV_RETURN, localhost CORS) |

## Nega asosiy `docker-compose.yml` ildizda qoldi

Uni ham shu papkaga ko'chirish tabiiy ko'rinadi, lekin bu **prod ma'lumotini
yo'qotadi**. Sababi — Compose "loyiha nomi" (project name):

- Compose loyiha nomini **birinchi `-f` fayli turgan papka nomidan** oladi
- Nomlangan volume'lar shu prefiks bilan yaratiladi: `<loyiha>_uploads`,
  `<loyiha>_avatars`, `<loyiha>_mongo_data`
- Compose fayli `deploy/` ga ko'chsa, loyiha nomi `deploy` bo'lib qoladi va
  Compose eski volume'larni **topa olmay, yangi bo'shlarini yaratadi**

Serverdagi `uploads` va `avatars` volume'larida foydalanuvchilar yuklagan
rasmlar turadi. Ya'ni bu shunchaki noqulaylik emas — jonli ma'lumot
ko'rinmay qoladi (o'chmaydi, lekin orfan bo'lib qoladi).

Xuddi shu sabab `.env` ga ham tegishli: Compose uni loyiha papkasidan
o'qiydi, ya'ni `${MONGO_URI:-...}` kabi barcha interpolatsiyalar ildizdagi
`.env` ni ko'rishi kerak.

Shuning uchun qoida:

```bash
# TO'G'RI — ildizdan, prod compose birinchi
docker compose up -d --build
docker compose -f docker-compose.yml -f deploy/docker-compose.dev.yml up -d --build

# NOTO'G'RI — loyiha nomi "deploy" bo'lib ketadi
cd deploy && docker compose -f docker-compose.dev.yml up -d
```

`make up` / `make dev` allaqachon to'g'ri shaklda chaqiradi — shulardan
foydalangan ma'qul.

## Keyingi qadam (hali qilinmagan)

Hozir image'lar **EC2 serverning o'zida** build qilinadi (`docker compose
build`), ya'ni prod mashinaning RAM va CPU'sida. Next.js build'i RAM yetmay
"Killed" bo'lishi mumkin va deploy paytida sayt sekinlashadi.

Rejalashtirilgan o'zgarish: image'lar GitHub Actions'da build qilinib
registry'ga (GHCR) push qilinadi, EC2 esa faqat `docker compose pull` qiladi.
Bu deploy'ni soniyalarga tushiradi va teglangan image orqali **rollback**
imkonini beradi (hozir buning imkoni yo'q).
