/**
 * Feed'dagi e'lon kartasi.
 *
 * Web'dagi JobMiniCard'ning mobil varianti: bir ustunli, butun karta bosiladi
 * (kichik "Batafsil" tugmasini barmoq bilan topish qiyin), meta qatori joy
 * yetmasa o'ralib tushadi.
 */

import { memo } from "react";
import { ClockIcon, MapPinIcon, UsersIcon } from "./icons";
import { catTone } from "@/lib/cat-color";
import { fmtSum, fmtWhen } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import type { Elon } from "@/lib/api";

export const JobCard = memo(function JobCard({
  e,
  onOpen,
}: {
  e: Elon;
  onOpen: (id: string) => void;
}) {
  const tone = catTone(e.categoryName);
  const place = e.locationText || [e.district, e.region].filter(Boolean).join(", ");
  const when = fmtWhen(e.startDate, e.workTimeFrom);
  const negotiable = e.pricingType === "negotiable";
  const cover = e.images?.[0];

  // Nechta o'rin qolgani — ishchi uchun eng muhim raqamlardan biri.
  const left = Math.max(0, (e.workersNeeded || 0) - (e.acceptedCount || 0));

  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onOpen(e.id);
      }}
      className="card w-full overflow-hidden text-left transition active:scale-[0.99] animate-fade-in"
    >
      {cover && (
        // aspect-ratio qutisi: rasm yuklanguncha ham joy band bo'ladi, ya'ni
        // ro'yxat sakramaydi (layout shift).
        <div className="w-full overflow-hidden" style={{ aspectRatio: "16 / 9", background: "var(--bg-subtle)" }}>
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={(ev) => {
              ev.currentTarget.parentElement?.style.setProperty("display", "none");
            }}
          />
        </div>
      )}

      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center gap-2">
          {e.categoryName && (
            <span className="tag-cat" style={{ background: tone.bg, color: tone.fg }}>
              {e.categoryName}
            </span>
          )}
          {left > 0 && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11.5px] subtle">
              <UsersIcon size={12} />
              {left} o'rin
            </span>
          )}
        </div>

        <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 tracking-[-0.15px] heading">
          {e.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs muted">
          {place && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPinIcon size={12} className="subtle shrink-0" />
              <span className="truncate">{place}</span>
            </span>
          )}
          {when && (
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon size={12} className="subtle shrink-0" />
              {when}
            </span>
          )}
        </div>

        <div className="text-[16px] font-bold tabular-nums" style={{ color: "var(--brand)" }}>
          {negotiable ? "Kelishiladi" : `${fmtSum(e.perWorkerAmount || e.priceAmount)} so'm`}
        </div>
      </div>
    </button>
  );
});
