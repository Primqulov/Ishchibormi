"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed, Loader2 } from "lucide-react";
import { loadLeaflet } from "@/lib/leaflet";

export interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  value?: LatLng | null;
  onChange: (v: LatLng) => void;
  height?: number;
}

// Toshkent markazi — boshlang'ich ko'rinish.
const DEFAULT_CENTER: LatLng = { lat: 41.3111, lng: 69.2797 };

const round6 = (n: number) => +n.toFixed(6);
const samePoint = (a: LatLng | null | undefined, b: LatLng | null | undefined) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

/**
 * Xaritadan ish joyini tanlash. Foydalanuvchi xaritaga bossa yoki markerni
 * sudrasa, koordinata yuqoriga (onChange) uzatiladi. Ko'cha/yo'ldosh (sputnik)
 * ko'rinishini almashtirish va joriy joylashuvni aniqlash imkoniyatlari bor.
 */
export function MapPicker({ value, onChange, height = 320 }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  // Ikki asosiy qatlam refda saqlanadi — qatlamni faqat foydalanuvchi tugma
  // orqali almashtiradi, React qayta renderlari yoki marker qo'yish unga
  // TEGMAYDI (shu bois yo'ldoshdan o'zi ko'chaga qaytib qolmaydi).
  const streetRef = useRef<any>(null);
  const satRef = useRef<any>(null);
  // Foydalanuvchi tanlagan qatlam turi refda ham saqlanadi — bu init/effect
  // yoki React holati (state) closurelariga bog'liq bo'lmagan yagona haqiqat
  // manbai. Faqat switchBase uni o'zgartiradi, shu bois marker qo'yish, xaritani
  // siljitish yoki qayta render qatlamni O'ZI o'zgartirib yubormaydi.
  const baseRef = useRef<"street" | "satellite">("street");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Oxirgi uzatilgan koordinata — value o'zgarganda takroriy sinxronni oldini oladi.
  const lastEmitRef = useRef<LatLng | null>(value ?? null);

  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState("");
  const [address, setAddress] = useState("");
  // Faol asosiy qatlam — faqat tugma orqali o'zgaradi.
  const [base, setBase] = useState<"street" | "satellite">("street");

  // Qatlamni almashtirish: eskisini olib tashlab, yangisini qo'yamiz — shunda
  // ikkalasi bir vaqtda ko'rinib "aralashib" qolmaydi.
  function switchBase(kind: "street" | "satellite") {
    const map = mapRef.current;
    const street = streetRef.current;
    const sat = satRef.current;
    if (!map || !street || !sat) return;
    const add = kind === "street" ? street : sat;
    const remove = kind === "street" ? sat : street;
    if (map.hasLayer(remove)) map.removeLayer(remove);
    if (!map.hasLayer(add)) add.addTo(map);
    baseRef.current = kind;
    setBase(kind);
  }

  // Tanlangan nuqta bo'yicha manzil matnini olish (teskari geokodlash).
  async function reverseGeocode(lat: number, lng: number) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { "Accept-Language": "uz" } }
      );
      const d = await r.json();
      if (d && d.display_name) setAddress(d.display_name as string);
    } catch {
      /* manzil matni ixtiyoriy — xato bo'lsa e'tiborsiz qoldiramiz */
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !elRef.current || mapRef.current) return;
        const start = value && (value.lat || value.lng) ? value : DEFAULT_CENTER;
        // Standart zoom (+/-) tugmalarini o'chirib, ularni pastki-o'ng burchakka
        // qo'yamiz. Manzil yozuvi (attribution) esa pastki-chapga o'tadi — shunda
        // ular bir-birining ustiga tushmaydi.
        const map = L.map(elRef.current, { zoomControl: false, attributionControl: false })
          .setView([start.lat, start.lng], value ? 16 : 12);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        L.control.attribution({ position: "bottomleft" }).addTo(map);

        // Ikki asosiy qatlam: ko'cha (OSM) va yo'ldosh (Esri sun'iy yo'ldosh).
        // Leaflet'ning ichki qatlam almashtirgichi (L.control.layers) o'rniga
        // o'zimiz boshqaramiz — quyidagi tugmalar orqali (switchBase). Shunda
        // qatlam faqat foydalanuvchi xohlaganda o'zgaradi va aralashib qolmaydi.
        const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        });
        const satellite = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, attribution: "© Esri" }
        );
        streetRef.current = street;
        satRef.current = satellite;
        // Boshlang'ich qatlam — refdan olinadi (default: ko'cha). State emas,
        // ref ishlatiladi: init faqat bir marta ishlaydi va closurega bog'lanib
        // qolmaydi.
        (baseRef.current === "satellite" ? satellite : street).addTo(map);

        function ensureMarker(lat: number, lng: number) {
          if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
          } else {
            markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
            markerRef.current.on("dragend", () => {
              const p = markerRef.current.getLatLng();
              emit(round6(p.lat), round6(p.lng));
            });
          }
        }

        function emit(lat: number, lng: number) {
          const p = { lat, lng };
          lastEmitRef.current = p;
          onChangeRef.current(p);
          reverseGeocode(lat, lng);
        }

        // Tashqaridan chaqirish uchun (qidiruv/joylashuv) mapRef ga biriktiramiz.
        (map as any)._place = (lat: number, lng: number, zoom?: number) => {
          ensureMarker(lat, lng);
          map.setView([lat, lng], zoom ?? map.getZoom());
          emit(round6(lat), round6(lng));
        };

        if (value && (value.lat || value.lng)) {
          ensureMarker(value.lat, value.lng);
          reverseGeocode(value.lat, value.lng);
        }

        map.on("click", (e: any) => {
          ensureMarker(e.latlng.lat, e.latlng.lng);
          emit(round6(e.latlng.lat), round6(e.latlng.lng));
        });

        mapRef.current = map;
        setLoading(false);
        setTimeout(() => map.invalidateSize(), 200);
      })
      .catch(() => {
        if (!cancelled) {
          setErr("Xaritani yuklab bo'lmadi. Internet aloqasini tekshiring.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tashqaridan value o'zgarsa (masalan, tahrirlashda), markerni ko'chiramiz.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value || (!value.lat && !value.lng)) return;
    if (samePoint(value, lastEmitRef.current)) return;
    lastEmitRef.current = value;
    (map as any)._place?.(value.lat, value.lng, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  // Joriy joylashuvni aniqlash. Ruxsat berilmagan bo'lsa, har bosishda
  // qaytadan so'raladi (brauzer holati "prompt" bo'lsa) yoki qanday ruxsat
  // berishni tushuntiruvchi xabar chiqadi.
  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErr("Brauzer joylashuvni qo'llab-quvvatlamaydi.");
      return;
    }
    // Geolokatsiya faqat xavfsiz ulanishda (https) yoki localhost'da ishlaydi.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setErr("Joylashuv faqat https yoki localhost'da ishlaydi. Boshqa kompyuterdan kirgan bo'lsangiz, xaritadan qo'lda tanlang yoki manzilni qidiring.");
      return;
    }
    setLocating(true);
    setErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        (mapRef.current as any)?._place?.(latitude, longitude, 16);
        setLocating(false);
      },
      (e) => {
        setLocating(false);
        if (e.code === e.PERMISSION_DENIED) {
          setErr("Joylashuvga ruxsat berilmagan. Manzil qatoridagi qulf (🔒) belgisi → Joylashuv (Location) → Ruxsat bering, so'ng \"Mening joyim\"ni qayta bosing.");
        } else if (e.code === e.POSITION_UNAVAILABLE) {
          setErr("Joylashuvni aniqlab bo'lmadi. Internet yoki GPS holatini tekshirib, qayta urinib ko'ring.");
        } else if (e.code === e.TIMEOUT) {
          setErr("Joylashuvni aniqlash uzoq davom etdi. Qayta urinib ko'ring.");
        } else {
          setErr("Joylashuvni aniqlab bo'lmadi. Qayta urinib ko'ring.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  return (
    <div>
      <div className="relative isolate rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
        <div ref={elRef} style={{ height, width: "100%" }} />
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-[color:var(--card)]/70">
            <Loader2 className="animate-spin muted" size={22} />
          </div>
        )}
        {!loading && !err && (
          <div className="absolute z-[400] top-2 left-2 flex rounded-lg overflow-hidden shadow-pop border" style={{ borderColor: "var(--border)" }}>
            {([["street", "Ko'cha"], ["satellite", "Yo'ldosh"]] as const).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={(e) => { e.stopPropagation(); switchBase(kind); }}
                className={`px-3 py-1.5 text-xs font-medium transition ${base === kind ? "bg-brand-navy text-white" : "bg-[color:var(--card)] hover:bg-black/5"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!loading && !err && (
          <button
            type="button"
            onClick={useMyLocation}
            className="absolute z-[400] top-2 right-2 btn-secondary btn-sm gap-1 shadow-pop"
          >
            {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />}
            Mening joyim
          </button>
        )}
      </div>

      <div className="mt-1.5 text-xs muted flex items-start gap-1.5">
        <MapPin size={12} className="mt-0.5 shrink-0" />
        {value && (value.lat || value.lng) ? (
          <span>
            {address || `Tanlangan: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`}
          </span>
        ) : (
          <span>Ish joyini belgilash uchun xaritaga bosing yoki markerni suring.</span>
        )}
      </div>
      {err && <p className="text-xs text-danger mt-1">{err}</p>}
    </div>
  );
}
