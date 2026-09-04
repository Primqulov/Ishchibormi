"use client";
/**
 * "3.12 · Xatoliklar" ekranlarining umumiy g'ishtlari.
 *
 * # NEGA ALOHIDA FAYL
 *
 * Batafsil ekran (`app/admin/errors/[id]`) sakkizta kartadan iborat, AI
 * eksporti paneli esa xuddi shu karta ichida yashaydi. Ikkalasini bitta
 * faylga yozsak, bitta komponentni tuzatish uchun 1500 qatorli faylni
 * qayta o'qishga to'g'ri kelardi. Bu yerda faqat KO'RINISH bor — holat
 * ham, so'rov ham yo'q, shuning uchun ularni istalgan joyda ishlatish
 * mumkin.
 *
 * # O'LCHAMLAR QAYERDAN
 *
 * Barchasi Figma "3.12.1 · Xatolik — batafsil" dan: karta sarlavhasi 52,
 * yorliq/qiymat qatori 32, nishon balandligi 21, avatar 30. Hoshiyalar
 * `box-shadow: inset` bilan chiziladi — Figma'da chegara STROKE INSIDE,
 * ya'ni u qutini KENGAYTIRMAYDI. Oddiy CSS `border` ishlatilsa, har bir
 * karta 2 px kengayib, 12 px lik tirqishlar buzilardi.
 */
