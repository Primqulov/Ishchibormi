"use client";

// Leaflet'ni CDN orqali bir marta yuklaydigan yordamchi. npm paketi shart emas —
// xarita to'g'ridan-to'g'ri brauzerda ishlaydi.

const CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

let loaderPromise: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject("no window");
  // @ts-ignore
  if (window.L) return Promise.resolve((window as any).L);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_URL;
      document.head.appendChild(link);
    }
    // JS
    const existing = document.querySelector(`script[src="${JS_URL}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).L));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = JS_URL;
    script.async = true;
    script.onload = () => resolve((window as any).L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return loaderPromise;
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
