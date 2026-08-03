/**
 * E'lonlar xaritasi.
 *
 * Saytdagi JobMapExplorer'ning mobil varianti. Ishchi uchun "qayerda?" degan
 * savol ko'pincha "qanday ish?" dan muhimroq — piyoda yoki bir marta
 * marshrutka bilan yetib boradigan ishni tanlaydi.
 *
 * Mobil uchun farqlar:
 *  - yon panel yo'q; pin bosilganda pastdan kichik karta chiqadi (bir qo'lda
 *    yopiladi, ro'yxatni to'sib qo'ymaydi);
 *  - pinlar ekran masofasi bo'yicha klasterlanadi, aks holda Toshkent
 *    markazida o'nlab pin bir-birining ustiga tushadi;
 *  - leaflet dinamik yuklanadi (lib/leaflet.ts) — xaritani ochmagan
 *    foydalanuvchi uning hajmini to'lamaydi.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { CrosshairIcon, MapPinIcon, UsersIcon, XIcon } from "@/components/icons";
import { ErrorState, Spinner } from "@/components/ui";
import { catTone } from "@/lib/cat-color";
import { clusterByRadius } from "@/lib/cluster";
import { fmtSum, fmtWhen } from "@/lib/format";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  TILE_ATTRIBUTION,
  TILE_URL,
  currentPosition,
  loadLeaflet,
} from "@/lib/leaflet";
import { haptic } from "@/lib/telegram";
import { fetchMapElons, type APIError, type Elon } from "@/lib/api";

/** Klaster radiusi, piksel. Pin diametridan biroz katta. */
const CLUSTER_RADIUS = 44;

export function MapView({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletNS.Map | null>(null);
  const layer = useRef<LeafletNS.LayerGroup | null>(null);
  const L = useRef<typeof LeafletNS | null>(null);

  const [elons, setElons] = useState<Elon[]>([]);
  const [error, setError] = useState<APIError | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Elon | null>(null);
  const [tick, setTick] = useState(0);

  // Pinlarni qayta chizish. Har zoom/surishda chaqiriladi, chunki klasterlash
  // ekran koordinatalarida ishlaydi — geografik emas.
  const redraw = useCallback(() => {
    const m = map.current;
    const lib = L.current;
    const lg = layer.current;
    if (!m || !lib || !lg) return;

    lg.clearLayers();

    const points = elons.map((e) => {
      const p = m.latLngToContainerPoint([e.lat as number, e.lng as number]);
      return { key: e.id, x: p.x, y: p.y, item: e };
    });

    for (const node of clusterByRadius(points, CLUSTER_RADIUS)) {
      const latlng = m.containerPointToLatLng([node.x, node.y]);
      const count = node.items.length;

      if (count === 1) {
        const e = node.items[0];
        const tone = catTone(e.categoryName);
        lib
          .marker(latlng, { icon: priceIcon(lib, e, tone) })
          .on("click", () => {
            haptic.tap();
            setSelected(e);
          })
          .addTo(lg);
      } else {
        lib
          .marker(latlng, { icon: clusterIcon(lib, count) })
          .on("click", () => {
            haptic.select();
            // Klasterga bosilganda ichiga "kirib" boramiz — bir zoom
            // yaqinlashtirish uni bo'lib yuboradi.
            m.setView(latlng, Math.min(m.getZoom() + 2, 18));
          })
          .addTo(lg);
      }
    }
  }, [elons]);

  // `redraw` har render'da yangilanadi, xarita esa bir marta ulanadi —
  // ishlovchi doim eng so'nggi versiyani chaqirishi uchun ref orqali.
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  // Xaritani bir marta qurish.
  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((lib) => {
        if (cancelled || !box.current || map.current) return;
        L.current = lib;

        const m = lib.map(box.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
          attributionControl: true,
        });
        lib.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);
        layer.current = lib.layerGroup().addTo(m);

        // Bo'sh joyga bosilsa tanlangan karta yopiladi.
        m.on("click", () => setSelected(null));
        m.on("moveend zoomend", () => redrawRef.current());

        map.current = m;
        setReady(true);
        setTimeout(() => m.invalidateSize(), 200);
      })
      .catch(() =>
        setError({ code: "map_failed", message: "Xarita yuklanmadi. Internetni tekshiring." }),
      );

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // E'lonlarni yuklash.
  useEffect(() => {
    setError(null);
    fetchMapElons()
      .then(setElons)
      .catch((e: APIError) => setError(e));
  }, [tick]);

  // Ma'lumot kelgach yoki o'zgargach — qayta chizish.
  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  async function goToMe() {
    haptic.tap();
    const pos = await currentPosition();
    if (!pos) {
      haptic.error();
      return;
    }
    map.current?.setView(pos, 14);
  }

  if (error) return <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />;

  return (
    <div className="relative">
      {/* Xarita balandligi: oyna balandligidan sarlavha va tab bar ayiriladi. */}
      <div
        ref={box}
        style={{
          height: "calc(var(--tg-vh) - 190px)",
          minHeight: 320,
          background: "var(--bg-subtle)",
        }}
      />

      {!ready && (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ background: "var(--bg-subtle)" }}
        >
          <Spinner label="Xarita yuklanmoqda..." />
        </div>
      )}

      {/* "Meni topish" — o'ng pastda, barmoq yetadigan joyda. */}
      <button
        type="button"
        onClick={goToMe}
        aria-label="Joriy joylashuvim"
        className="absolute right-3 z-[500] grid h-11 w-11 place-items-center rounded-full transition active:scale-95"
        style={{
          bottom: selected ? 168 : 16,
          background: "var(--card)",
          color: "var(--brand)",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <CrosshairIcon size={19} />
      </button>

      {ready && elons.length === 0 && (
        <div
          className="absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-full px-4 py-2 text-[12.5px]"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-pop)" }}
        >
          Xaritada ko'rsatiladigan e'lon yo'q
        </div>
      )}

      {/* Tanlangan e'lon — pastdan chiqadigan karta. */}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-[500] animate-fade-in">
          <div className="card p-4" style={{ boxShadow: "var(--shadow-pop)" }}>
            <div className="flex items-start gap-2">
              <h3 className="line-clamp-2 min-w-0 flex-1 text-[15px] font-bold leading-5 heading">
                {selected.title}
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Yopish"
                className="shrink-0 subtle"
              >
                <XIcon size={18} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] muted">
              <span className="font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                {selected.pricingType === "negotiable"
                  ? "Kelishiladi"
                  : `${fmtSum(selected.perWorkerAmount || selected.priceAmount)} so'm`}
              </span>
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={12} className="subtle" />
                {Math.max(0, (selected.workersNeeded || 0) - (selected.acceptedCount || 0))} o'rin
              </span>
              {fmtWhen(selected.startDate, selected.workTimeFrom) && (
                <span className="subtle">{fmtWhen(selected.startDate, selected.workTimeFrom)}</span>
              )}
            </div>

            {(selected.locationText || selected.district) && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] subtle">
                <MapPinIcon size={12} />
                {selected.locationText ||
                  [selected.district, selected.region].filter(Boolean).join(", ")}
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                haptic.tap();
                onOpenJob(selected.id);
              }}
              className="btn-primary mt-3 w-full"
            >
              Batafsil
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pinlar ─────────────────────────────────────────────────────────────
// Rasm emas, HTML (divIcon): leaflet'ning standart PNG markerlari bundler
// bilan sinadi va rangni dizayn tokenidan olib bo'lmaydi.

