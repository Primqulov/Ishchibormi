/**
 * Leaflet'ni TALAB BO'LGANDA yuklash.
 *
 * Nega statik `import` emas: leaflet + CSS ~45 KB gzip, ya'ni ilovaning
 * qolgan qismidan kattaroq. Foydalanuvchilarning ko'pchiligi xaritani
 * umuman ochmaydi (ro'yxat va qidiruv yetarli), shuning uchun uni asosiy
 * bundle'ga qo'shish har bir ochilishda hammadan pul undirish bo'lardi.
 *
 * Dinamik `import()` bilan Vite buni alohida chunk qiladi va u faqat xarita
 * birinchi marta ochilganda tortiladi. Natija bir marta keshlanadi —
 * takroriy chaqiruvlar shu va'dani qaytaradi.
 *
 * Marker rasmlari ATAYLAB ishlatilmaydi: leaflet'ning standart markeri
 * `marker-icon.png` ni nisbiy yo'ldan qidiradi va bundler bilan doim
 * sinadi. Buning o'rniga pinlar `divIcon` (HTML) bilan chiziladi — hech
 * qanday rasm fayli, hech qanday yo'l sozlamasi kerak emas.
 */

import type * as LeafletNS from "leaflet";

export type Leaflet = typeof LeafletNS;

let cached: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  if (!cached) {
    cached = (async () => {
      // CSS shu chunk ichida so'raladi — Vite uni chunk bilan birga
      // ajratadi va xarita ochilmaguncha yuklanmaydi.
      await import("leaflet/dist/leaflet.css");
      const mod = await import("leaflet");
      // Leaflet CommonJS eksport qiladi; Vite uni `default` ostiga o'raydi.
      return ((mod as any).default ?? mod) as Leaflet;
    })();
  }
  return cached;
}

/** OpenStreetMap tayl manbai — API kaliti kerak emas (sayt ham shuni ishlatadi). */
export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = "&copy; OpenStreetMap";

/** Toshkent markazi — joylashuv noma'lum bo'lganda xarita shu yerdan ochiladi. */
export const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];
export const DEFAULT_ZOOM = 11;

/**
 * Brauzerdan joriy joylashuvni so'raydi.
 *
 * Telegram ichida bu tizim ruxsat oynasini chiqaradi. Rad etilsa yoki
 * qurilmada GPS bo'lmasa `null` qaytadi — chaqiruvchi buni xato emas,
 * "joylashuv yo'q" deb qabul qiladi va xaritani qo'lda tanlashga qoldiradi.
 */
export function currentPosition(timeoutMs = 8000): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
