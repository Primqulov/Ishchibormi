/**
 * "3.12 · Xatoliklar" oilasining umumiy katalogi va formatlovchilari.
 *
 * # NEGA ALOHIDA FAYL
 *
 * Ro'yxat (`app/admin/errors/page.tsx`) va batafsil ekran
 * (`app/admin/errors/[id]/page.tsx`) BIR XIL guruhni ko'rsatadi. Holat
 * nishoni ro'yxatda ko'k, batafsil ekranda siyoh bo'lib qolsa — bu shunchaki
 * chirroylik nuqsoni emas: admin ikki ekranda ikki xil ma'lumot ko'rgan
 * bo'ladi va qaysi biriga ishonishni bilmaydi.
 *
 * Holat ro'yxati serverdagi `internal/errlog/catalog.go` bilan qat'iy
 * mos: oltita holat, shundan `regressed` — TIZIM belgisi (Figma 3.12.3 · J).
 * Uni panel qo'lda qo'yolmaydi, shuning uchun ikki ro'yxat bor:
 * `HOLAT_TARTIBI` (qo'lda tanlanadigan beshta) va `HOLAT_HAMMASI` (oltita,
 * filtr va nishon uchun).
 */
import type { XatoDaraja, XatoHolat, XatoModul, XatoQolHolat } from "@/lib/api";
import {
  HOSHIYA_QUYUQ,
  KO_K,
  OCH_KUL,
  ORANJ,
  QIZIL,
  SIYOH,
  YASHIL,
} from "./ui";

/** Nishon ko'rinishi: nuqta/fon rangi va (kerak bo'lsa) matn rangi. */
type Kor = { nomi: string; rang: string; matn?: string };

export const DARAJA: Record<XatoDaraja, Kor> = {
  critical: { nomi: "Kritik", rang: QIZIL },
  high: { nomi: "Yuqori", rang: ORANJ },
  medium: { nomi: "O'rta", rang: KO_K },
  low: { nomi: "Past", rang: HOSHIYA_QUYUQ, matn: OCH_KUL },
};

export const DARAJA_TARTIBI: XatoDaraja[] = ["critical", "high", "medium", "low"];

/**
 * Holat katalogi.
 *
 * `nomi` — to'liq nom (oyna, amallar tarixi, batafsil ekran). Serverdagi
 * `errlog.StatusLabel` bilan bir xil, shuning uchun Telegram xabari va
 * paneldagi yozuv bir xil so'zni ishlatadi.
 *
 * `qisqa` — jadval nishoni uchun. Ro'yxatdagi "Holat" ustuni 116 px
 * (Figma 3.12), "E'tiborsiz qoldirildi" u yerga sig'maydi.
 *
 * `izoh` — oynadagi bir qatorli tushuntirish: admin holatni tanlaganda
 * uning MA'NOSINI ko'rsin, nomini taxmin qilmasin.
 */
export const HOLAT: Record<XatoHolat, Kor & { qisqa: string; izoh: string }> = {
  new: {
    nomi: "Yangi",
    qisqa: "Yangi",
    rang: QIZIL,
    izoh: "Hech kim ko'rib chiqmagan — tizim o'zi qo'ygan boshlang'ich holat.",
  },
  watching: {
    nomi: "Kuzatilmoqda",
    qisqa: "Kuzatuvda",
    rang: KO_K,
    izoh: "Ko'rib chiqildi, hozir tuzatilmaydi — takrorlanishi kuzatiladi.",
  },
  fixing: {
    nomi: "Bartaraf etilmoqda",
    qisqa: "Tuzatilmoqda",
    rang: SIYOH,
    izoh: "Mas'ul admin biriktirilgan va ish boshlangan.",
  },
  resolved: {
    nomi: "Bartaraf etildi",
    qisqa: "Hal qilindi",
    rang: YASHIL,
    izoh: "Tuzatilgan versiya chiqdi. Xatolik qaytsa — tizim o'zi qayta ochadi.",
  },
  regressed: {
    nomi: "Qayta paydo bo'ldi",
    qisqa: "Qaytdi",
    rang: ORANJ,
    izoh: "Yopilgandan keyin yana takrorlandi — tizim belgisi, qo'lda qo'yilmaydi.",
  },
  ignored: {
    nomi: "E'tiborsiz qoldirildi",
    qisqa: "E'tiborsiz",
    rang: HOSHIYA_QUYUQ,
    matn: OCH_KUL,
    izoh: "Ataylab yopildi — hisobotlardan chiqariladi. Faqat superadmin, sabab bilan.",
  },
};

/** Admin O'ZI tanlay oladigan holatlar — `errlog.ManualStatuses` bilan bir xil. */
export const HOLAT_TARTIBI: XatoQolHolat[] = [
  "new",
  "watching",
  "fixing",
  "resolved",
  "ignored",
];

/** Filtr va nishon uchun to'liq ro'yxat (`regressed` ham bor). */
export const HOLAT_HAMMASI: XatoHolat[] = [
  "new",
  "watching",
  "fixing",
  "resolved",
  "regressed",
  "ignored",
];

/** Ochiq (yopilmagan) holatlar — `errlog.OpenStatuses` bilan bir xil. */
export const OCHIQ_HOLAT: XatoHolat[] = ["new", "watching", "fixing", "regressed"];

/**
 * Holatni o'zgartirish oynasi ochilganda sukut bo'yicha taklif etiladigan
 * keyingi qadam. Hayot sikli Figma 3.12.3 · J bo'yicha:
 * Yangi → Kuzatilmoqda → Bartaraf etilmoqda → Bartaraf etildi.
 *
 * `regressed` ham `fixing` ga qaytadi: qayta paydo bo'lgan xatolik ustida
 * yana ishlash kerak, uni "kuzatish" bosqichiga tushirish orqaga qadam.
 */
