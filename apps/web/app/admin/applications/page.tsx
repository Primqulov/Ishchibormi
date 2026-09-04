"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import {
  api,
  ApplicationRow,
  PagedApplications,
  downloadAdminCsv,
  APIError,
} from "@/lib/api";
import { Belgilash, Tanlov } from "@/components/admin/Filtr";
import {
  ARIZA_HOLAT,
  ARIZA_HOLATLARI,
  ArizaNishoni,
  KutishChipi,
  UZOQ_KUTISH_KUN,
  arizaHolatKor,
  kutishKunlari,
} from "@/components/admin/ArizaHolat";
import {
  AVATAR_FON,
  HOSHIYA,
  IK,
  KO_K,
  KO_K_FON,
  KUL,
  OCH_KUL,
  QIZIL,
  SARLAVHA_FON,
  SOYA,
  XIRA_QUYUQ,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.6 · Arizalar — ro'yxat (1440×1024)" va
          "3.6a · Arizalar — holatlar, qoidalar va CSV".

   O'lchamlar Figma'dan aynan olingan: sarlavha kartasi 70, voronka
   kartasi 114, filtr paneli 66, jadval sarlavhasi 46, qator 72,
   sahifalash 64 px. Ustunlar: E'lon 322 · Ishchi 230 · Summa 184 ·
   Holat 207 · Yuborilgan 209 (jami 1152).

   # BU EKRAN FAQAT KO'RISH UCHUN

   Figma 3.6a sarlavhasidagi qoida: «Ushbu ekran faqat ko'rish uchun
   (read-only): admin arizani tasdiqlay yoki rad eta olmaydi — holatni
   ishchi va ish beruvchi o'zgartiradi.» Shuning uchun jadvalda
   «Amallar» ustuni ATAYLAB yo'q va sahifada birorta ham holatni
   o'zgartiruvchi so'rov yuborilmaydi. Backend ham shu qoidada: bu
   yo'lda faqat `GET` bor (cmd/api/main.go).

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow ishlatilgan.
   ───────────────────────────────────────────────────────────────────── */

/** Figma 3.6: jadvalda 8 qator (576 / 72), sahifalash ham shundan. */
const LIMIT = 8;

/* Filtrlarning RUXSAT ETILGAN qiymatlari.
 *
 * Backend ham o'z tomonida oq ro'yxatdan o'tkazadi (`appsFilter`), lekin
 * so'rov ketishidan OLDIN tekshirish bu yerdagi holat buzilib qolsa ham
 * kutilmagan parametr yuborilishining oldini oladi. */
const HOLAT_QIY: readonly string[] = ["", ...ARIZA_HOLATLARI];

const oq = (v: string, ruxsat: readonly string[]) => (ruxsat.includes(v) ? v : "");

/**
 * Identifikator — faqat 24 belgili hex (MongoDB ObjectID).
 *
 * Ikki joyda kerak. `id` javobdan keladi, ya'ni "ishonchli" ko'rinadi,
 * lekin u to'g'ridan-to'g'ri manzilga tushadi: shakli tekshirilmasa,
 * buzilgan yozuv admin bosgan havolani ma'nosiz manzilga aylantirardi
 * (shakl mos kelmasa qator havola bo'lmaydi). `?worker=` esa BRAUZERDAN
 * keladi va serverga so'rov bo'lib ketadi — u ham xuddi shu qorovuldan
 * o'tadi.
 */
const oqOid = (v: string) => (/^[0-9a-f]{24}$/i.test(v) ? v : "");

/**
 * Ming ajratgichi — UZUQ BO'SHLIQ (nbsp), Figma: "4 980".
 *
 * Oddiy bo'shliq bo'lsa, ingichka ustunda son ikki qatorga bo'linib
 * ketishi mumkin ("2" va "140") — nbsp buni butunlay imkonsiz qiladi.
 */
function son(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Sana + soat, Figma "22.08.2026 · 09:14".
 *
 * Ajratgich atrofida nbsp: HTML ketma-ket bo'shliqlarni yig'ib
 * yuboradi va nuqta sanaga yopishib qolardi.
 */
function sanaVaqt(iso?: string): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Sahifalash tugmalari ro'yxati — Figma: "‹ 1 2 3 4 5 … 268 ›".
 *
 * Barcha sahifalarni chizib bo'lmaydi (2 140 / 8 = 268 sahifa), shuning
 * uchun oyna: boshi, joriy atrofi va oxiri. Uzilish joyi «…» bilan
 * ko'rsatiladi — u tugma emas, faqat belgi.
 */
function sahifaRaqamlari(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "…", pages];
  if (page >= pages - 3) {
    return [1, "…", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  }
  return [1, "…", page - 1, page, page + 1, "…", pages];
}

/** Figma 3.6a: bo'sh va xato holatlaridagi asosiy tugma (r9, pad 9/16). */
function AsosiyTugma({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 select-none items-center justify-center rounded-[9px] px-4 text-[13px] font-semibold leading-[18px] text-white transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6]"
      style={{ background: KO_K }}
    >
      {children}
    </button>
  );
}

/**
 * `useSearchParams` Suspense chegarasini talab qiladi (Next App Router).
 * `fallback` bo'sh: skelet jadval ichkarida, birinchi yuklanish holatida
 * chiziladi — bu yerda ikkinchi "yuklanmoqda" ko'rinishi ekranni bir
 * lahzaga bo'shatib, sahifani sakratardi.
 */
export default function AdminApplications() {
  return (
    <Suspense fallback={null}>
      <Arizalar />
    </Suspense>
  );
}

function Arizalar() {
  const router = useRouter();
  const qidiruv = useSearchParams();

  /* Boshlang'ich holat MANZILDAN o'qiladi.
   *
   * Batafsil sahifadagi «← Arizalar» va «Barchasini ko'rish» havolalari
   * filtrni manzilda olib yuradi (Figma 3.6.1a · hodisalar: «filtr,
   * qidiruv va sahifa raqami saqlanadi»). Faqat MOUNT paytida o'qiladi —
   * `useState` boshlovchisi keyingi render'larda qayta chaqirilmaydi,
   * ya'ni pastdagi manzilni yangilash halqa yasamaydi.
   *
   * Har qiymat o'z shakliga tekshiriladi: manzil brauzerdan keladi. */
  const [data, setData] = useState<PagedApplications | null>(null);
  const [page, setPage] = useState(() => {
    const v = Number(qidiruv?.get("page"));
    return Number.isFinite(v) && v >= 1 && v <= 9999 ? Math.floor(v) : 1;
  });
  const [status, setStatus] = useState(() => oq((qidiruv?.get("status") || "").trim(), HOLAT_QIY));
  const [stale, setStale] = useState(() => qidiruv?.get("stale") === "1");
  const [worker, setWorker] = useState(() => oqOid((qidiruv?.get("worker") || "").trim()));
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [xato, setXato] = useState("");

  // Har so'rovga tartib raqami beriladi: sekin qaytgan ESKI javob yangi
  // filtr natijasini bosib ketmasin.
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    const men = ++soravRaqami.current;
    setYuklanmoqda(true);
    // Xato darhol tozalanadi: «Qayta urinish» bosilganda ekran yana
    // skelet qatorlarga qaytishi kerak, aks holda tugma bosilgani
    // bilinmasdi.
    setXato("");
    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, Math.floor(page))),
        limit: String(LIMIT),
      });
      if (oq(status, HOLAT_QIY)) params.set("status", status);
      if (stale) params.set("stale", "1");
      if (oqOid(worker)) params.set("worker", worker);
      const javob = await api.get<PagedApplications>(
        `/api/admin/applications?${params}`,
        { auth: "admin" } as any,
      );
      if (men !== soravRaqami.current) return;
      setData(javob);
      setXato("");
    } catch (e) {
      if (men !== soravRaqami.current) return;
      setData(null);
      setXato((e as APIError)?.message || "Ma'lumotni yuklab bo'lmadi");
    } finally {
      if (men === soravRaqami.current) setYuklanmoqda(false);
    }
  }, [page, status, stale, worker]);

  useEffect(() => { load(); }, [load]);

  /* Joriy ko'rinishning manzil ko'rinishi. Ikki joyda kerak: brauzer
     manzilini yangilashda va batafsil sahifaga o'tadigan qator
     havolasida — ikkisi bir manbadan yasalgani uchun ular hech qachon
     bir-biridan farq qilmaydi. */
  const holatSatri = useMemo(() => {
    const p = new URLSearchParams();
    if (page > 1) p.set("page", String(page));
    if (oq(status, HOLAT_QIY)) p.set("status", status);
    if (stale) p.set("stale", "1");
    if (oqOid(worker)) p.set("worker", worker);
    return p.toString();
  }, [page, status, stale, worker]);

  /* Manzil holatga ergashadi: sahifani yangilash yoki havolani ulashish
     AYNI ko'rinishni qaytaradi, va filtr olib tashlangach manzilda
     o'lik `?worker=` qolib ketmaydi.

     `replace` — har filtr bosilishi tarixga yozilsa, «ortga» tugmasi
     admin qilgan tanlovlarni bittalab orqaga qaytarardi; unga esa
     ro'yxatdan CHIQIB ketish kerak. */
  useEffect(() => {
    // Manzil allaqachon shu holatda bo'lsa — hech narsa qilinmaydi.
    // Tekshiruvsiz bu effekt o'zi keltirib chiqargan navigatsiyadan
    // keyin yana ishga tushib, cheksiz halqaga tushishi mumkin edi.
    // Kalitlar tartibi manzilda boshqacha bo'lsa (`?status=…&page=…`)
    // bir marta almashtiriladi va shundan keyin ikkisi teng bo'ladi.
    if ((qidiruv?.toString() || "") === holatSatri) return;
    router.replace(
      holatSatri ? `/admin/applications?${holatSatri}` : "/admin/applications",
      { scroll: false },
    );
  }, [holatSatri, qidiruv, router]);

  function exportCsv() {
    // Figma 3.6a · 7: "Yuklab olish joriy filtrga bo'ysunadi."
    //
    // `page` va `limit` ATAYLAB yuborilmaydi: eksport ko'rinib turgan
    // 8 qatorni emas, filtrga mos BUTUN ro'yxatni beradi.
    const params = new URLSearchParams();
    if (oq(status, HOLAT_QIY)) params.set("status", status);
    if (stale) params.set("stale", "1");
    // Ishchi filtri ham qo'shiladi: aks holda bitta ishchi bo'yicha
    // filtrlangan ekrandan butun bazaning CSV fayli tushardi.
    if (oqOid(worker)) params.set("worker", worker);
    downloadAdminCsv("/api/admin/export/applications.csv", params);
  }

  /* Filtr o'zgarsa 1-sahifaga qaytamiz: 268-sahifada turib filtrni
     almashtirgan admin bo'sh jadvalni "ariza yo'q" deb o'qib ketardi.

     Sahifa AYNI shu yerda tiklanadi, `useEffect` da emas: effekt
     mount'da ham ishga tushib, manzildan o'qilgan sahifa raqamini
     darhol 1 ga qaytarardi — ya'ni «ortga» qaytgan admin ro'yxatning
     boshiga tushib qolardi. */
  function holatniTanla(v: string) {
    setStatus(oq(v, HOLAT_QIY));
    setPage(1);
  }

  function staleniTanla(v: boolean) {
    setStale(v);
    setPage(1);
  }

  function filtrniTozala() {
    setStatus("");
    setStale(false);
    setWorker("");
    setPage(1);
  }

  const total = useMemo(() => {
    const t = data?.total;
    return typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
  }, [data]);
  const overall = useMemo(() => {
    const t = data?.overall;
    return typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
  }, [data]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const qatorlar = data?.items ?? [];
  const sanoq = data?.counts;
  const filtrBor = !!status || stale || !!worker;

  /* Ishchi chipidagi yozuv — filtrlangan qatorlarning birinchisidan.
   *
   * Javobda ishchining alohida obyekti yo'q (`ApplicationRow` faqat ism
   * va telefonni olib keladi), shuning uchun nom shu qatordan olinadi.
   * Qator bo'lmasa umumiy matn ishlatiladi: chipda 24 belgili ID ni
   * ko'rsatish admin uchun hech narsa anglatmasdi. */
  const ishchiChipi =
    (qatorlar[0]?.workerName || "").trim() ||
    (qatorlar[0]?.workerPhone || "").trim() ||
    "tanlangan ishchi";
  // Birinchi yuklanish — filtr maydonlari o'chiq holatda chiziladi
  // (Figma 3.6a · 3). Keyingi yuklanishlarda ular ochiq qoladi: admin
  // javobni kutib turganda ham filtrni almashtira olishi kerak.
  const birinchiYuklanish = yuklanmoqda && !data && !xato;

  const karta: React.CSSProperties = { boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` };
  const ustun = (px: number) => ({ width: `${(px / 1152) * 100}%` });
  const csvUslub = tugma("ikkilamchi");
  const boshi = total ? (page - 1) * LIMIT + 1 : 0;
  const oxiri = Math.min(page * LIMIT, total);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha kartasi (Figma 72:180 — 70 px) ──────────────────── */}
      <div
        className="flex h-[70px] items-center justify-between gap-3 rounded-[14px] bg-white px-5"
        style={karta}
      >
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-6" style={{ color: IK }}>
            Arizalar
          </h1>
          {/* Sarlavhadagi son — FILTRSIZ umumiy soni (`overall`), filtr
              natijasi esa filtr yo'lagining o'ng chetida. Ikkisi bir xil
              bo'lganda ham ular boshqa savolga javob beradi. */}
          <p className="mt-[2px] text-[12px] leading-4" style={{ color: OCH_KUL }}>
            {data
              ? `Jami ${son(overall)} ta ariza`
              : yuklanmoqda
                ? "Yuklanmoqda…"
                : "Jami soni aniqlanmadi"}
          </p>
        </div>
        <button
          onClick={exportCsv}
          className={`${csvUslub.className} w-[155px] shrink-0`}
          style={csvUslub.style}
        >
          <Download size={15} aria-hidden />
          CSV yuklab olish
        </button>
      </div>

      {/* ── Voronka kartalari (Figma 72:190 — 5 × 114 px, bosiladigan) ──
          Figma 3.6a · 2: "Kartani bosish = shu holat bo'yicha filtr. Bir
          vaqtda faqat bitta tanlanadi." Shuning uchun ular `radio` emas,
          `aria-pressed` li tugmalar: tanlangan kartani qayta bosish
          filtrni olib tashlaydi, radio guruhida esa buni qilib
          bo'lmasdi. */}
      <div className="flex flex-wrap gap-3">
        {ARIZA_HOLATLARI.map((s) => {
          const kor = ARIZA_HOLAT[s];
          const tanlangan = status === s;
          const n = sanoq ? Math.max(0, Math.floor(sanoq[s] || 0)) : null;
          // Foiz UMUMIY sondan hisoblanadi (Figma: 2 140 / 4 980 = 43%),
          // filtrlangan sondan emas — aks holda tanlangan karta har doim
          // 100% ko'rsatardi.
          const foiz = n !== null && overall > 0 ? Math.round((n / overall) * 100) : 0;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={tanlangan}
              onClick={() => setStatus(tanlangan ? "" : s)}
              className={`group relative flex h-[114px] min-w-[180px] flex-1 flex-col gap-[6px] rounded-[14px] bg-white px-4 py-[14px] text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6] ${
                tanlangan ? "" : "hover:bg-[#f8f9ff]"
              }`}
              style={{
                boxShadow: tanlangan
                  ? `inset 0 0 0 2px ${kor.rang}, 0 2px 14px ${kor.rang}33`
                  : `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}`,
              }}
            >
              {/* Hover hoshiyasi (Figma 3.6a · 2: #c3c6d7) alohida
                  qoplama bilan chiziladi: asosiy hoshiya inline
                  `boxShadow` da turadi va uni `hover:` sinfi bosib
                  o'ta olmasdi.

                  `group-hover:` — qoplamaning o'zi `pointer-events-none`,
                  ya'ni sichqoncha unga hech qachon "tegmaydi"; holat
                  kartaning o'zidan o'qiladi. */}
              {!tanlangan && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[14px] group-hover:shadow-[inset_0_0_0_1px_#c3c6d7]"
                />
              )}
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: kor.rang }}
                  aria-hidden
                />
                <span
                  className="truncate text-[12px] font-medium leading-4"
                  style={{ color: tanlangan ? IK : OCH_KUL }}
                >
                  {kor.matn}
                </span>
              </span>
              <span
                className="block whitespace-nowrap text-[26px] font-bold leading-[32px]"
                style={{ color: IK }}
              >
                {n === null ? "—" : son(n)}
              </span>
              <span
                className="block h-[5px] w-full overflow-hidden rounded-full"
                style={{ background: HOSHIYA }}
                aria-hidden
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${foiz}%`, background: kor.rang }}
                />
              </span>
              <span
                className="text-[11px] font-medium leading-[15px]"
                style={{ color: XIRA_QUYUQ }}
              >
                {n === null ? "—" : `${foiz}%`}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filtr + jadval kartasi (Figma 72:231) ────────────────────── */}
      <div className="overflow-hidden rounded-[14px] bg-white" style={karta}>
        {/* Figma: balandlik 66 (py 14 + maydon 38), oraliq 10. */}
        <div className="flex flex-wrap items-center gap-[10px] px-5 py-[14px]">
          <Tanlov
            nomi="Holat"
            kenglik={190}
            qiymat={status}
            faol={!!status}
            ochiq={birinchiYuklanish}
            ozgardi={holatniTanla}
          >
            <option value="">Barchasi</option>
            {ARIZA_HOLATLARI.map((s) => (
              <option key={s} value={s}>{ARIZA_HOLAT[s].matn}</option>
            ))}
          </Tanlov>
          {/* Figma 3.6a · 4: chegara «3+ kun» — u `UZOQ_KUTISH_KUN` dan
              o'qiladi, ya'ni izoh matni chegaradan ortda qolmaydi. */}
          <Belgilash
            nomi="Uzoq kutayotgan"
            izoh={`(${UZOQ_KUTISH_KUN}+ kun)`}
            kenglik={260}
            belgilangan={stale}
            ochiq={birinchiYuklanish}
            ozgardi={staleniTanla}
          />
          {/* Ishchi filtri chipi — batafsil sahifadagi «Barchasini
              ko'rish» havolasidan keladi (Figma 3.6.1a · hodisalar:
              «3.6 ga o'tadi va ishchi filtri chip bo'lib turadi»).
              Boshqa filtrlar kabi tanlov maydoni EMAS: ishchini bu
              ekrandan tanlab bo'lmaydi, faqat olib tashlanadi. */}
          {!!worker && (
            <span
              className="inline-flex h-[38px] max-w-[300px] items-center gap-[8px] rounded-[9px] px-[12px] text-[13px] font-medium leading-[18px]"
              style={{ background: KO_K_FON, boxShadow: "inset 0 0 0 1px #dce9ff", color: KO_K }}
            >
              <span className="truncate">Ishchi: {ishchiChipi}</span>
              <button
                type="button"
                onClick={() => {
                  setWorker("");
                  setPage(1);
                }}
                aria-label="Ishchi filtrini olib tashlash"
                title="Ishchi filtrini olib tashlash"
                className="-mr-[4px] grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-[#dce9ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]"
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          )}
          <div
            className="ml-auto text-[12px] font-medium leading-4"
            style={{ color: OCH_KUL }}
          >
            Jami: {data ? son(total) : "—"}
          </div>
        </div>
        <div className="h-px" style={{ background: HOSHIYA }} />

        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            {/* Jadval sarlavhasi — Figma: 46 px, fon #eef2fb, Semi Bold 12/16. */}
            <div
              className="flex h-[46px] items-center"
              style={{ background: SARLAVHA_FON }}
            >
              <div
                className="shrink-0 truncate pl-5 pr-3 text-[12px] font-semibold leading-4"
                style={{ ...ustun(322), color: IK }}
              >
                E&apos;lon
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-4"
                style={{ ...ustun(230), color: IK }}
              >
                Ishchi
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-4"
                style={{ ...ustun(184), color: IK }}
              >
                Summa
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-4"
                style={{ ...ustun(207), color: IK }}
              >
                Holat
              </div>
              <div
                className="shrink-0 truncate pl-3 pr-5 text-[12px] font-semibold leading-4"
                style={{ ...ustun(209), color: IK }}
              >
                Yuborilgan
              </div>
            </div>

            {/* Xato holati — Figma 3.6a · 6. Bo'sh jadval CHIZILMAYDI:
                admin uni "ariza yo'q" deb o'qib, noto'g'ri xulosaga
                kelardi. */}
            {xato && !qatorlar.length ? (
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-2 px-5 py-[64px] text-center"
              >
                <p className="text-[15px] font-semibold leading-5" style={{ color: QIZIL }}>
                  Server javob bermadi
                </p>
                <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
                  Ma&apos;lumotni yuklab bo&apos;lmadi. Qaytadan urinib ko&apos;ring.
                </p>
                {/* Xatoning o'zi ham ko'rsatiladi: "server javob bermadi"
                    bilan "sessiya tugadi" butunlay boshqa harakat talab
                    qiladi. */}
                <p className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
                  {xato}
                </p>
                <div className="mt-1">
                  <AsosiyTugma onClick={load}>Qayta urinish</AsosiyTugma>
                </div>
              </div>
            ) : birinchiYuklanish ? (
              /* Yuklanmoqda — Figma 3.6a · 6: "8 ta skelet qator
                 (shimmer) ko'rsatiladi, sarlavha va filtr joyida
                 qoladi." Balandlik ham 72 px: javob kelganda jadval
                 sakrab ketmaydi. */
              <div role="status" aria-live="polite">
                <span className="sr-only">Arizalar yuklanmoqda…</span>
                {Array.from({ length: LIMIT }, (_, i) => (
                  <div
                    key={i}
                    className={`flex h-[72px] items-center ${i % 2 === 1 ? "bg-[#f8f9ff]" : "bg-white"}`}
                    style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
                    aria-hidden
                  >
                    <div className="shrink-0 pl-5 pr-3" style={ustun(322)}>
                      <div className="h-[14px] w-[70%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                      <div className="mt-[7px] h-[12px] w-[40%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(230)}>
                      <div className="h-[14px] w-[65%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                      <div className="mt-[7px] h-[12px] w-[80%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(184)}>
                      <div className="h-[14px] w-[70%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(207)}>
                      <div className="h-[26px] w-[110px] animate-pulse rounded-[13px]" style={{ background: HOSHIYA }} />
                    </div>
                    <div className="shrink-0 pl-3 pr-5" style={ustun(209)}>
                      <div className="h-[13px] w-[80%] animate-pulse rounded" style={{ background: HOSHIYA }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : !qatorlar.length ? (
              /* Bo'sh holat — Figma 3.6a · 5. Tugma faqat filtr bor
                 bo'lganda chiziladi: filtrsiz bo'sh ro'yxatda
                 «Filtrlarni tozalash» hech narsani o'zgartirmasdi va
                 admin uni bosib "buzuq" deb o'ylardi. */
              <div className="flex flex-col items-center gap-2 px-5 py-[64px] text-center">
                <p className="text-[15px] font-semibold leading-5" style={{ color: IK }}>
                  Ariza topilmadi
                </p>
                <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
                  {!filtrBor
                    ? "Hozircha birorta ariza yuborilmagan."
                    : worker
                      ? "Tanlangan ishchining bu filtrlarga mos arizasi yo'q. Filtrlarni tozalab ko'ring."
                      : "Tanlangan filtrlarga mos ariza yo'q. Filtrlarni tozalab ko'ring."}
                </p>
                {filtrBor && (
                  <div className="mt-1">
                    <AsosiyTugma onClick={filtrniTozala}>Filtrlarni tozalash</AsosiyTugma>
                  </div>
                )}
              </div>
            ) : (
              qatorlar.map((a, i) => (
                <ArizaQatori
                  key={a.id}
                  a={a}
                  juft={i % 2 === 1}
                  ustun={ustun}
                  holatSatri={holatSatri}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Sahifalash (Figma: 64 px) ──────────────────────────────── */}
        {!!qatorlar.length && (
          <div className="flex h-16 items-center gap-[10px] px-5">
            <div className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
              {boshi}–{oxiri} / {son(total)} ta ariza
            </div>
            {pages > 1 && (
              <nav className="ml-auto flex items-center gap-[6px]" aria-label="Sahifalar">
                <Sahifa
                  nomi="Oldingi sahifa"
                  ochiq={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} aria-hidden />
                </Sahifa>
                {sahifaRaqamlari(page, pages).map((v, i) =>
                  v === "…" ? (
                    <span
                      key={`bosh-${i}`}
                      aria-hidden
                      className="flex h-9 w-9 items-center justify-center text-[13px] font-medium leading-[18px]"
                      style={{ color: XIRA_QUYUQ }}
                    >
                      …
                    </span>
                  ) : (
                    <Sahifa
                      key={v}
                      nomi={`${v}-sahifa`}
                      joriy={v === page}
                      onClick={() => setPage(v)}
                    >
                      {v}
                    </Sahifa>
                  ),
                )}
                <Sahifa
                  nomi="Keyingi sahifa"
                  ochiq={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  <ChevronRight size={16} aria-hidden />
                </Sahifa>
              </nav>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Sahifalash tugmasi — Figma: 36×36, radius 8. Joriy sahifa ko'k fonda,
 * qolganlari oq fonda 1 px hoshiya bilan.
 *
 * Kengligi `min-w-9`: uch xonali raqam ("268") 36 px ga sig'masdi va
 * Figma'da ham o'sha tugma kengroq (46 px) chizilgan.
 */
function Sahifa({
  nomi,
  joriy,
  ochiq,
  onClick,
  children,
}: {
  nomi: string;
  joriy?: boolean;
  ochiq?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={nomi}
      aria-current={joriy ? "page" : undefined}
      disabled={ochiq}
      onClick={onClick}
      className={`inline-flex h-9 min-w-[36px] select-none items-center justify-center rounded-lg px-[6px] text-[13px] leading-[18px] tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6] ${
        joriy ? "font-semibold text-white" : "font-medium"
      } ${ochiq ? "cursor-not-allowed" : joriy ? "hover:brightness-95" : "bg-white hover:bg-[#f4f6fc]"}`}
      style={
        joriy
          ? { background: KO_K }
          : {
              color: ochiq ? XIRA_QUYUQ : KUL,
              boxShadow: `inset 0 0 0 1px ${ochiq ? HOSHIYA : "#c3c6d7"}`,
            }
      }
    >
      {children}
    </button>
  );
}

/**
 * Jadval qatori.
 *
 * # QAYERGA OLIB BORADI
 *
 * ARIZANING batafsil sahifasiga (Figma 3.6.1). Figma 3.6a · 5 da «qator
 * bosilganda e'lon batafsil sahifasiga o'tadi» deb yozilgan edi — u
 * vaqtinchalik yechim: arizaning o'z sahifasi hali chizilmagan edi.
 * Endi u bor, va e'lon ham shu sahifadan bir bosishda ochiladi. Aksi
 * ishlamaydi: e'lon sahifasi qaysi ariza bosilganini bilmaydi, ya'ni
 * admin ko'rmoqchi bo'lgan yozuv yo'qolib qolardi.
 *
 * # NEGA `<table>` EMAS, `<Link>`
 *
 * Butun qator havola bo'lishi kerak, `<tr>` ni esa havolaga aylantirib
 * bo'lmaydi. `onClick` + `router.push` varianti ko'rinishda ishlardi,
 * lekin: qatorni yangi oynada ochib bo'lmasdi (Ctrl/o'rta tugma),
 * klaviatura bilan yurib bo'lmasdi va ekran o'quvchisi qatorni havola
 * deb e'lon qilmasdi. Shuning uchun qator — haqiqiy `<a>`, ustunlar esa
 * Figma auto-layout'iga mos flex kataklar.
 *
 * # NEGA MANZIL TEKSHIRILADI
 *
 * `id` shakli buzuq bo'lsa (bo'sh, qisqa, begona belgilar) qator havola
 * BO'LMAYDI — oddiy qator bo'lib qoladi. Buzuq identifikatorni manzilga
 * qo'shib yuborish admin bosgan havolani ma'nosiz sahifaga olib
 * borardi.
 */
function ArizaQatori({
  a,
  juft,
  ustun,
  holatSatri,
}: {
  a: ApplicationRow;
  juft: boolean;
  ustun: (px: number) => { width: string };
  /** Joriy filtr/sahifa — batafsil sahifa shu bilan ro'yxatga qaytadi. */
  holatSatri: string;
}) {
  const arizaId = oqOid(String(a.id || ""));
  const holat = arizaHolatKor(a.status);
  const ism = (a.workerName || "").trim();
  const tel = (a.workerPhone || "").trim();
  // Figma 3.6: ism bo'lmasa TELEFON sarlavha bo'ladi, ostida esa "ism
  // ko'rsatilmagan". Ikkinchi qator hech qachon yashirilmaydi — qator
  // balandligi (72 px) barcha qatorlarda bir xil bo'lishi kerak.
  const ishchiNomi = ism || tel || "—";
  const ishchiOsti = ism
    ? tel || "telefon ko'rsatilmagan"
    : tel
      ? "ism ko'rsatilmagan"
      : "ma'lumot yo'q";
  // Kutish chipi FAQAT «Kutilmoqda» arizada va faqat chegaradan keyin
  // (Figma 3.6a · 4) — backend `stale` filtri ham shu shartda ishlaydi.
  const kun = a.status === "pending" ? kutishKunlari(a.appliedAt) : 0;

  const ichi = (
    <>
      <div className="min-w-0 shrink-0 pl-5 pr-3" style={ustun(322)}>
        <div className="truncate text-[14px] font-medium leading-5" style={{ color: IK }}>
          {a.elonTitle || "(sarlavhasiz)"}
        </div>
        <div className="mt-[3px] truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
          {a.categoryName || "turkum ko'rsatilmagan"}
        </div>
      </div>
      <div className="min-w-0 shrink-0 px-3" style={ustun(230)}>
        <div className="truncate text-[14px] font-medium leading-5" style={{ color: IK }}>
          {ishchiNomi}
        </div>
        <div
          className="mt-[3px] truncate text-[12px] leading-4"
          style={{ color: ism ? OCH_KUL : XIRA_QUYUQ }}
        >
          {ishchiOsti}
        </div>
      </div>
      <div className="min-w-0 shrink-0 px-3" style={ustun(184)}>
        {a.isNegotiable ? (
          /* «kelishuv» nishoni — Figma 3.6: fon #eef1fb, radius 6.
             Summa o'rniga son yozib bo'lmaydi: kelishiladigan arizada
             `amount` ma'noga ega emas. */
          <span
            className="inline-flex items-center whitespace-nowrap rounded-[6px] px-[9px] py-[4px] text-[12px] font-medium leading-[17px]"
            style={{ background: AVATAR_FON, color: KUL }}
          >
            kelishuv
          </span>
        ) : (
          <div className="flex items-baseline gap-[4px] whitespace-nowrap">
            <span className="text-[14px] font-semibold leading-5" style={{ color: IK }}>
              {son(a.amount)}
            </span>
            {/* Birlik "so'm / ishchi": bazadagi `amount` — bitta ishchiga
                to'lanadigan summa (`elon.perWorkerAmount`), butun e'lon
                budjeti emas. Figma'da "so'm / kun" yozilgan, lekin
                ekranda ko'rsatilayotgan qiymat kunlik emas — noto'g'ri
                birlikni chizish ma'lumotni buzib ko'rsatardi. */}
            <span className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
              so&apos;m / ishchi
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0 shrink-0 px-3" style={ustun(207)}>
        <ArizaNishoni {...holat} />
      </div>
      <div className="min-w-0 shrink-0 pl-3 pr-5" style={ustun(209)}>
        <div className="whitespace-nowrap text-[13px] leading-[18px]" style={{ color: KUL }}>
          {sanaVaqt(a.appliedAt)}
        </div>
        {kun >= UZOQ_KUTISH_KUN && (
          <div className="mt-1">
            <KutishChipi kun={kun} />
          </div>
        )}
      </div>
    </>
  );

  const asos = `flex h-[72px] items-center ${juft ? "bg-[#f8f9ff]" : "bg-white"} shadow-[inset_0_-1px_0_#eaecf2]`;

  if (!arizaId) {
    return (
      <div className={asos} title="Ariza aniqlanmadi — qator ochilmaydi">
        {ichi}
      </div>
    );
  }
  return (
    /* Hover/fokus: Figma 3.6a · 5 — fon #dce9ff va 2 px ko'k hoshiya.
       Fon ham, hoshiya ham SINF orqali beriladi (inline uslub `hover:`
       ni bosib o'tardi).

       Manzilga joriy filtr va sahifa raqami qo'shiladi: batafsil
       sahifadagi «← Arizalar» AYNI shu ko'rinishga qaytadi, ro'yxatning
       boshiga emas. */
    <Link
      href={`/admin/applications/${encodeURIComponent(arizaId)}${holatSatri ? `?${holatSatri}` : ""}`}
      className={`${asos} outline-none transition-colors hover:bg-[#dce9ff] hover:shadow-[inset_0_0_0_2px_#004ac6] focus-visible:bg-white focus-visible:shadow-[inset_0_0_0_2px_#004ac6]`}
      title={a.elonTitle || undefined}
    >
      {ichi}
    </Link>
  );
}
