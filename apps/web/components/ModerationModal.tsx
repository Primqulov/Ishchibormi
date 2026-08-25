"use client";
import { useEffect } from "react";
import { AlertTriangle, ShieldX, X } from "lucide-react";
import { APIError } from "@/lib/api";
import { T } from "@/components/T";

/**
 * Kontent moderatsiyasi rad etganda chiqadigan modal oyna.
 *
 * Backend rad etish xatosida `error.details` qaytaradi:
 *   { reason, warning?, strikes?, strikeLimit?, bannedUntil? }
 *
 * Bu yerda ular ikki qismga bo'lib ko'rsatiladi — MUAMMO SABABI va
 * OGOHLANTIRISH — chunki foydalanuvchi uchun bu ikki xil ma'lumot:
 * biri "nima bo'ldi", ikkinchisi "yana takrorlansa nima bo'ladi".
 */

/** Moderatsiya rad etishimi — shu kodlar modal chiqarishi kerak. */
export function isModerationError(e: unknown): e is APIError {
  const code = (e as APIError | undefined)?.code;
  return code === "content_rejected" || code === "image_rejected" || code === "account_banned";
}

interface Props {
  error: APIError | null;
  onClose: () => void;
}

export function ModerationModal({ error, onClose }: Props) {
  // Escape bilan yopish + fon aylanishini to'xtatish.
  useEffect(() => {
    if (!error) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [error, onClose]);

  if (!error) return null;

  const d = (error.details || {}) as {
    reason?: string;
    warning?: string;
    strikes?: number;
    strikeLimit?: number;
    bannedUntil?: string;
  };
  const banned = error.code === "account_banned" || !!d.bannedUntil;
  // `reason` — details'dan; eski javoblarda u bo'lmasligi mumkin, u holda
  // xabarning o'zi ishlatiladi.
  const reason = d.reason || error.message;
  const strikes = typeof d.strikes === "number" ? d.strikes : undefined;
  const limit = typeof d.strikeLimit === "number" ? d.strikeLimit : undefined;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[420px] p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="absolute top-3 right-3 grid place-items-center h-8 w-8 rounded-full hover:bg-[color:var(--bg-subtle)] transition"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col items-center text-center">
          <span
            className="grid h-12 w-12 place-items-center rounded-full"
            style={{ background: banned ? "rgba(220,38,38,.12)" : "rgba(245,158,11,.15)" }}
          >
            {banned ? (
              <ShieldX size={22} className="text-danger" />
            ) : (
              <AlertTriangle size={22} style={{ color: "#d97706" }} />
            )}
          </span>
          <h2 className="mt-3 text-[17px] font-bold heading">
            {banned ? <T>Hisob bloklandi</T> : <T>Nomaqbul kontent</T>}
          </h2>
        </div>

        {/* ── Muammo sababi ─────────────────────────────── */}
        <div className="mt-4 rounded-xl p-3.5" style={{ background: "var(--bg-subtle)" }}>
          <div className="text-[11px] font-bold tracking-wide uppercase subtle">
            <T>Sabab</T>
          </div>
          <p className="mt-1 text-[14px] leading-relaxed">{reason}</p>
        </div>

        {/* ── Ogohlantirish ─────────────────────────────── */}
        {d.warning && (
          <div
            className="mt-3 rounded-xl p-3.5 border"
            style={{
              borderColor: banned ? "rgba(220,38,38,.35)" : "rgba(245,158,11,.4)",
              background: banned ? "rgba(220,38,38,.06)" : "rgba(245,158,11,.08)",
            }}
          >
            <div className="text-[11px] font-bold tracking-wide uppercase subtle">
              <T>Ogohlantirish</T>
            </div>
            <p className="mt-1 text-[14px] leading-relaxed">{d.warning}</p>

            {/* Qolgan urinishlar — vizual ko'rsatkich. */}
            {strikes !== undefined && limit !== undefined && (
              <div className="mt-2.5 flex items-center gap-1.5">
                {Array.from({ length: limit }).map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      background:
                        i < strikes ? (banned ? "#dc2626" : "#f59e0b") : "var(--border)",
                    }}
                  />
                ))}
                <span className="ml-1 text-[12px] font-semibold tabular-nums">
                  {strikes}/{limit}
                </span>
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={onClose} className="btn btn-primary w-full mt-5">
          <T>Tushunarli</T>
        </button>
      </div>
    </div>
  );
}
