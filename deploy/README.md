# deploy/

Ishga tushirish bilan bog'liq fayllar. Ilova kodi bu yerda emas — u `apps/` da.

| Fayl | Vazifasi |
|------|----------|
| `docker-compose.dev.yml` | Lokal dev overlay (APP_ENV=dev, OTP_DEV_RETURN, localhost CORS) |
| `server-setup.sh` | Yangi Hetzner Cloud serverni noldan tayyorlaydi (Docker, Caddy, ufw, swap, deploy user, cron) |
| `Caddyfile` | Xostdagi Caddy konfiguratsiyasi — TLS + `/api`,`/uploads` → backend, qolgani → Next.js |
| `backup-mongo.sh` | Konteyner Mongo'ning kunlik gzip zaxirasi (7 kun saqlanadi) |

## Production — Hetzner Cloud server

```
Internet → :443 Caddy (xost, avtomatik Let's Encrypt)
              ├── /api/*, /uploads/*, /healthz → 127.0.0.1:8080  (Go API)
              └── qolgan hamma narsa          → 127.0.0.1:3000  (Next.js)

docker compose: mongo + backend + bot + frontend
                (barchasi faqat 127.0.0.1 ga bog'langan)
```

Caddy ATAYLAB compose ichida emas, xostda: `docker compose down` qilinganda
ham 80/443 va sertifikatlar joyida qoladi, ya'ni deploy paytida domen o'lmaydi.
Shu sababli `Caddyfile` o'zgarsa CI uni yangilamaydi — qo'lda:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Birinchi o'rnatish: `deploy/server-setup.sh` (skript ichidagi izohga qarang).
Undan keyingi har bir deploy — `main`'ga push (`.github/workflows/ci-cd.yml`).

Kerakli GitHub secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`PROJECT_DIR`, `TELEGRAM_BOT_TOKEN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`BOT_SHARED_SECRET`, `ADMIN_SEED_PASS` (S3 va `MONGO_URI` — ixtiyoriy).

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

Hozir image'lar **serverning o'zida** build qilinadi (`docker compose
build`), ya'ni prod mashinaning RAM va CPU'sida. Next.js build'i RAM yetmay
"Killed" bo'lishi mumkin va deploy paytida sayt sekinlashadi. (`server-setup.sh`
shu sabab 2GB swap yaratadi — bu yamoq, yechim emas.)

Rejalashtirilgan o'zgarish: image'lar GitHub Actions'da build qilinib
registry'ga (GHCR) push qilinadi, server esa faqat `docker compose pull` qiladi.
Bu deploy'ni soniyalarga tushiradi va teglangan image orqali **rollback**
imkonini beradi (hozir buning imkoni yo'q).
