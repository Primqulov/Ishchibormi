/**
 * Admin panelining Figma palitrasi va tugma uslublari.
 *
 * Admin paneli sayt brendidan ALOHIDA palitrada chizilgan (ko'k #004ac6,
 * brend #0038d8 emas), shuning uchun ranglar bu yerda to'g'ridan-to'g'ri
 * yozilgan — `--brand` o'zgaruvchilari orqali emas.
 *
 * Figma'dagi hoshiya INSIDE turadi: CSS `border` qutini 2 px kattartirib
 * yuboradi, shuning uchun hamma joyda `inset` box-shadow ishlatiladi.
 */
import type { CSSProperties } from "react";

export const KO_K = "#004ac6";
export const KO_K_XIRA = "#a1b6e8"; // o'chiq asosiy tugma
export const IK = "#0b1c30";
export const KUL = "#434655";
export const OCH_KUL = "#737686";
export const XIRA = "#a7acb9";
// Xiraning bir pog'ona quyuqrog'i: bo'sh holat yozuvi, "so'm" qo'shimchasi,
// maydonlardagi placeholder (Figma 3.3 va 3.5).
export const XIRA_QUYUQ = "#9aa0b0";
export const HOSHIYA = "#eaecf2";
export const HOSHIYA_OCH = "#e1e2eb"; // o'chiq tugma / nishon hoshiyasi
export const HOSHIYA_QUYUQ = "#c3c6d7";
export const YASHIL = "#1fa463";
// Siyoh — «to'ldi» holati (Figma 3.5a · 1). Ko'kdan (KO_K) ataylab boshqa
// rang: ko'k panelning "amal" rangi, holat nishoni esa amal emas.
export const SIYOH = "#6366f1";
export const QIZIL = "#e5484d";
export const QIZIL_XIRA = "#f3acaf"; // o'chiq xavfli tugma (Figma 3.3a · 1)
export const QIZIL_HOSHIYA = "#f2a3a6";
export const QIZIL_FON = "#fcf6f6";
export const KO_K_FON = "#f2f6fc";
export const ORANJ = "#e8890c";
export const ORANJ_FON = "#fcf3e6";
export const ORANJ_MATN = "#8a5a0b";
export const SARLAVHA_FON = "#eef2fb"; // jadval sarlavha yo'lagi
// Karta ICHIDAGI quti foni — ko'rsatkich kataklari (Figma 3.5.1). Oq
// kartadan bir pog'ona sovuqroq: hoshiyasi bilan birga u "kartaning ichki
// bo'lagi" bo'lib o'qiladi, alohida karta bo'lib emas.
export const QUTI_FON = "#fbfcff";
// Avatar va rasm o'rni foni (Figma 3.4, 3.5.1). Ko'k tomonga og'ishi
// ataylab: ustidagi bosh harf KO_K rangda yoziladi.
export const AVATAR_FON = "#eef1fb";
export const SOYA = "0 2px 8px rgba(11, 28, 48, 0.06)";

export type TugmaKor = "ikkilamchi" | "asosiy" | "xavf";

/**
 * Figma tugmalari ikki o'lchamda: h36 (oyna oyoqchasi, sahifa boshi) va
 * h28 (jadval qatori, sahifalash).
 *
 * `<Link>` ham, `<button>` ham bir xil ko'rinishi kerak, shuning uchun
 * komponent emas — tayyor `className` + `style` qaytaradi.
 */
export function tugma(
  kor: TugmaKor,
  opt?: { kichik?: boolean; ochiq?: boolean },
): { className: string; style: CSSProperties } {
  const kichik = !!opt?.kichik;
  const ochiq = !!opt?.ochiq;
  const asos =
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors " +
    (kichik
      ? "h-7 rounded-lg px-[9px] text-[12px]"
      : "h-9 rounded-[10px] px-[14px] text-[13px]") +
    (ochiq ? " cursor-not-allowed" : "");

  if (kor === "ikkilamchi") {
    return {
      className: `${asos} bg-white${ochiq ? "" : " hover:bg-[#f4f6fc]"}`,
      style: {
        color: ochiq ? XIRA : KUL,
        boxShadow: `inset 0 0 0 1px ${ochiq ? HOSHIYA_OCH : HOSHIYA_QUYUQ}`,
      },
    };
  }
  if (kor === "asosiy") {
    return {
      className: `${asos} text-white${ochiq ? "" : " hover:brightness-95"}`,
      style: { background: ochiq ? KO_K_XIRA : KO_K },
    };
  }
  return {
    className: `${asos} text-white${ochiq ? "" : " hover:brightness-95"}`,
    style: { background: ochiq ? QIZIL_XIRA : QIZIL },
  };
}