export function keyingiHolat(h: XatoHolat): XatoQolHolat {
  switch (h) {
    case "new":
      return "watching";
    case "watching":
      return "fixing";
    case "fixing":
      return "resolved";
    case "regressed":
      return "fixing";
    case "resolved":
      return "watching";
    default:
      return "watching";
  }
}

/** Figma 3.12.2 · C guruhlari. `Manba` filtri va ustuni shu nomlarni oladi. */
export const MODUL: Record<XatoModul, string> = {
  backend: "Backend",
  db: "Ma'lumotlar bazasi",
  external: "Tashqi xizmatlar",
  jobs: "Fon jarayonlari",
  admin_app: "Admin ilovasi",
  client_app: "Foydalanuvchi ilovasi",
  security: "Xavfsizlik",
};

export const MODUL_TARTIBI: XatoModul[] = [
  "backend",
  "db",
  "external",
  "jobs",
  "admin_app",
  "client_app",
  "security",
];

/** Katalogda yo'q qiymat kelsa — serverdagi xom kalitni ko'rsatamiz. */
export function modulNomi(m: string): string {
  return MODUL[m as XatoModul] ?? m;
}

/** Ma'lumot yo'q joyda BO'SH qoldirmaymiz (Figma 3.12.3 izohi 432:269). */
export const YOQ = "aniqlanmagan";

/* ── Bo'sh katakning UCH XIL sababi (Figma 3.12.3 · H) ────────────────
   Spec bo'sh katakni uchga ajratadi va bu ajratma ATAYLAB: admin uchun
   ular BOSHQA-BOSHQA xulosa beradi.

   · `TEGISHSIZ` ("—") — qidiradigan narsa umuman yo'q: iOS'da "API level"
     tushunchasi mavjud emas, veb'da esa Flutter versiyasi.
   · `NOMALUM` ("ma'lum emas") — manba maydonni PRINTSIPIAL bermaydi:
     brauzer RAM va batareyani standart yo'l bilan oshkor qilmaydi.
   · `YOQ` ("aniqlanmagan") — maydon bor, manba ham beradi, lekin klient
     uni yubormaydi. Bu YAGONA nosozlik belgisi: yig'ish zanjirini
     tuzatish kerak.

   Uchalasini bitta "aniqlanmagan" bilan yozsak (avval shunday edi), admin
   iOS kartasidagi bo'sh "API level" ni ham nosozlik deb o'qib, yo'q
   muammoni qidirib ketardi. */

/** Maydon shu PLATFORMAGA tegishli emas — izlash kerak emas. */
export const TEGISHSIZ = "—";

/** Manba maydonni bermaydi — klient tomonda tuzatib bo'lmaydi. */
export const NOMALUM = "ma'lum emas";

export function p2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 1234567 → "1 234 567" (ingichka bo'shliq bilan, ko'chib ketmasin). */
export function son(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}

export function sana(d: Date): string {
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function soat(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function soatSek(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * `hozir` ni ikki ko'rinishda qabul qilamiz.
 *
 * Ro'yxat sahifasi uni `Date.now()` (son) sifatida uzatadi, batafsil ekran
 * esa taymerda saqlangan `Date` obyektini. Ikkisini bir joyda
 * normallashtirmasak, chaqiruv joyida `new Date(...)` o'ramlari paydo
 * bo'lardi va bittasi esdan chiqib "Invalid Date" chiqarardi.
 */
type Payt = Date | number;

function kunBoshi(t: Payt): number {
  const d = t instanceof Date ? t : new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * "Bugun, 14:21:07" / "Kecha, 21:55:02" / "12.08.2026, 09:14:37".
 *
 * `hozir` tashqaridan uzatiladi: serverdan kelgan vaqt bilan bir xil
 * daqiqada hisoblansin va SSR/CSR farqi sababli hidratsiya ogohlantirishi
 * chiqmasin.
 */
export function kunSoat(d: Date, hozir: Payt): string {
  const bugun = kunBoshi(hozir);
  const kun = kunBoshi(d);
  if (kun === bugun) return `Bugun, ${soatSek(d)}`;
  if (kun === bugun - 86_400_000) return `Kecha, ${soatSek(d)}`;
  return `${sana(d)}, ${soatSek(d)}`;
}

/** "Bugun · 14:21" — ko'rsatkich kataklari uchun qisqa ko'rinish. */
export function kunNuqta(d: Date, hozir: Payt): string {
  const bugun = kunBoshi(hozir);
  const kun = kunBoshi(d);
  if (kun === bugun) return `Bugun · ${soat(d)}`;
  if (kun === bugun - 86_400_000) return `Kecha · ${soat(d)}`;
  return `${sana(d)} · ${soat(d)}`;
}

/** "hozir" / "12 daq oldin" / "3 soat oldin" / "5 kun oldin". */
export function nisbiy(d: Date, hozir: Payt): string {
  const hozirMs = hozir instanceof Date ? hozir.getTime() : hozir;
  const s = Math.max(0, Math.round((hozirMs - d.getTime()) / 1000));
  if (s < 60) return "hozir";
  const daq = Math.floor(s / 60);
  if (daq < 60) return `${daq} daq oldin`;
  const st = Math.floor(daq / 60);
  if (st < 24) return `${st} soat oldin`;
  return `${Math.floor(st / 24)} kun oldin`;
}