function priceIcon(
  L: typeof LeafletNS,
  e: Elon,
  tone: { bg: string; fg: string },
): LeafletNS.DivIcon {
  const label =
    e.pricingType === "negotiable"
      ? "kelishuv"
      : compact(e.perWorkerAmount || e.priceAmount);

  // iconSize [0,0] + translate(-50%,-50%): yorliq kengligi matnga qarab
  // o'zgaradi, ya'ni uni oldindan bilib bo'lmaydi. Nol o'lchamli idish
  // aynan koordinataga qo'yiladi, yorliq esa CSS bilan uning MARKAZIGA
  // tortiladi — shunda "200k" ham, "1.5mln" ham pin nuqtasida turadi.
  return L.divIcon({
    className: "",
    html: `<span style="
      position:absolute;transform:translate(-50%,-50%);
      display:inline-flex;align-items:center;justify-content:center;
      padding:4px 9px;border-radius:999px;white-space:nowrap;
      background:${tone.bg};color:${tone.fg};
      border:1.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.28);
      font:700 11px/1 Inter,system-ui,sans-serif;
    ">${label}</span>`,
    iconSize: [0, 0],
  });
}

function clusterIcon(L: typeof LeafletNS, count: number): LeafletNS.DivIcon {
  const size = count > 99 ? 46 : count > 9 ? 40 : 34;
  return L.divIcon({
    className: "",
    html: `<span style="
      display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;
      background:var(--brand);color:#fff;
      border:2.5px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.32);
      font:800 ${count > 99 ? 12 : 13}px/1 Inter,system-ui,sans-serif;
    ">${count > 99 ? "99+" : count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** 200000 → "200k". Pin ustida joy tor. */
function compact(n: number): string {
  if (!n || n < 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}mln`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
