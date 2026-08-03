/** Kichik umumiy UI bo'laklari: avatar, holat ekranlari, skeletonlar. */

import { AlertIcon, InboxIcon, RefreshIcon } from "./icons";
import { initials } from "@/lib/format";
import type { APIError } from "@/lib/api";

// ── Avatar ────────────────────────────────────────────────────────────

export function Avatar({
  src,
  firstName,
  lastName,
  size = 44,
}: {
  src?: string;
  firstName?: string;
  lastName?: string;
  size?: number;
}) {
  const label = initials(firstName, lastName);
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-bold"
      style={{
        width: size,
        height: size,
        background: "var(--brand-100)",
        color: "var(--brand)",
        fontSize: Math.round(size * 0.36),
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          // Rasm yuklanmasa (o'chirilgan URL, oflayn) bo'sh kvadrat qolmasin —
          // elementni yashiramiz va ostidagi bosh harflar ko'rinadi.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      {!src && label}
    </span>
  );
}

// ── Holat ekranlari ───────────────────────────────────────────────────

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center animate-fade-in">
      <span
        className="grid h-14 w-14 place-items-center rounded-full"
        style={{ background: "var(--bg-subtle)", color: "var(--text-subtle)" }}
      >
        {icon ?? <InboxIcon size={26} />}
      </span>
      <p className="text-[15px] font-bold heading">{title}</p>
      {hint && <p className="max-w-[280px] text-[13px] muted leading-relaxed">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: APIError; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center animate-fade-in">
      <span
        className="grid h-14 w-14 place-items-center rounded-full"
        style={{ background: "#FEE4E2", color: "#B42318" }}
      >
        <AlertIcon size={26} />
      </span>
      <p className="text-[15px] font-bold heading">Xatolik yuz berdi</p>
      <p className="max-w-[300px] text-[13px] muted leading-relaxed">{error.message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-soft mt-1">
          <RefreshIcon size={16} />
          Qayta urinish
        </button>
      )}
    </div>
  );
}

// ── Skeletonlar ───────────────────────────────────────────────────────
// Sekin tarmoqda bo'sh oq ekran o'rniga sahifaning shakli ko'rinib tursin.

export function JobCardSkeleton() {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="skeleton h-4 w-20 rounded-full" />
      <div className="skeleton h-5 w-3/4" />
      <div className="flex gap-3">
        <div className="skeleton h-3.5 w-24" />
        <div className="skeleton h-3.5 w-20" />
      </div>
      <div className="skeleton h-6 w-32" />
    </div>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Sahifa markazidagi kichik yuklanish indikatori. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <span
        className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-transparent"
        style={{ borderTopColor: "var(--brand)", borderRightColor: "var(--brand)" }}
      />
      {label && <p className="text-[13px] muted">{label}</p>}
    </div>
  );
}
