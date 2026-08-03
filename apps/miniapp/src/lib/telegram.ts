/**
 * Telegram Mini App SDK ustidagi yupqa qatlam.
 *
 * Nega qatlam kerak:
 *  1. `window.Telegram.WebApp` brauzerda ochilganda umuman bo'lmaydi — har bir
 *     chaqiruvni `?.` bilan o'rash o'rniga hammasi shu yerda bir marta
 *     himoyalanadi. Shu tufayli ilovani oddiy brauzerda ham ochib, UI ustida
 *     ishlash mumkin.
 *  2. Telegram versiyalari har xil: eski klientlarda `disableVerticalSwipes`
 *     yoki `requestFullscreen` yo'q. Yo'q metodni chaqirish ilovani yiqitadi,
 *     shuning uchun hammasi mavjudligi tekshirilib chaqiriladi.
 */

// SDK ning bizga kerakli qismi. To'liq tipni ko'chirib olishdan ko'ra
// ishlatadiganimizni yozib qo'ygan aniqroq — ishlatilmaydigan maydon bu yerga
// tushmaydi.
type ThemeParams = {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
};

type BackButton = {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
};

type MainButton = {
  text: string;
  isVisible: boolean;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  setText(text: string): void;
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
};

type HapticFeedback = {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
};

export type TelegramWebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  viewportStableHeight?: number;
  isExpanded: boolean;
  version: string;
  platform: string;

  ready(): void;
  expand(): void;
  close(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  showAlert?(message: string, cb?: () => void): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;

  BackButton: BackButton;
  MainButton: MainButton;
  HapticFeedback: HapticFeedback;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined =
  typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;

/** Telegram ichida ochilganmi (brauzerda emas). */
export const isTelegram = Boolean(tg?.initData);

/**
 * initData — backend'ga yuboriladigan imzolangan satr.
 * Uni O'ZGARTIRMASLIK kerak: har qanday tahrir imzoni buzadi.
 */
export function initData(): string {
  return tg?.initData ?? "";
}

/**
 * Ilovani ishga tushirish. main.tsx da render'dan oldin bir marta chaqiriladi.
 */
export function initTelegram() {
  if (!tg) {
    // Brauzer rejimi: mavzuni tizim sozlamasidan olamiz, qolgani ishlamaydi.
    applySystemTheme();
    return;
  }

  tg.ready();
  // Mini App standart holatda yarim ekran bo'lib ochiladi.
  tg.expand();

  // Pastga surganda Telegram oynani yopishga urinadi — ro'yxatni aylantirayotgan
  // foydalanuvchi uchun bu tasodifiy chiqib ketishga olib keladi. Metod faqat
  // Bot API 7.7+ da bor.
  tg.disableVerticalSwipes?.();

  applyTheme();
  applyViewport();

  // Foydalanuvchi Telegram sozlamalarida kun/tun rejimini almashtirsa ilova
  // ham darhol o'zgarsin.
  tg.onEvent("themeChanged", applyTheme);
  // Klaviatura ochilishi/yopilishi va oynaning cho'zilishi.
  tg.onEvent("viewportChanged", applyViewport);
}

/** Telegram mavzusini CSS o'zgaruvchilariga bog'laydi. */
function applyTheme() {
  if (!tg) return;
  const dark = tg.colorScheme === "dark";
  document.documentElement.classList.toggle("dark", dark);

  // Sarlavha va fon ranglari ilovaning o'z foni bilan bir xil bo'lsin —
  // aks holda tepada boshqa rangdagi chiziq qolib ketadi.
  const bg = dark ? "#070C1C" : "#EEF0FA";
  tg.setHeaderColor?.(bg);
  tg.setBackgroundColor?.(bg);
}

function applySystemTheme() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", Boolean(dark));
}

/**
 * Oynaning haqiqiy balandligini CSS ga uzatadi.
 *
 * Nega `100vh` ishlatilmaydi: Telegram Mini App'da klaviatura ochilganda yoki
 * oyna to'liq yoyilmaganda `100vh` haqiqiy ko'rinadigan balandlikdan katta
 * bo'lib qoladi — natijada pastki tab bar ekrandan tushib ketadi.
 * `viewportStableHeight` esa aynan barqaror (klaviatura hisobga olingan)
 * balandlikni beradi.
 */
function applyViewport() {
  const h = tg?.viewportStableHeight;
  if (h && h > 0) {
    document.documentElement.style.setProperty("--tg-vh", `${h}px`);
  }
}

// ── Tugmalar ──────────────────────────────────────────────────────────

/** Telegram'ning tepadagi "orqaga" tugmasi. Tozalovchi funksiya qaytaradi. */
export function showBackButton(onClick: () => void): () => void {
  if (!tg) return () => {};
  tg.BackButton.onClick(onClick);
  tg.BackButton.show();
  return () => {
    tg.BackButton.offClick(onClick);
    tg.BackButton.hide();
  };
}

/**
 * Telegram'ning pastdagi asosiy tugmasi.
 *
 * Sahifa ichidagi tugmadan afzalligi: u klaviatura ustida turadi, tizim
 * ranglarida bo'ladi va foydalanuvchi uni boshqa Mini App'lardan taniydi.
 */
export function showMainButton(
  text: string,
  onClick: () => void,
  opts?: { disabled?: boolean; loading?: boolean },
): () => void {
  if (!tg) return () => {};
  const b = tg.MainButton;
  b.setText(text);
  b.onClick(onClick);
  b.show();
  if (opts?.disabled) b.disable();
  else b.enable();
  if (opts?.loading) b.showProgress(false);
  else b.hideProgress();
  return () => {
    b.offClick(onClick);
    b.hideProgress();
    b.hide();
  };
}

// ── Haptika ───────────────────────────────────────────────────────────
// Telefonda "bosildi" hissini beradi. Brauzerda jimgina e'tiborsiz qoladi.

export const haptic = {
  tap: () => tg?.HapticFeedback.impactOccurred("light"),
  select: () => tg?.HapticFeedback.selectionChanged(),
  success: () => tg?.HapticFeedback.notificationOccurred("success"),
  error: () => tg?.HapticFeedback.notificationOccurred("error"),
  warning: () => tg?.HapticFeedback.notificationOccurred("warning"),
};

// ── Havolalar ─────────────────────────────────────────────────────────

/**
 * Telegram havolasini ochadi (t.me/...).
 * Oddiy `<a href>` Mini App ichida ishlamaydi — shuning uchun SDK orqali.
 */
export function openTelegramLink(url: string) {
  if (tg) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Tashqi havola (xarita, telefon) — tizim brauzeri/ilovasida ochiladi. */
export function openExternal(url: string) {
  if (tg) tg.openLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Telegram'ning nativ ogohlantirishi; brauzerda oddiy alert. */
export function alertUser(message: string) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}
