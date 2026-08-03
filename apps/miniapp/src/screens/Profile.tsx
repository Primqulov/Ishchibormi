/**
 * Profil.
 *
 * Mini App'da "chiqish" tugmasi ataylab yo'q: foydalanuvchi Telegram hisobiga
 * bog'langan va ilova har ochilganda o'sha hisob bilan kiradi — chiqish
 * tugmasi faqat bir zumdan keyin qaytadan kirishga olib kelardi. Hisobni
 * o'chirish ham shu yerda emas: u tasdiqlash oqimini talab qiladi va saytda
 * (/delete-account) hamda mobil ilovada mavjud.
 */

import {
  StarIcon,
  CheckIcon,
  PhoneIcon,
  MapPinIcon,
  EditIcon,
  BriefcaseIcon,
  HistoryIcon,
  ChevronRightIcon,
} from "@/components/icons";
import { Avatar } from "@/components/ui";
import { fmtPhone } from "@/lib/format";
import { openTelegramLink, haptic } from "@/lib/telegram";
import type { User } from "@/lib/api";

const SUPPORT = "Ishchi_bormi_support";

export function Profile({
  me,
  onEdit,
  onMyElons,
  onHistory,
}: {
  me: User;
  onEdit: () => void;
  onMyElons: () => void;
  onHistory: () => void;
}) {
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ") || "Foydalanuvchi";
  const place = [me.district, me.region].filter(Boolean).join(", ");
  const rating = me.workerRating || me.rating || 0;
  const reviews = me.workerReviewsCount || me.reviewsCount || 0;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4 animate-fade-in">
      {/* Sarlavha kartasi */}
      <div className="card flex items-center gap-3.5 p-4">
        <Avatar src={me.avatarUrl} firstName={me.firstName} lastName={me.lastName} size={62} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-black tracking-[-0.3px] heading">{fullName}</h1>
          {me.phone && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] muted">
              <PhoneIcon size={13} className="subtle" />
              {fmtPhone(me.phone)}
            </p>
          )}
          {place && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] subtle">
              <MapPinIcon size={13} />
              {place}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onEdit();
          }}
          aria-label="Profilni tahrirlash"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-90"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          <EditIcon size={16} />
        </button>
      </div>

      {/* Statistika */}
      <div className="grid grid-cols-2 gap-3">
        <Stat
          icon={<CheckIcon size={16} />}
          value={String(me.completedJobsCount ?? 0)}
          label="Bajarilgan ish"
        />
        <Stat
          icon={<StarIcon size={16} />}
          value={rating > 0 ? rating.toFixed(1) : "—"}
          label={reviews > 0 ? `${reviews} ta baho` : "Hali baho yo'q"}
        />
      </div>

      {/* Bo'limlar */}
      <div className="card flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
        <MenuRow
          icon={<BriefcaseIcon size={18} />}
          label="E'lonlarim"
          hint="Bergan e'lonlaringiz va ularga kelgan arizalar"
          onClick={onMyElons}
        />
        <MenuRow
          icon={<HistoryIcon size={18} />}
          label="Ish tarixi"
          hint="Yakunlangan va bekor qilingan ishlar"
          onClick={onHistory}
        />
      </div>

      {me.bio && (
        <div className="flex flex-col gap-2">
          <h2 className="section-title">Men haqimda</h2>
          <p className="whitespace-pre-line text-[14px] leading-relaxed muted">{me.bio}</p>
        </div>
      )}

      {me.skills && me.skills.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="section-title">Ko'nikmalar</h2>
          <div className="flex flex-wrap gap-2">
            {me.skills.map((s) => (
              <span key={s} className="chip">{s}</span>
            ))}
          </div>
        </div>
      )}

      <div className="divider" />

      <button
        type="button"
        onClick={() => {
          haptic.tap();
          openTelegramLink(`https://t.me/${SUPPORT}`);
        }}
        className="btn-outline w-full"
      >
        Yordam va murojaat
      </button>

      <p className="pb-2 text-center text-[12px] subtle">
        Hisobni o'chirish saytda: ishchibormi.uz/delete-account
      </p>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="inline-flex items-center gap-1.5 subtle">{icon}</span>
      <p className="text-[22px] font-black tabular-nums heading">{value}</p>
      <p className="text-[12px] subtle">{label}</p>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="flex w-full items-center gap-3 p-4 text-left transition active:scale-[0.99]"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold heading">{label}</span>
        {hint && <span className="block text-[12px] subtle">{hint}</span>}
      </span>
      <ChevronRightIcon size={18} className="shrink-0 subtle" />
    </button>
  );
}
