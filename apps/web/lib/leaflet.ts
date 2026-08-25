"use client";

// Leaflet'ni bir marta yuklaydigan yordamchi. npm paketi shart emas — kutubxona
// to'g'ridan-to'g'ri brauzerda ishlaydi.
//
// Fayllar O'Z SAYTIMIZDAN beriladi (public/leaflet/), CDN'dan emas.
// Sabab: next.config.js dagi CSP `script-src 'self'` va `style-src 'self'` —
// unpkg.com dan kelgan skript brauzer tomonidan bloklanadi va xarita UMUMAN
// ochilmaydi. Ustiga-ustak tashqi CDN saytimiz bilan birga ishlamay qolishi
// yoki ayrim tarmoqlarda to'silishi mumkin.
//
// Versiyani yangilash: leaflet@X.Y.Z ning dist/ papkasidan leaflet.js,
// leaflet.js.map, leaflet.css va images/* ni public/leaflet/ ga nusxalang
// (hozirgisi — leaflet 1.9.4).

const CSS_URL = "/leaflet/leaflet.css";
const JS_URL = "/leaflet/leaflet.js";

let loaderPromise: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject("no window");
  // @ts-ignore
  if (window.L) return Promise.resolve((window as any).L);
  if (loaderPromise) return loaderPromise;

  // CSS ni ham kutamiz, faqat skriptni emas. Leaflet standart marker rasmining
  // manzilini `.leaflet-default-icon-path` uslubidan o'qiydi — uslub hali
  // yetib kelmagan bo'lsa, birinchi marker rasmsiz chiqib qoladi.
  loaderPromise = Promise.all([loadCss(), loadScript()]).then(() => (window as any).L);
  // Yuklash uzilib qolsa keshlangan rad javobini saqlab qo'ymaymiz — aks holda
  // bitta vaqtinchalik xato sahifa yangilanmaguncha xaritani o'ldirib qo'yardi.
  loaderPromise.catch(() => {
    loaderPromise = null;
  });
  return loaderPromise;
}

function loadCss(): Promise<void> {
  const existing = document.querySelector(`link[href="${CSS_URL}"]`) as HTMLLinkElement | null;
  if (existing) return once(existing);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  const done = once(link);
  document.head.appendChild(link);
  return done;
}

function loadScript(): Promise<void> {
  const existing = document.querySelector(`script[src="${JS_URL}"]`) as HTMLScriptElement | null;
  if (existing) return once(existing);
  const script = document.createElement("script");
  script.src = JS_URL;
  script.async = true;
  const done = once(script);
  document.head.appendChild(script);
  return done;
}

/**
 * Element yuklanishini kutadi. Allaqachon yuklanib bo'lgan bo'lsa `load`
 * hodisasi boshqa chiqmaydi — shu bois avval holatini tekshiramiz, aks holda
 * kutish abadiy osilib qolardi.
 */
function once(el: HTMLLinkElement | HTMLScriptElement): Promise<void> {
  if (el instanceof HTMLScriptElement ? (window as any).L : el.sheet) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error(`yuklanmadi: ${el instanceof HTMLLinkElement ? el.href : el.src}`)), { once: true });
  });
}

// Haversine — ikki koordinata orasidagi masofa (km).
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
