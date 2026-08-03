/**
 * E'lon kartasi — Figma maketidagi "Article - Job Card".
 *
 * Tuzilishi maketdan: turkum yorlig'i va sarlavha chapda, narx o'ng yuqorida
 * yirik ko'k raqamda (ishchi uchun eng muhim ma'lumot — u ro'yxatni ko'z bilan
 * narx bo'yicha skanerlaydi), pastda ajratuvchi chiziq ostida ish beruvchi va
 * asosiy amal.
 *
 * Butun karta bosiladi. Maketdagi "Qabul qilish" tugmasi ham e'lon
 * tafsilotiga olib boradi, darhol ariza yubormaydi: ariza qaytarib
 * bo'lmaydigan amal va tasdiqlash tafsilot ekranida (Telegram'ning
 * MainButton'i orqali) bo'ladi — maketda ham u yerda alohida tasdiqlash
 * modali chizilgan.
 */

import { memo } from "react";
import { ClockIcon, MapPinIcon, StarIcon } from "./icons";
import { Avatar } from "./ui";
import { catTone } from "@/lib/cat-color";
import { fmtCompactSum, fmtWhen, fromNow } from "@/lib/format";
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
  const amount = e.perWorkerAmount || e.priceAmount;
  const rating = 0; // Feed javobida ish beruvchi reytingi yo'q — quyida yashiriladi.

  const open = () => {
    haptic.tap();
    onOpen(e.id);
  };

  return (
    <article className="job-card">
      {/* Butun karta bosiladigan sath. Ichkaridagi tugma ustidan
          o'tmasligi uchun u alohida z-qatlamda turadi. */}
      <button
        type="button"
        onClick={open}
        className="absolute inset-0 z-0"
        aria-label={`${e.title} — batafsil`}
      />

      <div className="pointer-events-none relative z-[1] flex flex-col gap-3">
        {/* Yuqori qator: turkum + sarlavha | narx */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-[5px]">
            {e.categoryName && (
              <span
                className="tag-cat self-start !font-normal"
                style={{ background: tone.bg, color: tone.fg }}
              >
                {e.categoryName}
              </span>
            )}
            <h3 className="line-clamp-2 text-[18px] font-semibold leading-[22.5px] heading">
              {e.title}
            </h3>
          </div>

          <div className="shrink-0 text-right">
            <p
              className="text-[20px] font-bold leading-7 tabular-nums"
              style={{ color: "var(--brand)" }}
            >
              {negotiable ? "Kelishiladi" : `${fmtCompactSum(amount)} UZS`}
            </p>
            {!negotiable && <p className="text-[14px] leading-5 muted">/kuniga</p>}
          </div>
        </div>

        {/* Meta: joy va vaqt */}
        {(place || when) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
            {place && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[14px] leading-5 muted">
                <MapPinIcon size={13} className="shrink-0 subtle" />
                <span className="truncate">{place}</span>
              </span>
            )}
            {when && (
              <span className="inline-flex items-center gap-1.5 text-[14px] leading-5 muted">
                <ClockIcon size={13} className="shrink-0 subtle" />
                {when}
              </span>
            )}
          </div>
        )}

        {/* Pastki qator: ish beruvchi | amal */}
        <div
          className="flex items-center justify-between gap-3 pt-[13px]"
          style={{ borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Avatar src={e.ownerAvatarUrl} firstName={e.ownerName} size={32} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-[16.25px] heading">
                {e.ownerName || "Ish beruvchi"}
              </p>
              {rating > 0 ? (
                <span
                  className="inline-flex items-center gap-0.5"
                  style={{ color: "var(--accent)" }}
                >
                  <StarIcon size={10} />
                  <span className="rating">{rating.toFixed(1)}</span>
                </span>
              ) : (
                <span className="text-[10px] leading-[15px] subtle">
                  {fromNow(e.publishedAt || e.createdAt)}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={open}
            className="pointer-events-auto relative z-[2] shrink-0 rounded-lg px-5 py-2 text-[16px] font-semibold leading-5 text-white transition active:scale-[0.97]"
            style={{ background: "var(--brand-light)", boxShadow: "0 1px 1px rgba(0,0,0,.05)" }}
          >
            Ko'rish
          </button>
        </div>
      </div>
    </article>
  );
});
