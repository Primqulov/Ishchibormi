/**
 * E'lon tafsiloti.
 *
 * Asosiy amal ("Ariza berish") sahifa ichidagi tugma emas, Telegram'ning
 * MainButton'i: u klaviatura ustida turadi, tizim ranglarida bo'ladi va
 * foydalanuvchi uni boshqa Mini App'lardan taniydi.
 */

import { useEffect, useState } from "react";
import { ClockIcon, MapPinIcon, PhoneIcon, UsersIcon, CheckIcon } from "@/components/icons";
import { Avatar, ErrorState, Spinner } from "@/components/ui";
import { catTone } from "@/lib/cat-color";
import { fmtDate, fmtSum, fmtWhen, fromNow } from "@/lib/format";
import {
  applyToElon,
  fetchElon,
  GENDER_LABEL,
  type APIError,
  type Elon,
} from "@/lib/api";
import { alertUser, haptic, openExternal, showMainButton } from "@/lib/telegram";

export function JobDetail({
  id,
  onApplied,
}: {
  id: string;
  /** Ariza yuborilgach — "Arizalarim" ro'yxatini yangilash uchun. */
  onApplied: () => void;
}) {
  const [elon, setElon] = useState<Elon | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError(null);
    setElon(null);
    fetchElon(id)
      .then((e) => !ignore && setElon(e))
      .catch((e: APIError) => !ignore && setError(e));
    return () => {
      ignore = true;
    };
  }, [id, reload]);

  const left = elon ? Math.max(0, (elon.workersNeeded || 0) - (elon.acceptedCount || 0)) : 0;
  const open = elon?.status === "recruiting" && left > 0;

  // MainButton — e'lon holatiga qarab paydo bo'ladi/yo'qoladi.
  useEffect(() => {
    if (!elon) return;
    if (applied) {
      return showMainButton("✓ Ariza yuborildi", () => {}, { disabled: true });
    }
    if (!open) return; // yopiq e'londa tugma umuman ko'rsatilmaydi

    return showMainButton(
      "Ariza berish",
      async () => {
        if (applying) return;
        setApplying(true);
        try {
          await applyToElon(elon.id, { peopleCount: 1 });
          haptic.success();
          setApplied(true);
          onApplied();
        } catch (e) {
          const err = e as APIError;
          haptic.error();
          // Backend'ning xabari aniq bo'ladi ("allaqachon ariza berilgan",
          // "o'z e'loningizga ariza bera olmaysiz", ...) — uni o'zgartirmaymiz.
          alertUser(err.message || "Ariza yuborilmadi. Qayta urinib ko'ring.");
        } finally {
          setApplying(false);
        }
      },
      { loading: applying },
    );
  }, [applied, applying, elon, onApplied, open]);

  if (error) return <ErrorState error={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!elon) return <Spinner label="Yuklanmoqda..." />;

  const tone = catTone(elon.categoryName);
  const place = elon.locationText || [elon.district, elon.region].filter(Boolean).join(", ");
  const negotiable = elon.pricingType === "negotiable";
  const images = elon.images || [];

  // Xarita havolasi: e'londa aniq URL bo'lsa o'sha, bo'lmasa koordinatadan.
  const mapUrl =
    elon.locationUrl ||
    (elon.lat != null && elon.lng != null
      ? `https://maps.google.com/?q=${elon.lat},${elon.lng}`
      : "");

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Rasm karuseli — barmoq bilan suriladi, JS kutubxonasiz (scroll-snap). */}
      {images.length > 0 && (
        <div
          className="no-scrollbar snap-x-mandatory flex overflow-x-auto"
          style={{ aspectRatio: "16 / 9", background: "var(--bg-subtle)" }}
        >
          {images.map((src, i) => (
            <img
              key={src + i}
              src={src}
              alt=""
              // Birinchi rasm darhol, qolganlari surilganda yuklansin.
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="snap-center h-full w-full shrink-0 object-cover"
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {elon.categoryName && (
              <span className="tag-cat" style={{ background: tone.bg, color: tone.fg }}>
                {elon.categoryName}
              </span>
            )}
            {!open && (
              <span className="badge-neutral">
                {elon.status === "completed" ? "Yakunlangan"
                  : elon.status === "cancelled" ? "Bekor qilingan"
                  : left === 0 ? "O'rinlar to'lgan"
                  : "Yopiq"}
              </span>
            )}
          </div>

          <h1 className="text-[22px] font-black leading-tight tracking-[-0.4px] heading">
            {elon.title}
          </h1>

          <p className="text-[12.5px] subtle">
            E'lon berilgan: {fromNow(elon.publishedAt || elon.createdAt)}
          </p>
        </div>

        {/* Narx paneli */}
        <div className="surface flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.5px] subtle">
              {negotiable ? "To'lov" : elon.pricingType === "total" ? "Umumiy summa" : "Bir ishchiga"}
            </p>
            <p className="text-[20px] font-black tabular-nums" style={{ color: "var(--brand)" }}>
              {negotiable ? "Kelishiladi" : `${fmtSum(elon.perWorkerAmount || elon.priceAmount)} so'm`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.5px] subtle">Kerak</p>
            <p className="inline-flex items-center gap-1.5 text-[15px] font-bold heading">
              <UsersIcon size={15} className="subtle" />
              {elon.acceptedCount || 0}/{elon.workersNeeded || 0}
            </p>
          </div>
        </div>

        {/* Asosiy ma'lumotlar */}
        <div className="card flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
          <Row
            icon={<ClockIcon size={17} />}
            label="Qachon"
            value={fmtWhen(elon.startDate, elon.workTimeFrom) || fmtDate(elon.startDate) || "—"}
            hint={
              elon.workTimeFrom && elon.workTimeTo
                ? `${elon.workTimeFrom} — ${elon.workTimeTo}`
                : undefined
            }
          />
          {place && (
            <Row
              icon={<MapPinIcon size={17} />}
              label="Manzil"
              value={place}
              action={
                mapUrl
                  ? {
                      text: "Xaritada",
                      onClick: () => {
                        haptic.tap();
                        openExternal(mapUrl);
                      },
                    }
                  : undefined
              }
            />
          )}
          {elon.gender && (
            <Row icon={<UsersIcon size={17} />} label="Kimlar uchun" value={GENDER_LABEL[elon.gender]} />
          )}
          {elon.contactPhone && (
            <Row
              icon={<PhoneIcon size={17} />}
              label="Aloqa"
              value={elon.contactPhone}
              action={{
                text: "Qo'ng'iroq",
                onClick: () => {
                  haptic.tap();
                  openExternal(`tel:${elon.contactPhone}`);
                },
              }}
            />
          )}
        </div>

        {elon.description && (
          <div className="flex flex-col gap-2">
            <h2 className="section-title">Ish haqida</h2>
            <p className="whitespace-pre-line text-[14px] leading-relaxed muted">
              {elon.description}
            </p>
          </div>
        )}

        {/* Ish beruvchi */}
        {elon.ownerName && (
          <div className="flex flex-col gap-2">
            <h2 className="section-title">Ish beruvchi</h2>
            <div className="card flex items-center gap-3 p-3.5">
              <Avatar src={elon.ownerAvatarUrl} firstName={elon.ownerName} size={44} />
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-bold heading">{elon.ownerName}</p>
                <p className="text-[12.5px] subtle">Ish beruvchi</p>
              </div>
            </div>
          </div>
        )}

        {applied && (
          <div
            className="flex items-center gap-2.5 rounded-xl p-3.5 text-[13.5px] font-semibold"
            style={{ background: "#DFF5E5", color: "#1A7F3C" }}
          >
            <CheckIcon size={18} />
            Arizangiz yuborildi. Javobni "Arizalarim" bo'limida kuzating.
          </div>
        )}

        {!open && !applied && (
          <p className="rounded-xl p-3.5 text-center text-[13px] muted" style={{ background: "var(--bg-subtle)" }}>
            Bu e'longa hozir ariza berib bo'lmaydi.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  action?: { text: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <span className="shrink-0 subtle">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.4px] subtle">{label}</p>
        <p className="truncate text-[14px] font-semibold heading">{value}</p>
        {hint && <p className="text-[12px] subtle">{hint}</p>}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="btn-soft shrink-0 !min-h-[36px] !px-3.5 !py-2 !text-[12.5px]">
          {action.text}
        </button>
      )}
    </div>
  );
}
