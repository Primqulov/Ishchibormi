/**
 * Tepa panel — logo va bildirishnoma tugmasi.
 *
 * Maketda u har ekranda bir xil turadi, shuning uchun bitta komponent.
 * Sticky: ro'yxat surilganda ham logo va o'qilmagan belgisi ko'rinib
 * turadi (maketda panel sahifa tepasiga "yopishgan").
 *
 * Ichki ekranlarda (e'lon tafsiloti, e'lon berish) uning o'rniga
 * [ScreenHeader] ishlatiladi — orqaga qaytish Telegram'ning o'z
 * BackButton'ida bo'lgani uchun bu yerda "orqaga" tugmasi yo'q.
 */

import { BellIcon } from "./icons";
import { Logo } from "./Logo";
import { haptic } from "@/lib/telegram";

export function AppHeader({
  unread,
  onBell,
}: {
  unread?: number;
  onBell?: () => void;
}) {
  return (
    <header className="app-bar">
      <Logo />
      {onBell && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onBell();
          }}
          aria-label={unread ? `Bildirishnomalar (${unread} ta yangi)` : "Bildirishnomalar"}
          className="relative grid h-11 w-11 place-items-center rounded-full transition active:scale-90"
          style={{ color: "var(--brand)" }}
        >
          <BellIcon size={20} />
          {unread ? (
            <span
              className="absolute right-1.5 top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-bold text-white"
              style={{ background: "var(--accent)" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      )}
    </header>
  );
}

/** Ichki ekranlar uchun sarlavha — markazda nom, ixtiyoriy o'ng amal. */
export function ScreenHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="app-bar">
      {/* Chapda bo'sh joy: sarlavha aynan markazda tursin (maketdagidek),
          o'ngdagi tugma bo'lmasa ham qiyshaymasin. */}
      <span className="w-11 shrink-0" aria-hidden="true" />
      <h1
        className="flex-1 truncate text-center text-[17px] font-bold"
        style={{ color: "var(--brand)" }}
      >
        {title}
      </h1>
      <span className="grid w-11 shrink-0 place-items-center">{action}</span>
    </header>
  );
}
