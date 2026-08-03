"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Clock, Layers, Loader2, LocateFixed, MapPin, Minus, Plus, RefreshCw, Users, X,
} from "lucide-react";
import { Elon } from "@/lib/api";
import { loadLeaflet, distanceKm } from "@/lib/leaflet";
import { clusterByRadius, ClusterInput } from "@/lib/cluster";
import { fmtCompactSum, fmtKm, fmtSum, fmtWhen } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { JobMiniCard } from "./JobMiniCard";
import { T, useT } from "./T";

/** Xarita boshlang'ich markazi — Toshkent. */
const CENTER: [number, number] = [41.2995, 69.2401];
/**
 * Ekranda shu masofadan yaqin turgan pinlar bitta raqamga (klasterga) qo'shiladi.
 * Xarita uzoqlashtirilganda pinlar yaqinlashadi va klasterlar o'zaro qo'shilib
 * boradi; yaqinlashtirilganda esa aksincha — ular ajralib, alohida narx pinlariga
 * aylanadi.
 */
const CLUSTER_RADIUS = 64;
/** Klaster ochilganda ruxsat etilgan eng katta masshtab. */
const CLUSTER_MAX_ZOOM = 17;

type Point = { x: number; y: number };
type Node = { key: string; x: number; y: number; items: Elon[] };

interface Props {
  items: Elon[];
  loading?: boolean;
}

/**
 * Figma "04b · Ish e'lonlari — Xarita ko'rinishi": chapda ixcham e'lonlar
 * ro'yxati, o'ngda xarita. Xaritadagi pinlar narxni ko'rsatadi, yaqin
 * turganlari klasterga yig'iladi, tanlangani ustida e'lon oynasi ochiladi.
 *
 * Leaflet faqat plitalar va proyeksiya uchun ishlatiladi — pinlar, oyna va
 * boshqaruv tugmalari React qatlami sifatida xarita ustiga chiziladi.
 */
