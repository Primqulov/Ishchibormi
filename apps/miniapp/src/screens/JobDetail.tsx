/**
 * E'lon tafsiloti — Figma maketidagi "Ish tafsilotlari".
 *
 * Tartibi maketdan: rasm → turkum va vaqt → sarlavha → narx → ma'lumot
 * chiplari → ish beruvchi → tavsif → manzil.
 *
 * Maketda pastda ikkita tugma bor: "Bog'lanish" va "Ariza yuborish". Bu
 * yerda asosiysi Telegram'ning MainButton'ida — u klaviatura ustida turadi,
 * tizim ranglarida bo'ladi va foydalanuvchi uni boshqa Mini App'lardan
 * taniydi. "Bog'lanish" esa ish beruvchi kartasining yonida qoldi, chunki
 * MainButton bitta bo'ladi va u eng muhim amalga tegishli.
 */

import { useEffect, useState } from "react";
import {
  ClockIcon,
  MapPinIcon,
  PhoneIcon,
  UsersIcon,
  CheckIcon,
  StarIcon,
} from "@/components/icons";
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
  const [slide, setSlide] = useState(0);

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
      "Ariza yuborish",
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
    <div className="flex flex-col gap-5 pb-6 animate-fade-in">
      {/* ── Rasm karuseli (scroll-snap, JS kutubxonasiz) ─────────── */}
      {images.length > 0 && (
        <div className="relative">
          <div
            className="no-scrollbar snap-x-mandatory flex overflow-x-auto"
            style={{ aspectRatio: "16 / 10", background: "var(--bg-subtle)" }}
            onScroll={(ev) => {
              const el = ev.currentTarget;
              setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
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

          {/* Maketdagi nuqtalar — qaysi rasmda turganini ko'rsatadi. */}
          {images.length > 1 && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {images.map((_, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === slide ? 18 : 6,
                    background: i === slide ? "#fff" : "rgba(255,255,255,.55)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5 px-4">
        {/* ── Turkum, vaqt, sarlavha, narx ───────────────────────── */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {elon.categoryName && (
              <span className="tag-cat" style={{ background: tone.bg, color: tone.fg }}>
                {elon.categoryName}
              </span>
            )}
            {(fmtWhen(elon.startDate, elon.workTimeFrom) || fmtDate(elon.startDate)) && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
              >
                <ClockIcon size={12} />
                {fmtWhen(elon.startDate, elon.workTimeFrom) || fmtDate(elon.startDate)}
              </span>
            )}
            {!open && (
              <span className="badge-neutral">
                {elon.status === "completed"
                  ? "Yakunlangan"
                  : elon.status === "cancelled"
                    ? "Bekor qilingan"
                    : left === 0
                      ? "O'rinlar to'lgan"
                      : "Yopiq"}
              </span>
            )}
          </div>

          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.3px] heading">
            {elon.title}
          </h1>

          <p className="text-[24px] font-bold leading-8 tabular-nums" style={{ color: "var(--brand)" }}>
            {negotiable
              ? "Kelishiladi"
              : `${fmtSum(elon.perWorkerAmount || elon.priceAmount)} UZS`}
          </p>
        </div>

        {/* ── Ma'lumot chiplari (maketdagi "2 kishi", "Erkak") ────── */}
        <div className="flex flex-wrap gap-2">
          <InfoChip icon={<UsersIcon size={14} />} text={`${elon.workersNeeded || 1} kishi`} />
          {elon.gender && <InfoChip icon={<UsersIcon size={14} />} text={GENDER_LABEL[elon.gender]} />}
          <InfoChip
            icon={<CheckIcon size={14} />}
            text={`${elon.acceptedCount || 0}/${elon.workersNeeded || 0} to'ldi`}
          />
        </div>

        {/* ── Ish beruvchi ────────────────────────────────────────── */}
        {elon.ownerName && (
          <div className="card flex items-center gap-3 p-3.5">
            <Avatar src={elon.ownerAvatarUrl} firstName={elon.ownerName} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold heading">{elon.ownerName}</p>
              <p className="inline-flex items-center gap-1 text-[12.5px] subtle">
                <span style={{ color: "var(--accent)" }}>
                  <StarIcon size={11} />
                </span>
                Ish beruvchi · {fromNow(elon.publishedAt || elon.createdAt)}
              </p>
            </div>
            {elon.contactPhone && (
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  openExternal(`tel:${elon.contactPhone}`);
                }}
                className="btn-soft shrink-0 !min-h-[38px] !px-3.5 !py-2 !text-[13px]"
              >
                <PhoneIcon size={14} />
                Bog'lanish
              </button>
            )}
          </div>
        )}

        {/* ── Tavsif ──────────────────────────────────────────────── */}
        {elon.description && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold heading">Tavsif</h2>
            <p className="whitespace-pre-line text-[15px] leading-relaxed muted">
              {elon.description}
            </p>
          </section>
        )}

        {/* ── Manzil ──────────────────────────────────────────────── */}
        {place && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold heading">Manzil</h2>
            <div className="card overflow-hidden">
              <div className="flex items-start gap-2.5 p-3.5">
                <span className="mt-0.5 shrink-0" style={{ color: "var(--brand)" }}>
                  <MapPinIcon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium heading">{place}</p>
                  <p className="mt-0.5 text-[12.5px] subtle">
                    Aniq manzil ishga qabul qilingandan so'ng ko'rsatiladi
                  </p>
                </div>
              </div>
              {mapUrl && (
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap();
                    openExternal(mapUrl);
                  }}
                  className="w-full py-3 text-[14px] font-semibold"
                  style={{ borderTop: "1px solid var(--border)", color: "var(--brand)" }}
                >
                  Xaritada ko'rish
                </button>
              )}
            </div>
          </section>
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
          <p
            className="rounded-xl p-3.5 text-center text-[13px] muted"
            style={{ background: "var(--bg-subtle)" }}
          >
            Bu e'longa hozir ariza berib bo'lmaydi.
          </p>
        )}
      </div>
    </div>
  );
}

function InfoChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13.5px] font-medium"
      style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
    >
      <span className="subtle">{icon}</span>
      {text}
    </span>
  );
}
