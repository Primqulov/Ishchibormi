// SEO uchun umumiy konstantalar va yordamchilar.
// Sayt manzili — barcha sitemap/robots/canonical/OG havolalari shundan quriladi.
export const SITE_URL = "https://ishchibormi.uz";
export const SITE_NAME = "Ishchi Bormi";

// Bosh sahifa sarlavhasi — qidiruvda darhol tushunarli bo'lsin.
export const SITE_TITLE = "Ishchi Bormi — Kunlik yumushlar uchun ishchi toping yoki ish toping";

// Meta description — oddiy foydalanuvchi tilida, saytning vazifasi darhol bilinsin.
export const SITE_DESCRIPTION =
  "Uy ko‘chirish, yuk tashish, hovli tozalash, ta'mirlash va boshqa kunlik yumushlar uchun " +
  "ishonchli ishchi toping. Kunlik ish izlayotgan bo‘lsangiz, yaqiningizdagi ish e'lonlarini " +
  "topib, ish beruvchi bilan bevosita bog‘laning.";

// Open Graph / ijtimoiy tarmoqlar uchun qisqaroq va jozibador tavsif.
export const SITE_OG_DESCRIPTION =
  "Uy ko‘chirish, yuk tashish, hovli tozalash, ta'mirlash va boshqa kunlik yumushlar uchun " +
  "ishonchli ishchi toping yoki ish toping.";

export const SITE_KEYWORDS = [
  "ishchi bormi", "kunlik yumush", "kunlik ish", "mardikor", "ishchi topish",
  "uy ko‘chirish", "yuk tashish", "hovli tozalash", "ta'mirlash",
  "santexnik", "elektrik", "usta", "O‘zbekiston",
];

// Ijtimoiy tarmoq (OG/Twitter) ulashuv rasmi — Telegram/Facebook/X va Google.
// metadataBase bilan birga absolyut URL'ga aylanadi: https://ishchibormi.uz/img/OGimg.png
export const OG_IMAGE = "/img/OGimg.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// Favicon/apple/PWA ikonkalari rasmiy app-ikonasidan generatsiya qilingan va
// public/ ildizida yotadi: brauzer ikonkalari Metadata API `icons` (layout.tsx),
// PWA ikonkalari esa manifest.ts orqali beriladi.

// API bazaviy manzili (server tomonda ham ishlaydi — absolyut bo'lishi shart).
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080").replace(/\/$/, "");

// Sahifa uchun to'liq (absolyut) URL yasaydi — canonical/OG uchun.
export function absUrl(path = "/"): string {
  return SITE_URL + (path.startsWith("/") ? path : "/" + path);
}

// Server tomonda bitta e'lonni oladi (generateMetadata + JSON-LD uchun).
// Xatolik bo'lsa null qaytaradi — sahifa baribir render bo'ladi.
export async function fetchElon(id: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/elons/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Server tomonda ochiq foydalanuvchi profilini oladi (u/[id] metadata uchun).
export async function fetchPublicUser(id: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/users/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
