"use client";
import { useEffect, useRef, useState } from "react";
import { Navigation, Loader2, ExternalLink } from "lucide-react";
import { loadLeaflet, distanceKm } from "@/lib/leaflet";

interface Props {
  lat: number;
  lng: number;
  label?: string;
  height?: number;
}

/**
 * Ish joyini xaritada ko'rsatadi. Foydalanuvchi joylashuviga ruxsat bersa,
 * uning turgan joyidan ish joyigacha bo'lgan masofani hisoblaydi va Google/
 * Yandex xaritalarida yo'l ko'rsatish havolalarini beradi.
 */
export function MapView({ lat, lng, label, height = 200 }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [dist, setDist] = useState<number | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !elRef.current || mapRef.current) return;
        const map = L.map(elRef.current, { scrollWheelZoom: false }).setView([lat, lng], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        L.marker([lat, lng]).addTo(map).bindPopup(label || "Ish joyi");
        mapRef.current = map;
        setLoading(false);
        setTimeout(() => map.invalidateSize(), 200);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function calcDistance() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const my = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setMe(my);
      setDist(distanceKm(my.lat, my.lng, lat, lng));
      const L = (window as any).L;
      if (mapRef.current && L) {
        L.circleMarker([my.lat, my.lng], { radius: 7, color: "#2347B0" })
          .addTo(mapRef.current)
          .bindPopup("Siz");
        const group = L.featureGroup([
          L.marker([lat, lng]),
          L.circleMarker([my.lat, my.lng]),
        ]);
        mapRef.current.fitBounds(group.getBounds().pad(0.3));
      }
    });
  }

  const gmaps = me
    ? `https://www.google.com/maps/dir/?api=1&origin=${me.lat},${me.lng}&destination=${lat},${lng}`
    : `https://www.google.com/maps?q=${lat},${lng}`;
  const ymaps = me
    ? `https://yandex.com/maps/?rtext=${me.lat},${me.lng}~${lat},${lng}&rtt=auto`
    : `https://yandex.com/maps/?pt=${lng},${lat}&z=15`;

  return (
    <div>
      <div className="relative isolate rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)", height }}>
        <div ref={elRef} style={{ height, width: "100%" }} />
        {loading && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="animate-spin muted" size={20} />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {dist == null ? (
          <button type="button" onClick={calcDistance} className="btn-secondary btn-sm gap-1">
            <Navigation size={13} /> Masofani hisoblash
          </button>
        ) : (
          <span className="badge-success">
            <Navigation size={12} /> Sizdan ~{dist < 1 ? Math.round(dist * 1000) + " m" : dist.toFixed(1) + " km"}
          </span>
        )}
        <a href={gmaps} target="_blank" rel="noreferrer" className="btn-secondary btn-sm gap-1">
          <ExternalLink size={13} /> Google Maps
        </a>
        <a href={ymaps} target="_blank" rel="noreferrer" className="btn-secondary btn-sm gap-1">
          <ExternalLink size={13} /> Yandex
        </a>
      </div>
    </div>
  );
}
