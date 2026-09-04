/**
 * Ariza holatlari — YAGONA manba.
 *
 * Figma "3.6a · Arizalar — holatlar, qoidalar va CSV", 1-panel. Panelning
 * o'z qoidasi shu yerda yozilgan: «Har bir holat rangi butun panel bo'ylab
 * bir xil ishlatiladi.»
 *
 * # NEGA ALOHIDA FAYL
 *
 * Ariza holati kamida to'rt ekranda chiziladi: arizalar ro'yxati (3.6),
 * boshqaruv panelidagi voronka (3.2), foydalanuvchi batafsili (3.4) va
 * e'lon batafsili (3.5.1). Har birida alohida jadval bo'lganda ular
 * ajralib ketgan edi — bir ekranda «qabul qilingan» yashil, boshqasida
 * «bajarilgan» yashil bo'lib, admin ikki ekranni solishtirganda rangga
 * ishonmay qo'yardi. Endi rang faqat shu fayldan keladi.
 *
 * # NEGA FON RANGLARI SHU YERDA, `ui.ts` DA EMAS
 *
 * Figma 3.6 nishonlari o'ziga xos ochiq fonlardan foydalanadi
 * (`#fdf3e4`, `#dce9ff`, ...). `ui.ts` dagi `ORANJ_FON` (#fcf3e6) va
 * qo'shnilari boshqa ekranlarda allaqachon ishlatilgan — ularni bu yerga
 * moslash uchun o'zgartirsak, tasdiqlangan sahifalar rangi jimgina
 * siljib ketardi. Shuning uchun bu beshlik shu fayldagi o'z nomini oldi.
 *
 * # NEGA KUTISH CHIPI HAM SHU YERDA
 *
 * Chip holatning davomi: u faqat «Kutilmoqda» arizada ko'rinadi va 14
 * kundan keyin rangi qizilga o'tadi (Figma 3.6a · 4-panel: "14+ kun —
 * qizil, e'tibor talab qiladi"). Chegara va rang bitta joyda turishi
 * kerak, aks holda jadval bilan filtr bir-biriga qarama-qarshi bo'lardi.
 */
import { Clock } from "lucide-react";
import { KO_K, OCH_KUL, ORANJ, QIZIL, YASHIL } from "./ui";

/** Nishon fonlari — Figma 3.6 · «Holat» ustuni. */
const FON_KUTISH = "#fdf3e4";
const FON_QABUL = "#dce9ff";
const FON_RAD = "#fcebec";
const FON_BEKOR = "#eef1fb";
const FON_BAJARILDI = "#e6f5ed";

export type ArizaKor = {
  matn: string;
  /** Matn va nuqta rangi. */
  rang: string;
  /** Nishon foni. */
  fon: string;
};

/**
 * Holat kodi → ko'rinishi. Yorliqlar Figma 3.6a · 1-panelidan olingan va
 * CSV faylning `holat` ustuni bilan aynan bir xil
 * (apps/api/internal/admin/applications.go · appStatusLabel).
 */
export const ARIZA_HOLAT: Record<string, ArizaKor> = {
  pending: { matn: "Kutilmoqda", rang: ORANJ, fon: FON_KUTISH },
  accepted: { matn: "Qabul qilingan", rang: KO_K, fon: FON_QABUL },
  rejected: { matn: "Rad etilgan", rang: QIZIL, fon: FON_RAD },
  cancelled: { matn: "Bekor qilingan", rang: OCH_KUL, fon: FON_BEKOR },
  completed: { matn: "Bajarilgan", rang: YASHIL, fon: FON_BAJARILDI },
};

/**
 * Faqat rang — matn shakli boshqacha bo'lgan ekranlar uchun.
 *
 * `app/admin/elons/[id]` nishonlarida yorliq kichik harfda, boshqaruv
 * panelidagi voronkada esa ustun nomi butunlay boshqa ("Yuborilgan").
 * Ular yorliqni o'zida saqlaydi, lekin RANGni shu yerdan oladi — panel
 * bo'ylab bir xillik shartini buzmasin.
 */