export function JobMapExplorer({ items, loading }: Props) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meLayerRef = useRef<any>(null);
  /** fitBounds o'zi harakat hosil qiladi — uni foydalanuvchi surishi deb hisoblamaymiz. */
  const autoMoveRef = useRef(false);
  const fittedRef = useRef("");

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Xarita har surilganda ortadi — pin koordinatalarini qayta hisoblatadi. */
  const [tick, setTick] = useState(0);
  const [moved, setMoved] = useState(false);
  const [area, setArea] = useState<any>(null); // qidirilayotgan hudud (LatLngBounds)
  /** Klaster ustiga bosilganda — faqat o'sha ishlar qoladi (e'lon id'lari). */
  const [drill, setDrill] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);

  // Koordinatasi bor e'lonlargina xaritada ko'rinadi.
  const geo = useMemo(
    () => items.filter((e) => typeof e.lat === "number" && typeof e.lng === "number"),
    [items],
  );
  const noGeoCount = items.length - geo.length;

  // ── Xarita ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !boxRef.current || mapRef.current) return;
        const map = L.map(boxRef.current, { zoomControl: false, attributionControl: true })
          .setView(CENTER, 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        // Har surish/masshtabda pin koordinatalari qayta hisoblanadi.
        map.on("move zoom", () => setTick((n) => n + 1));
        map.on("moveend zoomend", () => {
          if (autoMoveRef.current) { autoMoveRef.current = false; return; }
          setMoved(true);
        });
        mapRef.current = map;
        setReady(true);
        setTimeout(() => map.invalidateSize(), 150);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Yangi natijalar kelganda xarita ularni qamrab oladi.
  useEffect(() => {
    const map = mapRef.current;
    const L = (typeof window !== "undefined" && (window as any).L) || null;
    if (!ready || !map || !L || geo.length === 0) return;
    const sig = geo.map((e) => e.id).join(",");
    if (sig === fittedRef.current) return;
    fittedRef.current = sig;
    autoMoveRef.current = true;
    const bounds = L.latLngBounds(geo.map((e) => [e.lat as number, e.lng as number]));
    if (geo.length === 1) map.setView(bounds.getCenter(), 14);
    else map.fitBounds(bounds.pad(0.18));
    setMoved(false);
    setArea(null);
    setDrill(null);
  }, [ready, geo]);

  // Tanlangan e'lon ro'yxatdan bosilganda xarita unga suriladi.
  const focus = useCallback((e: Elon) => {
    setSelected(e.id);
    setSeen((s) => new Set(s).add(e.id));
    const map = mapRef.current;
    if (map && typeof e.lat === "number" && typeof e.lng === "number") {
      autoMoveRef.current = true;
      map.setView([e.lat, e.lng], Math.max(map.getZoom(), 14), { animate: true });
    }
  }, []);

  function locateMe() {
    if (!navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(p);
        setGeoBusy(false);
        const map = mapRef.current;
        const L = (window as any).L;
        if (map && L) {
          if (meLayerRef.current) map.removeLayer(meLayerRef.current);
          meLayerRef.current = L.circleMarker([p.lat, p.lng], {
            radius: 8, color: "#fff", weight: 3, fillColor: "#0038D8", fillOpacity: 1,
          }).addTo(map);
          autoMoveRef.current = true;
          map.setView([p.lat, p.lng], 13);
        }
      },
      () => setGeoBusy(false),
      { timeout: 8000 },
    );
  }

  function zoom(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    autoMoveRef.current = true;
    map.setZoom(map.getZoom() + delta);
  }

  /** Joriy ko'rinishni to'liq ekranli OpenStreetMap'da ochadi. */
  function openFullMap() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    window.open(
      `https://www.openstreetmap.org/#map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function searchArea() {
    const map = mapRef.current;
    if (!map) return;
    setDrill(null);
    setArea(map.getBounds());
    setMoved(false);
  }

  function clearArea() {
    setArea(null);
    setDrill(null);
    setMoved(false);
  }

  /**
   * Klaster raqami bosilganda: xarita shu ishlarning chegarasiga yaqinlashadi
   * va ular markazda ochiladi. Ichida yana yaqin turganlari qolsa — ular
   * kichikroq raqam bo'lib ko'rinaveradi va yana bosish mumkin.
   */
  const openCluster = useCallback((node: Node) => {
    const map = mapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;
    const pts = node.items.map((e) => [e.lat as number, e.lng as number]);
    const bounds = L.latLngBounds(pts);
    autoMoveRef.current = true;
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      // Hammasi bitta nuqtada — yaqinlashtirish ularni ajratmaydi, shuning
      // uchun faqat markazga olib kelamiz; ro'yxat ustuni ularni to'liq ko'rsatadi.
      map.setView(bounds.getCenter(), Math.min(map.getZoom() + 2, CLUSTER_MAX_ZOOM + 1));
    } else {
      map.fitBounds(bounds.pad(0.35), { maxZoom: CLUSTER_MAX_ZOOM });
    }
    setDrill(node.items.map((e) => e.id));
    setArea(null);
    setMoved(false);
    setSelected(null);
  }, []);

  // ── Ro'yxat: hudud/klaster filtri + masofa bo'yicha tartib ─────────────
  const visible = useMemo(() => {
    let list = geo;
    if (drill) {
      const ids = new Set(drill);
      list = list.filter((e) => ids.has(e.id));
    } else if (area) {
      list = list.filter((e) => area.contains([e.lat as number, e.lng as number]));
    }
    if (me) {
      list = [...list].sort(
        (a, b) =>
          distanceKm(me.lat, me.lng, a.lat as number, a.lng as number) -
          distanceKm(me.lat, me.lng, b.lat as number, b.lng as number),
      );
    }
    return list;
  }, [geo, area, drill, me]);

  const distOf = useCallback(
    (e: Elon) => (me ? distanceKm(me.lat, me.lng, e.lat as number, e.lng as number) : undefined),
    [me],
  );

  // ── Pinlar va klasterlar ───────────────────────────────────────────────
  const nodes: Node[] = useMemo(() => {
    const map = mapRef.current;
    if (!ready || !map) return [];
    const out: Node[] = [];
    const rest: ClusterInput<Elon>[] = [];

    for (const e of visible) {
      const p: Point = map.latLngToContainerPoint([e.lat as number, e.lng as number]);
      // Tanlangan e'lon hech qachon klaster ichida yashirinmaydi.
      if (e.id === selected) out.push({ key: `sel-${e.id}`, x: p.x, y: p.y, items: [e] });
      else rest.push({ key: e.id, x: p.x, y: p.y, item: e });
    }
    out.push(...clusterByRadius(rest, CLUSTER_RADIUS));
    return out;
    // `tick` — xarita har surilganda proyeksiya qayta hisoblanishi uchun kerak
    // (natija mapRef ichidagi holatga bog'liq, uni linter ko'rmaydi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ready, selected, tick]);

  const selectedElon = visible.find((e) => e.id === selected) || null;
  const selectedPoint =
    ready && mapRef.current && selectedElon
      ? (mapRef.current.latLngToContainerPoint([
          selectedElon.lat as number,
          selectedElon.lng as number,
        ]) as Point)
      : null;

  const boxW = boxRef.current?.clientWidth ?? 0;
  const POPUP_W = 290;
  const popupLeft = selectedPoint
    ? Math.min(Math.max(selectedPoint.x - POPUP_W / 2, 12), Math.max(boxW - POPUP_W - 12, 12))
    : 0;
  // Pin tepasida joy yetmasa, oyna pinning ostiga tushadi.
  const popupBelow = selectedPoint ? selectedPoint.y < 250 : false;

  return (
    <div className="grid lg:grid-cols-[392px_1fr] gap-4 items-start">
      {/* ── Ro'yxat ustuni ────────────────────────────────────────────── */}
      <div className="card overflow-hidden flex flex-col lg:h-[700px] order-2 lg:order-1">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <b className="text-[13.5px] heading">
            {visible.length} <T>ta e'lon</T>
            {drill ? <span className="muted font-medium"> · <T>tanlangan to'plamda</T></span>
                   : area ? <span className="muted font-medium"> · <T>ushbu hududda</T></span>
                   : null}
          </b>
          <span className="ml-auto text-[11.5px] subtle"><T>Xarita bo'ylab suring</T></span>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 pb-3.5 flex flex-col gap-2.5">
          {loading ? (
            <div className="py-10 grid place-items-center"><Loader2 className="animate-spin muted" size={20} /></div>
          ) : visible.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm muted">
              <T>Bu hududda e'lon topilmadi. Xaritani suring yoki filtrlarni o'zgartiring.</T>
            </div>
          ) : (
            visible.map((e) => (
              <JobMiniCard
                key={e.id}
                e={e}
                active={selected === e.id}
                distKm={distOf(e)}
                onSelect={focus}
                onHover={setHovered}
              />
            ))
          )}
        </div>

        {noGeoCount > 0 && (
          <div className="px-4 py-2.5 text-[11.5px] subtle border-t" style={{ borderColor: "var(--border)" }}>
            {noGeoCount} <T>ta e'londa joylashuv belgilanmagan — ular ro'yxat ko'rinishida ko'rinadi.</T>
          </div>
        )}
      </div>

      {/* ── Xarita ────────────────────────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden border order-1 lg:order-2 h-[420px] lg:h-[700px] isolate"
        style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}
      >
        <div ref={boxRef} className="absolute inset-0" />

        {(!ready || failed) && (
          <div className="absolute inset-0 grid place-items-center text-sm muted gap-2">
            {failed ? <T>Xaritani yuklab bo'lmadi. Internet aloqasini tekshiring.</T>
                    : <Loader2 className="animate-spin" size={20} />}
          </div>
        )}

        {/* Pinlar va klasterlar */}
        {ready && !failed && (
          <div className="absolute inset-0 pointer-events-none">
            {nodes.map((n) =>
              n.items.length > 1 ? (
                <ClusterPin key={n.key} node={n} onClick={() => openCluster(n)} label={t("ta e'lon — ochish")} />
              ) : (
                <PricePin
                  key={n.key}
                  e={n.items[0]}
                  x={n.x}
                  y={n.y}
                  state={
                    n.items[0].id === selected ? "active"
                      : n.items[0].id === hovered ? "hover"
                      : seen.has(n.items[0].id) ? "seen"
                      : "new"
                  }
                  onClick={() => focus(n.items[0])}
                />
              ),
            )}
          </div>
        )}

        {/* Tanlangan e'lon oynasi */}
        {ready && selectedElon && selectedPoint && (
          <div
            className="absolute z-[500] w-[290px] rounded-2xl p-3.5 animate-scale-in"
            style={{
              left: popupLeft,
              top: popupBelow ? selectedPoint.y + 22 : undefined,
              bottom: popupBelow ? undefined : `calc(100% - ${selectedPoint.y - 22}px)`,
              background: "var(--card)",
              boxShadow: "var(--shadow-pop)",
            }}
          >
            <div className="flex items-center gap-2">
              {selectedElon.categoryName && (
                <span
                  className="tag-cat"
                  style={{
                    background: catTone(selectedElon.categoryName).bg,
                    color: catTone(selectedElon.categoryName).fg,
                  }}
                >
                  <T>{selectedElon.categoryName}</T>
                </span>
              )}
              <button
                onClick={() => setSelected(null)}
                className="ml-auto p-1 rounded-md subtle hover:bg-[color:var(--bg-subtle)] transition"
                aria-label={t("Yopish")}
              >
                <X size={14} />
              </button>
            </div>

            <Link href={`/elon/${selectedElon.id}`} className="block mt-2.5">
              <h3 className="text-[15px] font-bold heading leading-[1.34] tracking-[-0.2px] line-clamp-2 hover:opacity-80 transition">
                <T>{selectedElon.title}</T>
              </h3>
            </Link>

            <div className="mt-3 flex flex-col gap-1.5 text-[12.5px] muted">
              <span className="inline-flex items-center gap-2">
                <MapPin size={13} className="subtle shrink-0" />
                <span className="truncate">
                  <T>{selectedElon.locationText || [selectedElon.district, selectedElon.region].filter(Boolean).join(", ") || "Joylashuv ko'rsatilmagan"}</T>
                  {distOf(selectedElon) != null ? ` · ${fmtKm(distOf(selectedElon)!)}` : ""}
                </span>
              </span>
              {(selectedElon.startDate || selectedElon.workTimeFrom) && (
                <span className="inline-flex items-center gap-2">
                  <Clock size={13} className="subtle shrink-0" />
                  <T>{fmtWhen(selectedElon.startDate, selectedElon.workTimeFrom)}</T>
                  {selectedElon.workTimeTo ? ` — ${selectedElon.workTimeTo}` : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-2">
                <Users size={13} className="subtle shrink-0" />
                {selectedElon.workersNeeded} <T>ta ishchi kerak</T>
              </span>
            </div>

            <div className="divider my-3" />

            <div className="flex items-end gap-2">
              <div>
                <div className="text-base font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                  {selectedElon.pricingType === "negotiable"
                    ? <T>Kelishiladi</T>
                    : `${fmtSum(selectedElon.perWorkerAmount || selectedElon.priceAmount)} so'm`}
                </div>
                <div className="text-[11.5px] subtle mt-0.5"><T>kunlik</T></div>
              </div>
              <Link
                href={`/elon/${selectedElon.id}#ariza`}
                className="ml-auto btn btn-primary btn-sm !font-semibold"
              >
                <T>Ariza yuborish</T>
              </Link>
            </div>
          </div>
        )}

        {/* "Shu hududda qidirish" */}
        {ready && !failed && (moved || area || drill) && (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 z-[520] flex items-center gap-2">
            {moved && (
              <button
                onClick={searchArea}
                className="inline-flex items-center gap-2 h-[38px] px-4 rounded-full text-[13.5px] font-semibold transition hover:opacity-90"
                style={{ background: "var(--card)", color: "var(--brand)", boxShadow: "var(--shadow-pop)" }}
              >
                <RefreshCw size={14} /><T>Shu hududda qidirish</T>
              </button>
            )}
            {(area || drill) && (
              <button
                onClick={clearArea}
                className="inline-flex items-center gap-1.5 h-[38px] px-3.5 rounded-full text-[12.5px] font-semibold muted transition hover:opacity-90"
                style={{ background: "var(--card)", boxShadow: "var(--shadow-pop)" }}
              >
                <X size={13} />
                {drill ? <T>Barcha e'lonlar</T> : <T>Butun hudud</T>}
              </button>
            )}
          </div>
        )}

        {/* Xarita boshqaruvi */}
        {ready && !failed && (
          <div className="absolute top-5 right-5 z-[520] flex flex-col gap-2.5">
            <button onClick={openFullMap} className="map-ctrl" aria-label={t("Kattaroq xaritada ochish")}>
              <Layers size={18} />
            </button>
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--shadow-pop)" }}>
              <button onClick={() => zoom(1)} className="map-ctrl !rounded-none !shadow-none" aria-label={t("Kattalashtirish")}>
                <Plus size={18} />
              </button>
              <div className="divider" />
              <button onClick={() => zoom(-1)} className="map-ctrl !rounded-none !shadow-none" aria-label={t("Kichiklashtirish")}>
                <Minus size={18} />
              </button>
            </div>
            <button onClick={locateMe} className="map-ctrl" aria-label={t("Mening joylashuvim")}>
              {geoBusy ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
            </button>
          </div>
        )}

        {/* Izoh */}
        {ready && !failed && (
          <div
            className="absolute left-5 bottom-7 z-[520] h-[34px] px-3.5 rounded-full flex items-center gap-3.5 text-[11.5px] muted"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-pop)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--brand)", background: "var(--card)" }} />
              <T>Yangi e'lon</T>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-full" style={{ background: "var(--brand)" }} />
              <T>Tanlangan</T>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--border-strong)", background: "var(--card)" }} />
              <T>Ko'rilgan</T>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Klaster raqami — bir joyga to'plangan ishlar soni. Soni ortgan sari doira
 * kattalashadi, shuning uchun katta to'plamlar xaritada darrov ko'zga tashlanadi.
 */
