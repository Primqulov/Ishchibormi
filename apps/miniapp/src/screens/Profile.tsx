/**
 * Profil.
 *
 * Mini App'da "chiqish" tugmasi ataylab yo'q: foydalanuvchi Telegram hisobiga
 * bog'langan va ilova har ochilganda o'sha hisob bilan kiradi — chiqish
 * tugmasi faqat bir zumdan keyin qaytadan kirishga olib kelardi. Hisobni
 * o'chirish ham shu yerda emas: u tasdiqlash oqimini talab qiladi va saytda
 * (/delete-account) hamda mobil ilovada mavjud.
 */

import { StarIcon, CheckIcon, PhoneIcon, MapPinIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { fmtPhone } from "@/lib/format";
import { openTelegramLink, haptic } from "@/lib/telegram";
import type { User } from "@/lib/api";

const SUPPORT = "Ishchi_bormi_support";

export function Profile({ me }: { me: User }) {
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
        Profilni to'liq tahrirlash saytda: ishchibormi.uz
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
