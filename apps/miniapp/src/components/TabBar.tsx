/**
 * Pastki navigatsiya.
 *
 * Saytdagi tepa navbar o'rniga mobil uchun pastki tab bar: barmoq ekranning
 * pastki qismiga yaqin turadi, tepadagi havolalarga bir qo'l bilan yetib
 * bo'lmaydi. Telegram'ning o'z sarlavha paneli tepada turgani uchun ham
 * navigatsiyani pastga tushirish to'g'ri bo'ladi.
 *
 * Tuzilishi mobil ilovanikidan ko'chirilgan (flutter-app →
 * core/widgets/app_bottom_nav_bar.dart): to'rt yon tab va o'rtada ko'tarilgan
 * "E'lon" tugmasi. Bir mahsulotning ikki klienti bir xil joydan bir xil
 * amalni taklif qilishi kerak — foydalanuvchi ikkalasini ham ishlatadi.
 *
 * pb-safe — iPhone'ning home indikatori ustidan qo'shimcha bo'shliq.
 */

import { HomeIcon, BriefcaseIcon, BellIcon, UserIcon } from "./icons";
import { haptic } from "@/lib/telegram";

/**
 * Tablar maketdagi tartibda: Asosiy · Ishlar · [E'lon] · Xabarlar · Profil.
 * "Arizalarim" alohida tab emas — u Profil ichida, chunki maketda ham
 * "Mening e'lonlarim va arizalarim" profildan ochiladigan ekran.
 */
export type Tab = "home" | "jobs" | "notifications" | "profile";

const TABS: { id: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: "home", label: "Asosiy", Icon: HomeIcon },
  { id: "jobs", label: "Ishlar", Icon: BriefcaseIcon },
  { id: "notifications", label: "Xabarlar", Icon: BellIcon },
  { id: "profile", label: "Profile", Icon: UserIcon },
];

export function TabBar({
  active,
  onChange,
  onPost,
  unread,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  /** Markaziy "E'lon" tugmasi — yangi e'lon berish. */
  onPost: () => void;
  /** "Xabarlar" ustidagi nuqta — o'qilmagan bildirishnomalar soni. */
  unread?: number;
}) {
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-30"
      style={{
        // Maketdan: yarim shaffof fon + blur, ustidan yengil soya.
        borderTop: "1px solid color-mix(in srgb, var(--border) 35%, transparent)",
        background: "color-mix(in srgb, var(--bg) 80%, transparent)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.08)",
      }}
    >
      <div className="relative mx-auto flex max-w-md items-stretch">
        <TabItem tab={TABS[0]} active={active} onChange={onChange} badge={undefined} />
        <TabItem tab={TABS[1]} active={active} onChange={onChange} badge={undefined} />

        {/* O'rtadagi slot: yozuv shu yerda, doira esa ustida "suzadi". */}
        <div className="relative flex flex-1 flex-col items-center justify-end pb-1.5">
          <PostButton onClick={onPost} />
          <span className="text-[10.5px] font-semibold tracking-[0.1px] subtle">E'lon</span>
        </div>

        <TabItem tab={TABS[2]} active={active} onChange={onChange} badge={unread} />
        <TabItem tab={TABS[3]} active={active} onChange={onChange} badge={undefined} />
      </div>
    </nav>
  );
}

function TabItem({
  tab,
  active,
  onChange,
  badge,
}: {
  tab: { id: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element };
  active: Tab;
  onChange: (t: Tab) => void;
  badge?: number;
}) {
  const { id, label, Icon } = tab;
  const on = active === id;
  return (
    <button
      type="button"
      onClick={() => {
        if (!on) haptic.select();
        onChange(id);
      }}
      // min-h-[52px]: teginish maydoni barmoq uchun yetarli bo'lsin.
      className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pt-1.5 transition"
      style={{ color: on ? "var(--brand)" : "var(--text-muted)" }}
      aria-current={on ? "page" : undefined}
    >
      <span className="relative">
        <Icon size={21} />
        {badge ? (
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
}

/**
 * Ko'tarilgan markaziy tugma.
 *
 * Ko'k doira → oq ichki disk → ko'k "+" — mobil ilovadagi bilan bir xil
 * (u yerda ham ataylab shunday: "+" oq emas, ko'k).
 */
function PostButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      aria-label="E'lon berish"
      // -top-4: doira panelning tepa chetidan chiqib turadi.
      className="absolute -top-4 grid h-[50px] w-[50px] place-items-center rounded-full transition active:scale-[0.88]"
      style={{
        background: "var(--brand)",
        boxShadow: "0 6px 14px -4px color-mix(in srgb, var(--brand) 55%, transparent)",
      }}
    >
      <span
        className="grid h-[21px] w-[21px] place-items-center rounded-full"
        style={{ background: "var(--card)" }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M6 0.7v10.6M0.7 6h10.6"
            stroke="var(--brand)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </button>
  );
}