function ClusterPin({ node, onClick, label }: { node: Node; onClick: () => void; label: string }) {
  const n = node.items.length;
  const size = n < 10 ? 46 : n < 50 ? 54 : 62;
  const font = n < 10 ? 15 : n < 50 ? 16 : 17;
  return (
    <button
      onClick={onClick}
      className="absolute pointer-events-auto grid place-items-center rounded-full text-white font-bold tabular-nums transition hover:scale-110"
      style={{
        left: node.x,
        top: node.y,
        height: size,
        width: size,
        fontSize: font,
        transform: "translate(-50%,-50%)",
        zIndex: 430,
        background: "var(--brand)",
        boxShadow: "0 0 0 5px rgba(47,107,255,0.22), var(--shadow-pop)",
      }}
      aria-label={`${n} ${label}`}
      title={`${n} ${label}`}
    >
      {n}
    </button>
  );
}

/** Xaritadagi narx pini — Figma "Pin": oq pill, ko'k matn, tanlangani to'q ko'k. */
function PricePin({
  e, x, y, state, onClick,
}: {
  e: Elon;
  x: number;
  y: number;
  state: "new" | "hover" | "seen" | "active";
  onClick: () => void;
}) {
  const active = state === "active";
  const seen = state === "seen";
  return (
    <button
      onClick={onClick}
      className="absolute pointer-events-auto h-8 px-3.5 rounded-full text-[13px] font-bold tabular-nums whitespace-nowrap transition hover:scale-105"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%,-50%)",
        zIndex: active ? 460 : state === "hover" ? 450 : 440,
        background: active ? "var(--brand)" : "var(--card)",
        color: active ? "#fff" : seen ? "var(--text-subtle)" : "var(--brand)",
        boxShadow: state === "hover" || active ? "var(--shadow-pop)" : "var(--shadow-card)",
        outline: state === "hover" ? "2px solid var(--brand)" : undefined,
      }}
      title={e.title}
    >
      {e.pricingType === "negotiable" ? "—" : fmtCompactSum(e.perWorkerAmount || e.priceAmount)}
    </button>
  );
}
