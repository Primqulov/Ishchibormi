"use client";
import { memo } from "react";
import Link from "next/link";
import { MapPin, Clock } from "lucide-react";
import { Elon } from "@/lib/api";
import { fmtSum, fmtWhen, fmtKm } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { T } from "./T";

/**
 * Figma "04b · Xarita ko'rinishi" dagi ixcham e'lon kartasi (364×137).
 * Xarita yonidagi ro'yxat ustuni uchun: teg + masofa, sarlavha, meta qatori,
 * narx va "Batafsil". Tanlangani ko'k ramka + bg/blue-50 fon bilan ajraladi.
 */
export const JobMiniCard = memo(function JobMiniCard({
  e,
  active,
  distKm,
  onSelect,
  onHover,
}: {
  e: Elon;
  active?: boolean;
  /** Foydalanuvchi joylashuviga ruxsat bergan bo'lsa — undan masofa. */
  distKm?: number;
  onSelect?: (e: Elon) => void;
  onHover?: (id: string | null) => void;
}) {
  const tone = catTone(e.categoryName);
  const place = e.locationText || [e.district, e.region].filter(Boolean).join(", ");
  const when = fmtWhen(e.startDate, e.workTimeFrom);
  const negotiable = e.pricingType === "negotiable";

  return (
    <div
      onClick={() => onSelect?.(e)}
      onMouseEnter={() => onHover?.(e.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`cursor-pointer rounded-xl p-3 flex flex-col gap-2.5 transition ${
        active ? "border-2" : "border hover:shadow-pop"
      }`}
      style={{
        borderColor: active ? "var(--brand)" : "var(--border)",
        background: active ? "var(--brand-soft)" : "var(--card)",
        padding: active ? "11px" : "12px",
      }}
    >
      <div className="flex items-center gap-2">
        {e.categoryName && (
          <span className="tag-cat" style={{ background: tone.bg, color: tone.fg }}>
            <T>{e.categoryName}</T>
          </span>
        )}
        {distKm != null && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] subtle shrink-0">
            <MapPin size={11} />
            {fmtKm(distKm)}
          </span>
        )}
      </div>

      <h3 className="text-[14.5px] font-semibold heading leading-5 tracking-[-0.15px] line-clamp-2">
        <T>{e.title}</T>
      </h3>

      <div className="flex items-center gap-3.5 flex-wrap text-xs muted">
        {place && (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <MapPin size={12} className="subtle shrink-0" />
            <span className="truncate"><T>{place}</T></span>
          </span>
        )}
        {when && (
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} className="subtle shrink-0" /><T>{when}</T>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="text-[15.5px] font-bold tabular-nums" style={{ color: "var(--brand)" }}>
          {negotiable ? <T>Kelishiladi</T> : `${fmtSum(e.perWorkerAmount || e.priceAmount)} so'm`}
        </div>
        <Link
          href={`/elon/${e.id}`}
          onClick={(ev) => ev.stopPropagation()}
          className="ml-auto rounded-lg px-3.5 py-[7px] text-[12.5px] font-semibold transition"
          style={
            active
              ? { background: "var(--brand)", color: "#fff" }
              : { background: "var(--brand-soft)", color: "var(--brand)" }
          }
        >
          <T>Batafsil</T>
        </Link>
      </div>
    </div>
  );
});