export const ARIZA_RANG: Record<string, string> = {
  pending: ORANJ,
  accepted: KO_K,
  rejected: QIZIL,
  cancelled: OCH_KUL,
  completed: YASHIL,
};

/**
 * Voronka kartalari va filtr ro'yxatidagi tartib — Figma 3.6 dagi
 * kartalar ketma-ketligi. Backend `appStatuses` bilan bir xil tartib.
 */
export const ARIZA_HOLATLARI = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "completed",
];

/**
 * Bazadagi qiymatni ko'rinishga aylantiradi.
 *
 * Tanish bo'lmagan holat YASHIRILMAYDI: xom ko'rinishda, kulrang, 24
 * belgida kesilgan holda chiziladi. Bo'sh katak qoldirish yomonroq
 * bo'lardi — admin holatsiz qatorni "hammasi joyida" deb o'qib ketardi.
 */
export function arizaHolatKor(status?: string): ArizaKor {
  const s = (status || "").trim();
  return (
    ARIZA_HOLAT[s] || { matn: s.slice(0, 24) || "—", rang: OCH_KUL, fon: FON_BEKOR }
  );
}

/**
 * Figma 3.6 nishoni: to'ldirilgan fon, 13 px burchak, 6 px nuqta.
 *
 * `border` emas, chunki Figma'da hoshiya yo'q — fon rangning o'zi
 * ajratib turadi va qator balandligi (72 px) o'zgarmaydi.
 */
export function ArizaNishoni({ matn, rang, fon }: ArizaKor) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[6px] whitespace-nowrap rounded-[13px] px-[10px] py-[5px] text-[12px] font-medium leading-[16px]"
      style={{ color: rang, background: fon }}
    >
      <span
        className="h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: rang }}
        aria-hidden
      />
      {matn}
    </span>
  );
}

export function ArizaHolatNishoni({ status }: { status?: string }) {
  return <ArizaNishoni {...arizaHolatKor(status)} />;
}

/**
 * Uzoq kutish chegarasi — backend `staleDays` bilan BIR XIL
 * (apps/api/internal/admin/applications.go). Filtr shu chegaradan kelib
 * chiqadi, chip ham: teng bo'lmasa, «Uzoq kutayotgan» belgilangan
 * ro'yxatda chipsiz qatorlar paydo bo'lardi.
 */
export const UZOQ_KUTISH_KUN = 3;
/** Figma 3.6a · 4-panel: "14+ kun — qizil, e'tibor talab qiladi." */
export const XAVFLI_KUTISH_KUN = 14;

/**
 * Ariza yuborilganidan beri o'tgan to'liq kunlar soni.
 *
 * Noto'g'ri sana (bo'sh satr, buzilgan ISO) 0 qaytaradi — `NaN` chipda
 * "NaN kun kutmoqda" bo'lib chiqib ketardi.
 */
export function kutishKunlari(iso?: string): number {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return 0;
  const kun = Math.floor((Date.now() - t) / 86400000);
  return kun > 0 ? kun : 0;
}

/**
 * Figma 3.6 · «Yuborilgan» ustunidagi kutish chipi.
 *
 * FAQAT «Kutilmoqda» arizada va faqat 3+ kundan keyin ko'rinadi —
 * chaqiruvchi tomon shu shartni tekshiradi, chunki chip o'zi ko'rinmas
 * bo'lib qolsa, qator balandligi baribir o'zgarmasligi kerak.
 */
export function KutishChipi({ kun }: { kun: number }) {
  const xavfli = kun >= XAVFLI_KUTISH_KUN;
  const rang = xavfli ? QIZIL : ORANJ;
  const fon = xavfli ? FON_RAD : FON_KUTISH;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[11px] px-[8px] py-[3px] text-[11px] font-medium leading-[15px]"
      style={{ color: rang, background: fon }}
      title={
        xavfli
          ? "14 kundan ortiq javob kutilmoqda — e'tibor talab qiladi"
          : "Ish beruvchi hali javob bermagan"
      }
    >
      <Clock size={12} strokeWidth={2} aria-hidden />
      {kun} kun kutmoqda
    </span>
  );
}
