"use client";
import { T } from "@/components/T";

/**
 * Ish o'rinlari to'lishini ko'rsatuvchi progress-bar. Qabul qilingan kishilar
 * soni (accepted) / kerakli son (needed). Bar chapdan o'ngga to'ladi va to'la
 * bo'lmaguncha ustidan yorug'lik yugurib turadi (jarayon davom etayotganini
 * bildiradi). To'lganda yashil + "Joy to'ldi".
 */
export function SlotProgress({ accepted, needed }: { accepted: number; needed: number }) {
  const total = Math.max(1, needed);
  const acc = Math.max(0, Math.min(accepted, total));
  const pct = Math.round((acc / total) * 100);
  const full = needed > 0 && accepted >= needed;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-[color:var(--text-muted)]">
          <T>To'ldi</T>: <span className="font-semibold text-[color:var(--text)]">{acc}/{needed}</span> <T>kishi</T>
        </span>
        {full ? (
          <span className="badge-success text-[10px]"><T>Joy to'ldi</T></span>
        ) : (
          <span className="badge-amber text-[10px]">{total - acc} <T>joy qoldi</T></span>
        )}
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-subtle)" }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: full ? "#16a34a" : "linear-gradient(90deg, var(--brand), var(--tg))",
          }}
        >
          {!full && pct > 0 && (
            <span className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/40 animate-[slot-shimmer_1.6s_linear_infinite]" />
          )}
        </div>
      </div>
    </div>
  );
}
