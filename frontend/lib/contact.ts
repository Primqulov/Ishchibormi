// Butun sayt uchun HAQIQIY aloqa va ijtimoiy tarmoq ma'lumotlari — yagona manba (DRY).
// O'zgartirish kerak bo'lsa faqat shu yerni yangilang; barcha sahifalar shundan oladi.

export const CONTACT = {
  phone: "+998 90 020 25 35",
  phoneHref: "tel:+998900202535",
  email: "ishchibormi@gmail.com",
  emailHref: "mailto:ishchibormi@gmail.com",
} as const;

export type SocialLink = { label: string; href: string };

// Ro'yxatdan o'tish (OTP) boti — foydalanuvchi Telegramga yo'naltiriladigan
// barcha joylar (login, landing, bildirishnomalar) shu yagona manbadan oladi.
// Zaxira qiymat — HAQIQIY produksiya boti; NEXT_PUBLIC_BOT_USERNAME orqali
// (masalan test botga) qayta yo'naltirish mumkin.
export const AUTH_BOT_USERNAME =
  process.env.NEXT_PUBLIC_BOT_USERNAME || "Ishchi_bormi_auth_bot";

export const AUTH_BOT: SocialLink = {
  label: `@${AUTH_BOT_USERNAME}`,
  href: `https://t.me/${AUTH_BOT_USERNAME}`,
};

export const SOCIAL = {
  // Rasmiy Telegram kanali
  telegram: { label: "@Ishchibormi", href: "https://t.me/Ishchibormi" },
  // Qo'llab-quvvatlash (Telegram)
  support: { label: "@Ishchi_bormi_support", href: "https://t.me/Ishchi_bormi_support" },
  instagram: { label: "@ishchi_bormi", href: "https://instagram.com/ishchi_bormi" },
  youtube: { label: "@Ishchi_bormi", href: "https://youtube.com/@Ishchi_bormi" },
} as const satisfies Record<string, SocialLink>;

// Google/schema.org "sameAs" uchun ochiq ijtimoiy tarmoq profillari.
export const SOCIAL_SAMEAS: string[] = [
  SOCIAL.telegram.href,
  SOCIAL.instagram.href,
  SOCIAL.youtube.href,
];
