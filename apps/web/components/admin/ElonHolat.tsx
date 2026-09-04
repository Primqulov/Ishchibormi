/**
 * E'lon holatlari — YAGONA manba.
 *
 * Figma "3.5a · E'lonlar — holatlar, amallar va oynalar", 1-panel.
 *
 * # NEGA ALOHIDA FAYL
 *
 * Holat nomi va rangi kamida uch joyda kerak: e'lonlar ro'yxati, filtr
 * ro'yxati va foydalanuvchi batafsil sahifasidagi e'lonlar jadvali. Har
 * birida alohida yozilsa, ular sekin-asta bir-biridan uzoqlashadi — bir
 * ekranda "to'ldi" siyoh, boshqasida ko'k bo'lib qolardi va admin ikkita
 * ekranni solishtirganda ma'lumotga ishonmay qo'yardi.
 *
 * # NEGA «YASHIRILGAN» DA IKONKA BOR
 *
 * Figma izohi: «kodda "yakunlandi" va "yashirilgan" ikkalasi ham kulrang —
 * ularni ajratib bo'lmasdi. Shuning uchun "yashirilgan" ga ko'z-chizilgan
 * ikonka qo'shildi.» Ya'ni farq faqat rangda emas, shaklda ham — rangni
 * ajratmaydigan admin ham ularni farqlaydi.
 */
import { EyeOff } from "lucide-react";
import { OCH_KUL, ORANJ, QIZIL, SIYOH, YASHIL } from "./ui";

export type HolatKor = {
  matn: string;
  rang: string;
  /** Nuqta o'rniga ko'z-chizilgan ikonka chiziladi. */
  koz?: boolean;
};

export const ELON_HOLAT: Record<string, HolatKor> = {
  draft: { matn: "qoralama", rang: OCH_KUL },
  recruiting: { matn: "yig'ilmoqda", rang: YASHIL },
  filled: { matn: "to'ldi", rang: SIYOH },
  in_progress: { matn: "jarayonda", rang: ORANJ },
  completed: { matn: "yakunlandi", rang: OCH_KUL },
  cancelled: { matn: "bekor qilingan", rang: QIZIL },
  hidden: { matn: "yashirilgan", rang: OCH_KUL, koz: true },
};

/**
 * Filtr ro'yxatidagi tartib — Figma'dagi nishonlar ketma-ketligi.
 *
 * "draft" oxirida: qoralama e'lon hech kimga ko'rinmaydi, shuning uchun
 * moderator uni kamdan-kam qidiradi. Lekin ro'yxatdan butunlay olib
 * tashlanmadi — bazada bor holatni filtrlab bo'lmasa, admin uni topa olmasdi.
 */
export const ELON_HOLATLARI = [
  "recruiting",
  "filled",
  "in_progress",
  "completed",
  "cancelled",
  "hidden",
  "draft",
];

/**
 * Bazadagi qiymatni ko'rinishga aylantiradi.
 *
 * Tanish bo'lmagan qiymat (backend yangi holat qo'shsa) yashirilmaydi —
 * xom ko'rinishda, kulrang chiziladi va 24 belgida kesiladi. Bo'sh joy
 * ko'rsatish yomonroq bo'lardi: admin holatsiz qatorni "hammasi joyida"
 * deb o'qib ketardi.
 */
export function elonHolatKor(status?: string): HolatKor {
  const s = (status || "").trim();
  return ELON_HOLAT[s] || { matn: s.slice(0, 24) || "—", rang: OCH_KUL };
}

/**
 * Figma nishoni: shaffof fon, 1 px hoshiya holat rangida, 5 px nuqta.
 *
 * Hoshiya `inset` box-shadow bilan — Figma'da u INSIDE, CSS `border` esa
 * nishonni 2 px kattartirib, qator balandligini buzardi.
 */
export function ElonNishoni({ matn, rang, koz }: HolatKor) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full py-[3px] pl-[8px] pr-[10px] text-[11px] font-medium leading-[15px]"
      style={{ color: rang, boxShadow: `inset 0 0 0 1px ${rang}` }}
    >
      {koz ? (
        <EyeOff size={11} strokeWidth={2} aria-hidden />
      ) : (
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: rang }}
          aria-hidden
        />
      )}
      {matn}
    </span>
  );
}

export function ElonHolatNishoni({ status }: { status?: string }) {
  const k = elonHolatKor(status);
  return <ElonNishoni {...k} />;
}
