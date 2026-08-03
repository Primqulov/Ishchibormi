/**
 * Pastki navigatsiya.
 *
 * Saytdagi tepa navbar o'rniga mobil uchun pastki tab bar: barmoq ekranning
 * pastki qismiga yaqin turadi, tepadagi havolalarga bir qo'l bilan yetib
 * bo'lmaydi. Telegram'ning o'z sarlavha paneli tepada turgani uchun ham
 * navigatsiyani pastga tushirish to'g'ri bo'ladi.
 *
 * pb-safe — iPhone'ning home indikatori ustidan qo'shimcha bo'shliq.
 */

import { BriefcaseIcon, FileTextIcon, UserIcon } from "./icons";
import { haptic } from "@/lib/telegram";

export type Tab = "feed" | "applications" | "profile";

const TABS: { id: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: "feed", label: "Ishlar", Icon: BriefcaseIcon },
  { id: "applications", label: "Arizalarim", Icon: FileTextIcon },
  { id: "profile", label: "Profil", Icon: UserIcon },
];

export function TabBar({
  active,
  onChange,
  badge,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  /** "Arizalarim" ustidagi nuqta — javob kutilayotgan arizalar soni. */
  badge?: number;
}) {
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--card) 94%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (!on) haptic.select();
                onChange(id);
              }}
              // min-h-[52px]: teginish maydoni barmoq uchun yetarli bo'lsin.
              className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pt-1.5 transition"
              style={{ color: on ? "var(--brand)" : "var(--text-subtle)" }}
              aria-current={on ? "page" : undefined}
            >
              <span className="relative">
                <Icon size={21} />
                {id === "applications" && badge ? (
                  <span
                    className="absolute -right-1.5 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full px-1 text-[9px] font-bold text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              <span className="text-[10.5px] font-semibold tracking-[0.1px]">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
