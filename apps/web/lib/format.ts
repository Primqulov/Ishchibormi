import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/uz-latn";

dayjs.extend(relativeTime);
// Interfeys lotin yozuvida bo'lgani uchun nisbiy vaqt ham lotinda ko'rsatiladi
// (dayjs'ning "uz" lokali kirillcha matn qaytaradi).
dayjs.locale("uz-latn");

// fmtSum minglik xonalarni probel bilan ajratadi: 150000 -> "150 000".
// toLocaleString muhitga bog'liq bo'lgani uchun qo'lda guruhlaymiz.
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

// onlyDigits faqat raqamlarni qoldiradi (harf/belgilarni olib tashlaydi).
export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// fmtThousands input uchun: matndagi raqamlarni "150 000" ko'rinishida qaytaradi.
export function fmtThousands(s: string): string {
  const d = onlyDigits(s).replace(/^0+(?=\d)/, "");
  if (!d) return "";
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// fmtPhone O'zbekiston raqamini "+998 90 020 25 35" ko'rinishida formatlaydi.
export function fmtPhone(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9); // 2 + 3 + 2 + 2
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return "+998" + (parts.length ? " " + parts.join(" ") : "");
}

/**
 * Milliy qismni guruhlab qaytaradi: "901234567" -> "90 123 45 67".
 *
 * [fmtPhone] dan farqi: "+998" QO'SHMAYDI. Formalarda "+998" alohida,
 * o'zgarmas prefiks sifatida chiziladi (components/ui/PhoneInput.tsx), shuning
 * uchun maydonning o'z matnida faqat milliy qism turadi.
 *
 * Kiruvchi qiymat xohlagan ko'rinishda bo'lishi mumkin — "+998901234567" ni
 * ko'chirib qo'yilsa ham [phoneDigits] mamlakat kodini olib tashlaydi.
 */
export function fmtPhoneLocal(raw: string): string {
  const d = phoneDigits(raw);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
    .filter(Boolean)
    .join(" ");
}

// phoneDigits: faqat 9 xonali milliy qism (998siz).
export function phoneDigits(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("998")) d = d.slice(3);
  return d.slice(0, 9);
}

export function fromNow(iso: string): string {
  return dayjs(iso).fromNow();
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  return dayjs(iso).format("D MMMM YYYY");
}

/**
 * Sana + soat: "27 avgust 2026, 14:05".
 *
 * [fromNow] dan farqi ataylab: nisbiy vaqt ("3 oy oldin") tezkor
 * taassurot beradi, lekin aniq paytni AYTMAYDI — admin panelida esa
 * ko'pincha aynan shu kerak bo'ladi (murojaatga javob berish, e'tirozni
 * tekshirish, hisobotga yozish).
 */
export function fmtDateTime(iso?: string): string {
  if (!iso) return "";
  return dayjs(iso).format("D MMMM YYYY, HH:mm");
}

// Xarita pinlari uchun qisqa narx: 200000 -> "200k", 1500000 -> "1.5mln".
export function fmtCompactSum(n: number): string {
  if (!n || n < 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}mln`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Ish qachon boshlanishi: "Bugun 14:00", "Ertaga 09:00", "12 avgust 09:00".
export function fmtWhen(startDate?: string, timeFrom?: string): string {
  if (!startDate) return timeFrom || "";
  const d = dayjs(startDate).startOf("day");
  const diff = d.diff(dayjs().startOf("day"), "day");
  const day = diff === 0 ? "Bugun" : diff === 1 ? "Ertaga" : dayjs(startDate).format("D MMMM");
  return timeFrom ? `${day} ${timeFrom}` : day;
}

// Masofa: 0.84 -> "840 m", 3.42 -> "3.4 km".
export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
