/**
 * Admin panelining filtr yo'lagi elementlari.
 *
 * Figma "3.3 · Foydalanuvchilar" va "3.5 · E'lonlar" ikkalasida ham filtr
 * maydonlari BIR XIL chizilgan: h38, radius 9, 1 px hoshiya #c3c6d7, matn
 * 13/18. Shuning uchun ular shu yerda bir marta yozilgan — ikkita ekranda
 * takrorlansa, biri o'zgarganda ikkinchisi ortda qolib ketardi.
 *
 * # NEGA RADIUS 9, `rounded-full` EMAS
 *
 * Ilgari bu maydonlar to'liq dumaloq (`rounded-full`) edi. Figma'da esa
 * ikkala ekranda ham 9 px radius — tugmalar (radius 9–10) bilan bir oilada
 * turishi uchun. To'liq dumaloq maydon yonidagi to'rtburchak tugma bilan
 * bir qatorda "begona" ko'rinardi.
 */
import type { ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  XIRA_QUYUQ,
} from "./ui";

/**
 * Klaviatura fokusi — Figma "3.6a · Arizalar", 3-panel: «Fokus: chegara
 * 2 px #004ac6».
 *
 * `outline` ATAYLAB, `ring` emas: bu maydonlarning hoshiyasi inline
 * `boxShadow` bilan chiziladi, Tailwind `ring` esa xuddi shu
 * `box-shadow` xossasini ishlatadi — inline uslub uni bosib ketardi va
 * Tab bilan yurgan admin fokus qayerda ekanini ko'rmasdi.
 */
const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

const ASOS =
  `h-[38px] rounded-[9px] bg-white text-[13px] leading-[18px] outline-none ${FOKUS}`;
const HOSHIYALI = { boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` };

/**
 * Matn kiritish filtri. `qidiruv` bo'lsa chap tomonda lupa ikonkasi chiziladi.
 *
 * `maxLength` majburiy emas, lekin har bir chaqiruvda berilgan: bu qiymat
 * to'g'ridan-to'g'ri so'rov satriga tushadi, cheklovsiz maydon esa
 * kilobaytlik regexni serverga yuborish imkonini berardi.
 */
export function MatnFiltr({
  nomi,
  kenglik,
  qiymat,
  ozgardi,
  placeholder,
  qidiruv,
  maxLength = 80,
}: {
  nomi: string;
  kenglik: number;
  qiymat: string;
  ozgardi: (v: string) => void;
  placeholder: string;
  qidiruv?: boolean;
  maxLength?: number;
}) {
  const kirit = (
    <input
      aria-label={nomi}
      className={`${ASOS} w-full ${qidiruv ? "pl-[35px] pr-[12px]" : "px-[12px]"} placeholder:text-[#9aa0b0]`}
      style={{ color: IK, ...HOSHIYALI }}
      placeholder={placeholder}
      value={qiymat}
      maxLength={maxLength}
      onChange={(e) => ozgardi(e.target.value)}
    />
  );
  if (!qidiruv) {
    return (
      <div className="shrink-0" style={{ width: kenglik }}>
        {kirit}
      </div>
    );
  }
  return (
    <div className="relative shrink-0" style={{ width: kenglik }}>
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2"
        style={{ color: XIRA_QUYUQ }}
      />
      {kirit}
    </div>
  );
}

/**
 * Ro'yxatdan tanlash filtri — o'ng tomonda strelka ikonkasi.
 *
 * `kenglik` MAJBURIY EMAS: filtr yo'lagida maydonlar Figma'dagi qat'iy
 * kengliklarda turadi, oyna ichida esa (masalan "Holatni o'zgartirish")
 * tanlov butun kenglikni egallashi kerak. Oynaning kengligi keyin
 * o'zgarsa, bu yerdagi piksel qiymati ortda qolib ketardi — shuning
 * uchun kenglik berilmasa maydon o'zi cho'ziladi.
 *
 * # NEGA `faol` ALOHIDA BELGI
 *
 * Figma "3.6a · Arizalar", 3-panel: tanlov «Barchasi» turganda oddiy
 * kulrang hoshiyada, biror holat tanlanganda esa 1.5 px ko'k hoshiyada
 * chiziladi. Buni `qiymat !== ""` dan o'zi topib olishi MUMKIN EMAS: bir
 * ekranda bo'sh qiymat "filtr yo'q", boshqasida ("Holatni o'zgartirish"
 * oynasi) "hali tanlanmagan" degani. Shuning uchun qaror chaqiruvchida
 * qoladi.
 */
