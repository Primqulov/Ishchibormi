/**
 * Xaritadan ish joyini tanlash.
 *
 * Ish beruvchi uchun bu forma ichidagi eng muhim maydon: ishchi manzilni
 * noto'g'ri tushunsa, ish umuman bo'lmaydi. Shuning uchun uch yo'l bilan
 * tanlanadi va uchalasi bir xil natijaga olib keladi:
 *   1. "Joriy joylashuvim" — ish beruvchi ko'pincha o'sha joyda turadi;
 *   2. xaritaga barmoq bilan bosish — aniqroq nuqta uchun;
 *   3. matnli mo'ljal (ixtiyoriy) — "3-uy, ko'k darvoza" kabi qo'shimcha.
 *
 * Viloyat/tuman qo'lda kiritilmaydi — backend ularni koordinatadan o'zi
 * aniqlaydi (apps/api → resolveLocation), shunda ro'yxatdagi filtr bilan
 * e'londagi hudud har doim mos tushadi.
 */

import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { CrosshairIcon, MapPinIcon } from "./icons";
import { Spinner } from "./ui";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  TILE_ATTRIBUTION,
  TILE_URL,
  currentPosition,
  loadLeaflet,
} from "@/lib/leaflet";
import { haptic } from "@/lib/telegram";

export function LocationPicker({
  value,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (v: { lat: number; lng: number }) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletNS.Map | null>(null);
  const marker = useRef<LeafletNS.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);

  // Eng so'nggi `onChange` ni ref'da saqlaymiz: xarita bir marta quriladi va
  // uning bosish ishlovchisi qayta ulanmaydi, shuning uchun to'g'ridan-to'g'ri
  // prop'ni yopib olsak, birinchi render'dagi eski funksiya qotib qolardi.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current || map.current) return;

        const start: [number, number] = value ? [value.lat, value.lng] : DEFAULT_CENTER;
        const m = L.map(box.current, {
          center: start,
          zoom: value ? 16 : DEFAULT_ZOOM,
          // Mobil uchun: ikki barmoq bilan zoom qulay, +/- tugmalari joy egallaydi.
          zoomControl: false,
          attributionControl: true,
        });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);

        const icon = pinIcon(L);
        if (value) {
          marker.current = L.marker([value.lat, value.lng], { icon }).addTo(m);
        }

        m.on("click", (e: LeafletNS.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng;
          haptic.select();
          if (marker.current) marker.current.setLatLng([lat, lng]);
          else marker.current = L.marker([lat, lng], { icon }).addTo(m);
          onChangeRef.current({ lat, lng });
        });

        map.current = m;
        setReady(true);

        // Konteyner o'lchami animatsiya tugagach aniq bo'ladi — aks holda
        // taylar yarim yuklanib, kulrang joy qolib ketadi.
        setTimeout(() => m.invalidateSize(), 200);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // Bir marta quriladi: `value` keyingi o'zgarishlari pastdagi effektda
    // qo'llanadi, xaritani qaytadan yaratmasdan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tashqaridan (GPS tugmasi) kelgan o'zgarishni markerga ko'chirish.
  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    loadLeaflet().then((L) => {
      if (!map.current) return;
      if (marker.current) marker.current.setLatLng([value.lat, value.lng]);
      else marker.current = L.marker([value.lat, value.lng], { icon: pinIcon(L) }).addTo(m);
    });
  }, [value]);

  async function useMyLocation() {
    if (locating) return;
    setLocating(true);
    haptic.tap();
    const pos = await currentPosition();
    setLocating(false);
    if (!pos) {
      haptic.error();
      return;
    }
    haptic.success();
    onChange({ lat: pos[0], lng: pos[1] });
    map.current?.setView(pos, 16);
  }

  if (failed) {
    return (
      <div className="surface p-4 text-center text-[13px] muted">
        Xarita yuklanmadi. «Joriy joylashuvim» tugmasi baribir ishlaydi.
        <button type="button" onClick={useMyLocation} className="btn-soft mt-3 w-full">
          <CrosshairIcon size={16} />
          {locating ? "Aniqlanmoqda..." : "Joriy joylashuvim"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative overflow-hidden rounded-xl"
        style={{ border: "1px solid var(--border-strong)" }}
      >
        <div ref={box} style={{ height: 200, background: "var(--bg-subtle)" }} />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center" style={{ background: "var(--bg-subtle)" }}>
            <Spinner />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="btn-soft !min-h-[38px] !px-3 !py-2 !text-[12.5px]"
        >
          <CrosshairIcon size={14} />
          {locating ? "Aniqlanmoqda..." : "Joriy joylashuvim"}
        </button>
        <p className="text-[11.5px] subtle">
          {value ? (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon size={12} />
              Belgilandi
            </span>
          ) : (
            "yoki xaritaga bosing"
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Pin — rasm emas, HTML.
 *
 * Leaflet'ning standart markeri PNG fayllarni nisbiy yo'ldan qidiradi va
 * bundler bilan ishlatilganda deyarli har doim sinadi (mashhur muammo).
 * `divIcon` bu bog'liqlikni butunlay yo'q qiladi va rangni dizayn
 * tokenidan olish imkonini beradi.
 */
function pinIcon(L: typeof LeafletNS): LeafletNS.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:var(--brand);border:2.5px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
    "></span>`,
    iconSize: [22, 22],
    // Uchi aynan tanlangan nuqtaga tegib tursin.
    iconAnchor: [11, 22],
  });
}
