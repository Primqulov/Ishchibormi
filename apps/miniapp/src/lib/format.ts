/**
 * Formatlash yordamchilari.
 *
 * apps/web/lib/format.ts bilan bir xil natija beradi, lekin `dayjs`siz:
 * bu yerda kerak bo'lgani sanani ikki ko'rinishda chiqarish, buning uchun esa
 * ~7 KB kutubxonani mobil internetda yuklatishning hojati yo'q.
 */

const MONTHS_UZ = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/** 150000 → "150 000". Minglik xonalar probel bilan ajratiladi. */
export function fmtSum(n: number): string {
  if (!n && n !== 0) return "0";
  const neg = n < 0;
  const s = Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return neg ? "-" + s : s;
}

export function fmtSumSom(n: number, negotiable?: boolean): string {
  if (negotiable) return "Kelishiladi";
  return `${fmtSum(n)} so'm`;
}

/** 200000 → "200k", 1500000 → "1.5mln". Tor joylar uchun. */
export function fmtCompactSum(n: number): string {
  if (!n || n < 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}mln`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Ish qachon boshlanishi: "Bugun 14:00", "Ertaga 09:00", "12 avgust 09:00". */
export function fmtWhen(startDate?: string, timeFrom?: string): string {
  if (!startDate) return timeFrom || "";
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return timeFrom || "";

  const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  const day =
    diffDays === 0 ? "Bugun"
    : diffDays === 1 ? "Ertaga"
    : `${d.getDate()} ${MONTHS_UZ[d.getMonth()]}`;

  return timeFrom ? `${day} ${timeFrom}` : day;
}

/** "12 avgust 2026" */
export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS_UZ[d.getMonth()]} ${d.getFullYear()}`;
}

/** "3 daqiqa oldin", "2 kun oldin" — ro'yxatlardagi nisbiy vaqt. */
export function fromNow(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";

  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return "hozirgina";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} daqiqa oldin`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} soat oldin`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} kun oldin`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} oy oldin`;
  return `${Math.round(months / 12)} yil oldin`;
}

/** 0.84 → "840 m", 3.42 → "3.4 km". */
export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** "+998 90 020 25 35" ko'rinishi. */
export function fmtPhone(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return "+998" + (parts.length ? " " + parts.join(" ") : "");
}

/** Ism-familiyadan bosh harflar — avatar zaxirasi uchun. */
export function initials(firstName?: string, lastName?: string): string {
  const a = (firstName || "").trim()[0] || "";
  const b = (lastName || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}