export function Tanlov({
  nomi,
  kenglik,
  qiymat,
  ozgardi,
  faol,
  ochiq,
  children,
}: {
  nomi: string;
  kenglik?: number;
  qiymat: string;
  ozgardi: (v: string) => void;
  /** Filtr ishlab turibdi — ko'k hoshiya. */
  faol?: boolean;
  /** O'chirilgan (masalan ro'yxat yuklanmoqda). */
  ochiq?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative ${kenglik ? "shrink-0" : "w-full"}`}
      style={kenglik ? { width: kenglik } : undefined}
    >
      <select
        aria-label={nomi}
        className={`${ASOS} w-full appearance-none pl-[12px] pr-[30px] ${ochiq ? "cursor-not-allowed" : "cursor-pointer"}`}
        style={{
          // O'chirilgan holat rangi Figma 3.6a · 3-paneldan: fon #eef1fb,
          // matn #9aa0b0. `bg-white` ni bosib o'tishi uchun `background`
          // shu yerda beriladi.
          color: ochiq ? XIRA_QUYUQ : faol ? IK : KUL,
          background: ochiq ? AVATAR_FON : undefined,
          boxShadow: faol
            ? `inset 0 0 0 1.5px ${KO_K}`
            : `inset 0 0 0 1px ${ochiq ? HOSHIYA : HOSHIYA_QUYUQ}`,
        }}
        value={qiymat}
        disabled={ochiq}
        onChange={(e) => ozgardi(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2"
        style={{ color: ochiq ? XIRA_QUYUQ : faol ? KO_K : OCH_KUL }}
      />
    </div>
  );
}

/**
 * Belgilash (checkbox) filtri — Figma "3.6 · Arizalar" filtr yo'lagidagi
 * «Uzoq kutayotgan (3+ kun)».
 *
 * # NEGA HAQIQIY `<input type="checkbox">`
 *
 * Ko'rinishi Figma'dagi 18×18 quti bo'lsa ham, ostida haqiqiy belgilash
 * maydoni turadi: `<div onClick>` bilan qilinsa, u Tab bilan
 * topilmasdi, bo'shliq tugmasi ishlamasdi va ekran o'quvchisi "belgilangan
 * / belgilanmagan" holatini aytmasdi. Maydonning o'zi ko'rinmas
 * (`opacity-0`), lekin joyida — brauzerning butun xatti-harakati saqlanadi.
 *
 * # NEGA FOKUS QOPLAMASI ALOHIDA
 *
 * Figma'da fokus butun yo'lakni 2 px ko'k hoshiya bilan o'raydi. Yo'lak
 * o'zi `<label>` — CSS'da esa "ichidagi maydon fokusda" degan holatni
 * qardosh element orqali ushlash kerak, shuning uchun `peer` dan keyin
 * turgan mutlaq qoplama chiziladi.
 *
 * # NEGA O'LCHAM PROPLARI
 *
 * Xuddi shu yo'lak 3.7a · C dagi turkum oynasida ham bor, lekin u yerda
 * 505×44, 10 px radius, 14 px chap chekinish va 10 px oraliq bilan;
 * 3.8 dagi «Qabul qiluvchilar» yo'lagi esa 380×46 va izohi yozuv OSTIDA
 * turadi. Belgilash mantiqini (haqiqiy maydon + fokus qoplamasi) uchinchi
 * joyda qaytadan yozish — a11y xatosini uchlantirish demak, shuning uchun
 * o'lchamlar prop bo'lib chiqarilgan. Radius, balandlik va chekinish `style`
 * orqali beriladi: Tailwind sinf nomini ish vaqtida yasab bo'lmaydi.
 */
export function Belgilash({
  nomi,
  izoh,
  kenglik,
  balandlik = 38,
  radius = 9,
  chap = 12,
  oraliq = 9,
  toliq,
  ustunda,
  belgilangan,
  ozgardi,
  ochiq,
}: {
  nomi: string;
  /** Qavs ichidagi qo'shimcha (Figma: "(3+ kun)"). */
  izoh?: string;
  kenglik?: number;
  /** Figma: filtr yo'lagida 38, 3.7a oynasida 44, 3.8 formasida 46. */
  balandlik?: number;
  /** Figma: filtr yo'lagida 9, 3.7a va 3.8 da 10. */
  radius?: number;
  /** Chap chekinish — Figma: filtr yo'lagida 12, 3.7a/3.8 da 14. */
  chap?: number;
  /** Quti va yozuv orasi — Figma: filtr yo'lagida 9, 3.7a/3.8 da 10. */
  oraliq?: number;
  /** Oyna ichidagi yo'lak butun kenglikni egallaydi. */
  toliq?: boolean;
  /**
   * Izoh yozuvning O'NG YONIDA emas, OSTIDA turadi (Figma 3.8: «Faqat
   * faol (bloklanmagan)» + ostida «standart holatda yoqilgan»). Bir
   * qatorda 380 px ga sig'masdi, shuning uchun ikkinchi qatorga tushadi
   * va bir pog'ona kichikroq (11 px) yoziladi.
   */
  ustunda?: boolean;
  belgilangan: boolean;
  ozgardi: (v: boolean) => void;
  ochiq?: boolean;
}) {
  const yozuv = (
    <span
      className={`text-[13px] font-medium ${ustunda ? "leading-[19px]" : "whitespace-nowrap leading-[18px]"}`}
      style={{ color: ochiq ? XIRA_QUYUQ : KUL }}
    >
      {nomi}
    </span>
  );
  const qoshimcha = izoh ? (
    <span
      className={
        ustunda
          ? "text-[11px] leading-4"
          : "whitespace-nowrap text-[12px] leading-[16px]"
      }
      style={{ color: XIRA_QUYUQ }}
    >
      {izoh}
    </span>
  ) : null;

  return (
    <label
      className={`relative select-none items-center bg-white pr-[14px] ${
        toliq ? "flex w-full" : "inline-flex"
      } ${kenglik ? "shrink-0" : ""} ${
        ochiq ? "cursor-not-allowed" : "cursor-pointer hover:bg-[#f8f9ff]"
      }`}
      style={{
        width: kenglik,
        height: balandlik,
        borderRadius: radius,
        paddingLeft: chap,
        gap: oraliq,
        background: ochiq ? AVATAR_FON : undefined,
        boxShadow: `inset 0 0 0 1px ${ochiq ? HOSHIYA : HOSHIYA_QUYUQ}`,
      }}
    >
      <input
        type="checkbox"
        className="peer pointer-events-none absolute h-[18px] w-[18px] opacity-0"
        style={{ left: chap }}
        checked={belgilangan}
        disabled={ochiq}
        onChange={(e) => ozgardi(e.target.checked)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 peer-focus-visible:shadow-[inset_0_0_0_2px_#004ac6]"
        style={{ borderRadius: radius }}
      />
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
        style={{
          background: belgilangan && !ochiq ? KO_K : "transparent",
          boxShadow: belgilangan && !ochiq
            ? "none"
            : `inset 0 0 0 1.5px ${ochiq ? HOSHIYA : HOSHIYA_QUYUQ}`,
        }}
      >
        {belgilangan && !ochiq ? (
          <Check size={12} strokeWidth={3} className="text-white" />
        ) : null}
      </span>
      {ustunda ? (
        <span className="flex min-w-0 flex-col gap-[1px]">
          {yozuv}
          {qoshimcha}
        </span>
      ) : (
        <>
          {yozuv}
          {qoshimcha}
        </>
      )}
    </label>
  );
}