import { useCallback, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";
import {
  AVATAR_FON,
  HOSHIYA,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  ORANJ_FON,
  ORANJ_MATN,
  QIZIL,
  QIZIL_FON,
  QIZIL_HOSHIYA,
  SOYA,
  XIRA_QUYUQ,
  YASHIL,
} from "./ui";
import { YOQ } from "./xato";

/** Avatar foni — ro'yxat sahifasidagi bilan bir xil (Figma 3.12). */
export const AVATAR_KO_K = "#dce9ff";

export const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

/* ── Buferga nusxalash ────────────────────────────────────────────────
   Uchta karta ham ("Stack trace", "So'rov", "AI kontekst") shu funksiyani
   chaqiradi. Ikki yo'l bor, chunki `navigator.clipboard` FAQAT xavfsiz
   kontekstda (https yoki localhost) ishlaydi: admin panelni ichki tarmoqda
   `http://192.168.…` orqali ochsa, birinchi yo'l umuman mavjud bo'lmaydi.
   Ikkinchi yo'l ham ishlamasa `false` qaytadi va ekran "nusxalab bo'lmadi,
   matnni qo'lda belgilang" deb aytadi — jimgina muvaffaqiyat ko'rsatmaydi. */
export async function nusxaOl(matn: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(matn);
      return true;
    } catch {
      /* zaxira yo'lga o'tamiz */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = matn;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/* ── Karta ─────────────────────────────────────────────────────────── */

export function Karta({
  sarlavha,
  amal,
  tana = "px-[18px] pb-[12px] pt-[6px]",
  uslub,
  children,
}: {
  sarlavha?: ReactNode;
  /** Sarlavhaning o'ng chetidagi havola yoki tugma. */
  amal?: ReactNode;
  /** Tana o'ramining sinflari. Jadval uchun `""` uzatiladi. */
  tana?: string;
  uslub?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-[14px] bg-white"
      style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}`, ...uslub }}
    >
      {sarlavha !== undefined && (
        <>
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-[18px]">
            <h2 className="truncate text-[14px] font-semibold leading-[19px]" style={{ color: IK }}>
              {sarlavha}
            </h2>
            {amal}
          </div>
          <div className="h-px shrink-0" style={{ background: HOSHIYA }} />
        </>
      )}
      <div className={`min-w-0 ${tana}`}>{children}</div>
    </section>
  );
}

/** Karta sarlavhasidagi o'ng havola: 12 px, ko'k, tugma sifatida. */
export function KartaAmal({
  nomi,
  bosildi,
  ochiq,
  ipucha,
}: {
  nomi: ReactNode;
  bosildi?: () => void;
  ochiq?: boolean;
  ipucha?: string;
}) {
  return (
    <button
      type="button"
      onClick={bosildi}
      disabled={ochiq || !bosildi}
      title={ipucha}
      className={`shrink-0 rounded-md text-[12px] font-medium leading-4 transition-opacity ${
        ochiq || !bosildi ? "cursor-default" : "hover:opacity-70"
      } ${FOKUS}`}
      style={{ color: ochiq ? XIRA_QUYUQ : KO_K }}
    >
      {nomi}
    </button>
  );
}

/* ── Yorliq / qiymat qatori ───────────────────────────────────────────
   Figma: 32 px balandlik, pastida 1 px ajratgich, oxirgi qatorda yo'q.
   Qiymat bo'sh bo'lsa BO'SH KATAK qoldirilmaydi — "aniqlanmagan" yoziladi
   va u xira rangda bo'ladi. Bo'sh katak "ma'lumot yo'q" emas, "ekran
   buzuq" degan taassurot qoldiradi. */

export function KQator({
  yorliq,
  qiymat,
  rang,
  ipucha,
  qalin,
  oxirgi,
}: {
  yorliq: string;
  qiymat?: ReactNode;
  /** Qiymat rangi. Berilmasa — qora (yoki bo'sh bo'lsa xira). */
  rang?: string;
  ipucha?: string;
  qalin?: boolean;
  oxirgi?: boolean;
}) {
  const bosh = qiymat === undefined || qiymat === null || qiymat === "";
  return (
    <div
      className="flex min-h-[32px] items-center justify-between gap-3 py-[6px]"
      style={oxirgi ? undefined : { boxShadow: `inset 0 -1px 0 0 ${HOSHIYA}` }}
    >
      <span className="shrink-0 text-[12px] leading-4" style={{ color: OCH_KUL }}>
        {yorliq}
      </span>
      <span
        className={`min-w-0 break-words text-right text-[12.5px] leading-[17px] ${qalin ? "font-semibold" : "font-medium"}`}
        style={{ color: bosh ? XIRA_QUYUQ : (rang ?? IK) }}
        title={ipucha}
      >
        {bosh ? YOQ : qiymat}
      </span>
    </div>
  );
}

/* ── Nishon ────────────────────────────────────────────────────────── */

export function Nishon({
  nomi,
  rang,
  matn,
  nuqta,
}: {
  nomi: ReactNode;
  rang: string;
  matn?: string;
  nuqta?: boolean;
}) {
  return (
    <span
      className="inline-flex h-[21px] max-w-full shrink-0 items-center rounded-full"
      style={{ boxShadow: `inset 0 0 0 1px ${rang}`, paddingLeft: nuqta ? 8 : 9, paddingRight: 10 }}
    >
      {nuqta && (
        <span
          aria-hidden
          className="mr-[5px] h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: rang }}
        />
      )}
      <span className="truncate text-[11px] font-medium leading-[15px]" style={{ color: matn ?? rang }}>
        {nomi}
      </span>
    </span>
  );
}

/** Kod uchun kulrang chipcha: `flutter.uncaught_exception`. */
export function Chip({ children, ipucha }: { children: ReactNode; ipucha?: string }) {
  return (
    <span
      className="inline-flex h-[20px] max-w-full items-center truncate rounded-[6px] px-[8px] text-[11.5px] font-medium leading-4"
      style={{ background: AVATAR_FON, color: KUL }}
      title={ipucha}
    >
      {children}
    </span>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────── */

/** "Aziz Karimov" → "AK", "#A1B2C3" → "A1". */
export function bosharf(nomi: string): string {
  const s = nomi.replace(/^#/, "").trim();
  const b = s.split(/\s+/).filter(Boolean);
  if (b.length >= 2) return (b[0][0] + b[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function Avatar({
  nomi,
  olcham = 30,
  fon = AVATAR_KO_K,
  rang = KO_K,
}: {
  nomi: string;
  olcham?: number;
  fon?: string;
  rang?: string;
}) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: olcham,
        height: olcham,
        background: fon,
        color: rang,
        fontSize: Math.round(olcham * 0.4),
        lineHeight: 1,
      }}
    >
      {bosharf(nomi)}
    </span>
  );
}

/* ── Xabarchalar (toast) ───────────────────────────────────────────── */

export type XabarKor = "ok" | "xato" | "kritik";
export type Xabarcha = { id: number; kor: XabarKor; sarlavha: string; matn?: string };

const XABAR_RANG: Record<XabarKor, { rang: string; fon: string; hoshiya: string }> = {
  ok: { rang: YASHIL, fon: "#f2fbf6", hoshiya: "#b7e3ca" },
  xato: { rang: QIZIL, fon: QIZIL_FON, hoshiya: QIZIL_HOSHIYA },
  kritik: { rang: QIZIL, fon: QIZIL_FON, hoshiya: QIZIL_HOSHIYA },
};

/**
 * Xabarcha navbati.
 *
 * Bir vaqtda ko'pi bilan uchtasi turadi (`slice(-2)` + yangisi): admin
 * ketma-ket bir necha amal bajarsa, ekranning o'ng tomoni butunlay
 * xabarchalar bilan to'lib qolmasin. Har biri 6 soniyada o'zi ketadi.
 */
export function useXabarlar() {
  const [xabarlar, setXabarlar] = useState<Xabarcha[]>([]);
  const raqam = useRef(0);

  const xabarYop = useCallback((id: number) => {
    setXabarlar((v) => v.filter((x) => x.id !== id));
  }, []);

  const xabarQosh = useCallback((kor: XabarKor, sarlavha: string, matn?: string) => {
    const id = ++raqam.current;
    setXabarlar((v) => [...v.slice(-2), { id, kor, sarlavha, matn }]);
    window.setTimeout(() => setXabarlar((v) => v.filter((x) => x.id !== id)), 6000);
  }, []);

  return { xabarlar, xabarQosh, xabarYop };
}

export function Xabarlar({
  xabarlar,
  yop,
}: {
  xabarlar: Xabarcha[];
  yop: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {xabarlar.map((x) => {
        const c = XABAR_RANG[x.kor];
        return (
          <div
            key={x.id}
            className="pointer-events-auto flex items-start gap-[10px] rounded-[12px] bg-white px-3 py-[11px]"
            style={{ boxShadow: `inset 0 0 0 1px ${c.hoshiya}, 0 10px 28px rgba(11,28,48,0.14)` }}
          >
            <span
              aria-hidden
              className="mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full"
              style={{ background: c.fon }}
            >
              {x.kor === "ok" ? (
                <CircleCheck size={14} color={c.rang} />
              ) : x.kor === "kritik" ? (
                <TriangleAlert size={14} color={c.rang} />
              ) : (
                <CircleAlert size={14} color={c.rang} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-[18px]" style={{ color: IK }}>
                {x.sarlavha}
              </div>
              {x.matn && (
                <div className="mt-[2px] break-words text-[12px] leading-4" style={{ color: OCH_KUL }}>
                  {x.matn}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => yop(x.id)}
              aria-label="Xabarchani yopish"
              className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-md transition-opacity hover:opacity-60 ${FOKUS}`}
            >
              <X size={13} color={OCH_KUL} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── Izoh qutisi ───────────────────────────────────────────────────── */

const IZOH_KOR = {
  sariq: { fon: ORANJ_FON, matn: ORANJ_MATN, hoshiya: "#f0dcbb" },
  yashil: { fon: "#f1faf5", matn: "#14663f", hoshiya: "#c2e6d4" },
  kok: { fon: "#f2f6fc", matn: "#2f4a75", hoshiya: "#d5e0f5" },
  kul: { fon: "#fbfcff", matn: OCH_KUL, hoshiya: HOSHIYA },
} as const;

export function Izohcha({
  kor = "kul",
  ikon,
  children,
}: {
  kor?: keyof typeof IZOH_KOR;
  ikon?: ReactNode;
  children: ReactNode;
}) {
  const k = IZOH_KOR[kor];
  return (
    <div
      className="flex items-start gap-[8px] rounded-[10px] px-[12px] py-[10px] text-[12px] leading-[17px]"
      style={{ background: k.fon, color: k.matn, boxShadow: `inset 0 0 0 1px ${k.hoshiya}` }}
    >
      {ikon && <span className="mt-[1px] shrink-0">{ikon}</span>}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
