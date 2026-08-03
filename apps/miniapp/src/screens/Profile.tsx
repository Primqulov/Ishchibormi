/**
 * Profil — Figma maketidagi "Profil sahifasi".
 *
 * Tartibi maketdan: markazda yirik avatar va ism, ostida to'rtta ko'rsatkich
 * (ikki reyting + ikki hisob), so'ng bo'limlar ro'yxati.
 *
 * Reytinglar ATAYLAB ikkita: bir odam ham ishchi, ham ish beruvchi bo'ladi va
 * ularning obro'si alohida yig'iladi — bitta o'rtacha raqam ikkalasini ham
 * noto'g'ri ko'rsatardi.
 *
 * Maketdagi "Chiqish" tugmasi bu yerda YO'Q: Mini App Telegram hisobiga
 * bog'langan va har ochilganda o'sha hisob bilan kiradi, ya'ni chiqish faqat
 * bir zumdan keyin qaytadan kirishga olib kelardi. Hisobni o'chirish ham shu
 * sababdan saytda qoldirilgan (tasdiqlash oqimini talab qiladi).
 */

import {
  StarIcon,
  TrophyIcon,
  CheckCircleIcon,
  FileTextIcon,
  MapPinIcon,
  EditIcon,
  BriefcaseIcon,
  UsersIcon,
  HistoryIcon,
  SettingsIcon,
  HelpIcon,
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
  onApplications,
  onCandidates,
  onMyElons,
  onHistory,
  onSettings,
}: {
  me: User;
  onEdit: () => void;
  onApplications: () => void;
  onCandidates: () => void;
  onMyElons: () => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ") || "Foydalanuvchi";
  const place = [me.district, me.region].filter(Boolean).join(", ");

  const workerRating = me.workerRating || me.rating || 0;
  const employerRating = me.employerRating || 0;

  return (
    <div className="flex flex-col gap-5 px-4 pb-4 pt-6 animate-fade-in">
      {/* ── Avatar va ism ───────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onEdit();
          }}
          aria-label="Profilni tahrirlash"
          className="relative transition active:scale-95"
        >
          <Avatar src={me.avatarUrl} firstName={me.firstName} lastName={me.lastName} size={96} />
          <span
            className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full text-white"
            style={{ background: "var(--brand)", border: "3px solid var(--bg)" }}
          >
            <EditIcon size={14} />
          </span>
        </button>

        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.24px] heading">{fullName}</h1>

        {place && (
          <p className="inline-flex items-center gap-1.5 text-[14px] muted">
            <MapPinIcon size={14} className="subtle" />
            {place}
          </p>
        )}
        {me.phone && <p className="text-[13px] subtle">{fmtPhone(me.phone)}</p>}
      </div>

      {/* ── Reytinglar ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<StarIcon size={20} />}
          iconColor="var(--accent)"
          value={workerRating > 0 ? workerRating.toFixed(1) : "—"}
          label="Ishchi reytingi"
        />
        <StatCard
          icon={<TrophyIcon size={20} />}
          iconColor="var(--accent)"
          value={employerRating > 0 ? employerRating.toFixed(1) : "—"}
          label="Ish beruvchi reytingi"
        />
      </div>

      {/* ── Hisoblar (maketda yumshoq ko'k fonda) ───────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <CountCard
          icon={<CheckCircleIcon size={18} />}
          value={me.completedJobsCount ?? 0}
          label="Bajarilgan ishlar"
        />
        <CountCard
          icon={<FileTextIcon size={18} />}
          value={me.reviewsCount ?? 0}
          label="Olingan baholar"
        />
      </div>

      {/* ── Bo'limlar ───────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <MenuRow icon={<FileTextIcon size={18} />} label="Arizalarim" onClick={onApplications} />
        <MenuRow icon={<BriefcaseIcon size={18} />} label="E'lonlarim" onClick={onMyElons} />
        <MenuRow icon={<UsersIcon size={18} />} label="Nomzodlar" onClick={onCandidates} />
        <MenuRow icon={<HistoryIcon size={18} />} label="Ish tarixi" onClick={onHistory} />
        <MenuRow icon={<EditIcon size={18} />} label="Shaxsiy ma'lumotlar" onClick={onEdit} />
        <MenuRow icon={<SettingsIcon size={18} />} label="Sozlamalar" onClick={onSettings} />
        <MenuRow
          icon={<HelpIcon size={18} />}
          label="Yordam markazi"
          last
          onClick={() => openTelegramLink(`https://t.me/${SUPPORT}`)}
        />
      </div>

      {me.bio && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold leading-7 heading">Men haqimda</h2>
          <p className="whitespace-pre-line text-[14px] leading-relaxed muted">{me.bio}</p>
        </section>
      )}

      {me.skills && me.skills.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold leading-7 heading">Ko'nikmalar</h2>
          <div className="flex flex-wrap gap-2">
            {me.skills.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="pb-2 text-center text-[12px] subtle">
        Hisobni o'chirish saytda: ishchibormi.uz/delete-account
      </p>
    </div>
  );
}

/** Reyting kartasi — oq fon, tepada ikonka, ostida yirik raqam. */
function StatCard({
  icon,
  iconColor,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconColor: string;
  value: string;
  label: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-1 px-3 py-4">
      <span style={{ color: iconColor }}>{icon}</span>
      <p className="text-[24px] font-bold leading-8 tabular-nums heading">{value}</p>
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.6px] subtle">
        {label}
      </p>
    </div>
  );
}

/** Hisob kartasi — maketda yumshoq ko'k fonda, chapga tekislangan. */
function CountCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl px-4 py-3.5"
      style={{ background: "var(--brand-soft)" }}
    >
      <span style={{ color: "var(--brand)" }}>{icon}</span>
      <p className="text-[22px] font-bold leading-7 tabular-nums heading">{value}</p>
      <p className="text-[12px] muted">{label}</p>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:scale-[0.99]"
      style={last ? undefined : { borderBottom: "1px solid var(--border)" }}
    >
      <span className="shrink-0 subtle">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium heading">{label}</span>
      <ChevronRightIcon size={18} className="shrink-0 subtle" />
    </button>
  );
}
