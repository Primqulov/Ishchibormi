// Ma'lumotlarni saqlash muddatlari — YAGONA MANBA (DRY).
//
// Bu yerdagi har bir qator backend kodidagi aniq bir joydan olingan. Hech
// qanday qiymat "taxminan" emas — o'zgartirishdan oldin ko'rsatilgan manbani
// tekshiring, aks holda sayt foydalanuvchiga kod bajarmaydigan va'dani beradi
// (Google Play uchun bu to'g'ridan-to'g'ri siyosat buzilishi).
//
// Manbalar:
//   apps/api/internal/account/retention.go   — DefaultRetentionDays, Purger
//   apps/api/config/config.go                — OTP_TTL_SECONDS, JWT_*_TTL_*
//   apps/api/internal/account/delete.go      — deleteCodeTTL
//   apps/api/internal/elon/handler.go        — Delete (butunlay o'chiradi)
//   apps/api/pkg/db/indexes.go               — otp_codes / delete_codes TTL

/** O'chirilgan hisob butunlay yo'q qilinishidan oldingi muhlat (kun). */
export const RETENTION_DAYS = 90;

export type RetentionRow = {
  /** Ma'lumot turi. */
  what: string;
  /** Qancha saqlanadi. */
  howLong: string;
};

/**
 * Har bir ma'lumot turi qancha saqlanishi. /maxfiylik-siyosati va
 * /delete-account sahifalari shu ro'yxatdan o'qiydi.
 */
export const RETENTION_TABLE: readonly RetentionRow[] = [
  {
    what: "Telefon raqami",
    howLong: `Hisob faol bo'lgan davrda. Hisob o'chirilganda raqam darhol hisobdan uziladi (boshqa foydalanuvchi uni qayta ro'yxatdan o'tkaza oladi) va ${RETENTION_DAYS} kundan so'ng arxivdan ham butunlay o'chadi.`,
  },
  {
    what: "Telegram identifikatori",
    howLong: `Telefon raqami bilan bir xil: darhol uziladi, ${RETENTION_DAYS} kundan so'ng butunlay o'chadi.`,
  },
  {
    what: "Profil (ism, familiya, viloyat/tuman, bio, ko'nikmalar, avatar)",
    howLong: `Hisob faol bo'lgan davrda. Hisob o'chirilgandan ${RETENTION_DAYS} kun keyin butunlay o'chadi.`,
  },
  {
    what: "E'lonlar",
    howLong: `E'lonni o'zingiz o'chirsangiz — bazadan darhol va butunlay o'chadi (rasmlari va arizalari bilan birga). Hisobni o'chirsangiz — e'lonlar darhol ro'yxatdan olinadi va ${RETENTION_DAYS} kundan so'ng butunlay o'chadi.`,
  },
  {
    what: "Arizalar",
    howLong: `Hisob o'chirilganda faol arizalar darhol bekor qilinadi, ${RETENTION_DAYS} kundan so'ng butunlay o'chadi.`,
  },
  {
    what: "Yuklangan rasmlar",
    howLong: `Hisob o'chirilganda saqlash xizmatidan darhol o'chiriladi; ${RETENTION_DAYS} kunlik muhlat oxirida o'chirish qayta tasdiqlanadi.`,
  },
  {
    what: "Bildirishnomalar",
    howLong: `Hisob faol bo'lgan davrda; hisob o'chirilgandan ${RETENTION_DAYS} kun keyin butunlay o'chadi.`,
  },
  {
    what: "Taklif va shikoyatlar (ilova ichidan)",
    howLong: `Ko'rib chiqilgunga qadar va undan keyin ham; hisob o'chirilgandan ${RETENTION_DAYS} kun keyin butunlay o'chadi.`,
  },
  {
    what: "Qo'llab-quvvatlash boti orqali yuborilgan murojaatlar (matn, ovozli xabar, rasm)",
    howLong: `Murojaat bilan birga telefon raqamingiz, ismingiz va Telegram foydalanuvchi nomingiz saqlanadi. Hisob o'chirilgandan ${RETENTION_DAYS} kun keyin bularning hammasi bazamizdan butunlay o'chadi. Eslatma: ovozli xabar va rasmlarning o'zi Telegram serverlarida turadi — biz faqat ularga havolani saqlaymiz va Telegram'dagi nusxasini o'chira olmaymiz.`,
  },
  {
    what: "Shikoyatlar (boshqa foydalanuvchi ustidan yoki siz haqingizda)",
    howLong: `Moderatsiya ko'rib chiqishi uchun; hisob o'chirilgandan ${RETENTION_DAYS} kun keyin butunlay o'chadi.`,
  },
  {
    what: "Kirish (OTP) kodi",
    howLong: "3 daqiqa. Muddati o'tgach ma'lumotlar bazasidan avtomatik o'chiriladi.",
  },
  {
    what: "Hisobni o'chirish kodi",
    howLong: "10 daqiqa. Muddati o'tgach ma'lumotlar bazasidan avtomatik o'chiriladi.",
  },
  {
    what: "Kirish tokeni (JWT)",
    howLong: "3 kun. Server tomonida saqlanmaydi — faqat qurilmangizda turadi.",
  },
  {
    what: "Yangilash tokeni (refresh JWT)",
    howLong: "30 kun. Server tomonida saqlanmaydi — faqat qurilmangizda turadi.",
  },
  {
    what: "O'chirilgan hisob",
    howLong: `${RETENTION_DAYS} kun. Muddat tugagach hisob va unga bog'liq barcha yozuvlar bazadan butunlay o'chiriladi.`,
  },
] as const;
