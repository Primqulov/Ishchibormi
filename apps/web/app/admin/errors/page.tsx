"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  EyeOff,
  RefreshCw,
  RotateCw,
  Search,
  ShieldOff,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  APIError,
  AdminErrorGroup,
  AdminErrorStats,
  AdminRole,
  PagedErrors,
  XatoHolat,
  api,
  getAdminRole,
} from "@/lib/api";
import {
  DARAJA,
  DARAJA_TARTIBI,
  HOLAT,
  HOLAT_TARTIBI,
  MODUL,
  MODUL_TARTIBI,
} from "@/components/admin/xato";
import { AdminModal } from "@/components/admin/AdminModal";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_OCH,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_FON,
  ORANJ_MATN,
  QIZIL,
  QIZIL_FON,
  QIZIL_HOSHIYA,
  SARLAVHA_FON,
  SOYA,
  XIRA,
  XIRA_QUYUQ,
  YASHIL,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.12 · Xatoliklar — ro'yxat (1440 × 1024)" va
          "3.12.2 · Xatoliklar — turlari, holatlar va ko'rinishlar".

   O'lchamlar Figma'dan: sarlavha kartasi 83, ko'rsatkich kartalari 104
   (5 ta, orasi 12), filtr maydonlari h40 (ustida 12 px yorliq), jadval
   sarlavhasi 46, qator 61 + 1 px chegara (= 62 qadam), sahifada 9 ta
   qator, sahifa raqamlari 30×30.

   # BU EKRANDA NIMA KO'RINADI

   FAQAT dastur o'zi yuzaga keltirgan nosozliklar: panika, bazaga
   ulanmaslik, tashqi xizmatning javob bermasligi, fon jarayonining
   uzilishi, mijoz ilovasidagi kutilmagan istisno. Foydalanuvchining
   xatosi — noto'g'ri parol, bo'sh maydon, muddati o'tgan OTP — bu
   yerga TUSHMAYDI: server 4xx javoblarini umuman qayd etmaydi
   (`internal/errlog/middleware.go` faqat status ≥ 500 ni yozadi).

   Sabab shundaki, aralashtirilgan jurnal ishlamaydi: kuniga minglab
   "parol noto'g'ri" yozuvi orasida bitta `db_unavailable` ko'rinmay
   qoladi. Ro'yxatning qiymati — undagi har bir qator kimningdir
   ishlashini talab qilishida.

   # XAVFSIZLIK QARORLARI

   · Sahifa `RequireRole("moderator")` ostida: superadmin va moderator
     o'qiydi, support ko'rmaydi (yon menyuda ham yo'q). Stack trace va
     endpoint nomlari tizimning ichki tuzilishini ochadi.
   · HOLATNI o'zgartirish — faqat superadmin (`PATCH .../status`) va har
     doim audit logga yoziladi. "E'tiborsiz" — bu nosozlikni ekrandan va
     ogohlantirishlardan olib tashlash tugmasi; shuning uchun u ikki
     bosqichli tasdiq bilan va eng yuqori rolda.
   · Moderator uchun holat nishoni tugma EMAS — oddiy yozuv. 403 ni
     bosishdan keyin ko'rsatish "ruxsat bor" degan yolg'on taassurot
     qoldirardi.
   · Filtr qiymatlari YOPIQ katalogdan yuboriladi (quyidagi DARAJA /
     HOLAT / MODUL). Erkin matn faqat `q` da, u ham serverda 100 belgi
     bilan cheklanadi va regexp uchun ekranlanadi.
   · Har so'rovga tartib raqami beriladi: sekin qaytgan eski javob yangi
     filtr natijasini bosib ketmaydi. Avtoyangilanish oyna ochiq bo'lsa
     TO'XTAYDI — aks holda admin o'qiyotgan qator ostidan almashardi.
   · Jurnalda foydalanuvchi ID'si, so'rov satri, telefon va IP yo'q:
     server yozishdan oldin niqoblaydi (`internal/errlog/scrub.go`).
     Shu sababli bu ekranda "kim" ustuni ham yo'q — faqat "qancha".
   ───────────────────────────────────────────────────────────────────── */

const LIMIT = 9; // Figma: 9 qator × 62 px = 558, jadval kartasi 732.
const ZEBRA = "#f8f9ff";
const AVATAR_KO_K = "#dce9ff";
const YANGILASH_MS = 30_000; // Figma: "Har 30 soniyada yangilanadi".

/**
 * "E'tiborsiz qoldirish" sababining eng kichik uzunligi.
 *
 * Server `minIgnoreReason = 10` (`internal/admin/errors.go`) va qisqasini
 * 400 `reason_required` bilan qaytaradi. Batafsil ekranda ham xuddi shu
 * qiymat — ikkisi ajralib ketmasligi kerak.
 */
const SABAB_ENG_KAM = 10;

const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

/* ── Daraja, holat, modul ──────────────────────────────────────────────
   Katalog `components/admin/xato.ts` da — ro'yxat va batafsil ekran BIR
   XIL guruhni ko'rsatadi, shuning uchun nom va rang bitta manbadan
   olinishi shart. Ilgari bu yerda nusxa turardi va u ajralib ketgan edi:
   ro'yxat `fixing` ni "Tuzatilmoqda", batafsil ekran esa "Bartaraf
   etilmoqda" deb yozardi (Figma 3.12.3 · J to'liq nomlarni talab qiladi). */

/**
 * Holat filtri — Figma 3.12.2 · D. Sukut bo'yicha "Ochiq".
 *
 * Oltita holatning HAMMASI ro'yxatda: "Bartaraf etilmoqda" va "Qayta
 * paydo bo'ldi" ilgari yo'q edi, ya'ni "hozir kim nimani tuzatyapti" va
 * "nima qaytib keldi" degan ikkita eng muhim kesimni ajratib ko'rish
 * imkoni yo'q edi (server bu qiymatlarni allaqachon qabul qiladi —
 * `internal/admin/errors.go` · errFilter).
 */
const HOLAT_FILTRI: { kod: string; nomi: string }[] = [
  { kod: "open", nomi: "Ochiq" },
  { kod: "new", nomi: HOLAT.new.nomi },
  { kod: "watching", nomi: HOLAT.watching.nomi },
  { kod: "fixing", nomi: HOLAT.fixing.nomi },
  { kod: "resolved", nomi: HOLAT.resolved.nomi },
  { kod: "regressed", nomi: HOLAT.regressed.nomi },
  { kod: "ignored", nomi: HOLAT.ignored.nomi },
  { kod: "all", nomi: "Barchasi" },
];

/** Davr filtri. `soat: 0` — "Ixtiyoriy oraliq…", ostida sana maydonlari. */
const DAVR: { kod: string; nomi: string; soat: number }[] = [
  { kod: "1h", nomi: "Oxirgi 1 soat", soat: 1 },
  { kod: "24h", nomi: "Oxirgi 24 soat", soat: 24 },
  { kod: "7d", nomi: "Oxirgi 7 kun", soat: 24 * 7 },
  { kod: "30d", nomi: "Oxirgi 30 kun", soat: 24 * 30 },
  { kod: "custom", nomi: "Ixtiyoriy oraliq…", soat: 0 },
];

type Saralash = "last" | "first" | "count" | "users" | "severity";

/* ── Sukut bo'yicha holat ──────────────────────────────────────────────
   "Filtrni tozalash" AYNAN shu qiymatlarga qaytaradi — bo'sh qiymatlarga
   emas. Bo'shatish "barcha davr, barcha holat" degani bo'lardi, ya'ni
   tozalash filtrni KENGAYTIRIB yuborardi. */
const SUKUT = { q: "", daraja: "", modul: "", holat: "open", davr: "24h", sort: "last" as Saralash };

/* ── Kichik yordamchilar ───────────────────────────────────────────── */

const p2 = (n: number) => String(n).padStart(2, "0");

function son(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function sana(d: Date): string {
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function soat(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** "2026-08-01" (input[type=date]) → "01.08.2026". */
function sanaMatn(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * "3 daqiqa oldin". Faqat MIJOZDA chaqiriladi: jadval qatorlari server
 * tomonida umuman chizilmaydi (ma'lumot fetch bilan keladi), shuning uchun
 * hozirgi vaqt gidratsiya nomuvofiqligiga olib kelmaydi.
 */
function nisbiy(d: Date, hozir: number): string {
  const s = Math.round((hozir - d.getTime()) / 1000);
  if (s < 0) return "hozir";
  if (s < 45) return "hozir";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} daqiqa oldin`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} soat oldin`;
  const kun = Math.round(h / 24);
  if (kun < 31) return `${kun} kun oldin`;
  return sana(d);
}

/** Sahifa raqamlari: 1 · joriy atrofidagi 3 ta · oxirgi, orasida "…". */
function sahifaRoyxati(joriy: number, jami: number): (number | "…")[] {
  if (jami <= 7) return Array.from({ length: jami }, (_, i) => i + 1);
  const s = new Set<number>([1, jami, joriy - 1, joriy, joriy + 1]);
  if (joriy <= 3) {
    s.add(2);
    s.add(3);
  }
  if (joriy >= jami - 2) {
    s.add(jami - 1);
    s.add(jami - 2);
  }
  const raqamlar = [...s].filter((n) => n >= 1 && n <= jami).sort((a, b) => a - b);
  const chiqish: (number | "…")[] = [];
  raqamlar.forEach((n, i) => {
    if (i > 0 && n - raqamlar[i - 1] > 1) chiqish.push("…");
    chiqish.push(n);
  });
  return chiqish;
}

/* ── "Qurilma" ustuni (Figma 3.12.3 · N) ───────────────────────────────
   Server bitta satr yozadi: `lastDevice = "Xiaomi Redmi Note 12 · Android
   14"` (`errlog.DeviceLabel`). Figma esa ikki qator talab qiladi — model
   ustda, OS ostida. Ajratuvchi " · " bo'yicha bo'lamiz va OS'da bo'lishi
   mumkin bo'lgan qo'shimcha nuqtalarni yo'qotmaslik uchun FAQAT birinchi
   bo'lakni kesamiz.

   Qurilma yo'q bo'lsa ikki xil sabab bo'ladi va ular bir xil emas:

   · server tomonidagi nosozlik (Backend, OTP bot) — qurilmaga umuman
     bog'liq emas, Figma buni "Barcha qurilmalar / server tomoni" deb
     yozadi;
   · mijoz ilovasidagi nosozlik, lekin qurilma sarlavhasi kelmagan —
     bu ma'lumot yetishmasligi, "—".

   Ikkovini bir xil ko'rsatish adminni chalg'itardi: birinchisida
   qidiradigan qurilma yo'q, ikkinchisida bor-u, biz bilmaymiz. */
const SERVER_MUHITI = ["Backend", "OTP bot"];

function qurilmaQatorlari(g: AdminErrorGroup): { ust: string; ost: string; xira: boolean } {
  const d = (g.lastDevice ?? "").trim();
  if (d) {
    // Oxirgi ajratuvchi bo'yicha: OS qismida " · " bo'lmaydi, model
    // nomida esa bo'lishi mumkin ("Galaxy A54 · 5G").
    const i = d.lastIndexOf(" · ");
    if (i > 0) return { ust: d.slice(0, i), ost: d.slice(i + 3), xira: false };
    return { ust: d, ost: "", xira: false };
  }
  if (SERVER_MUHITI.includes(g.runtime)) {
    return { ust: "Barcha qurilmalar", ost: "server tomoni", xira: true };
  }
  return { ust: "—", ost: "", xira: true };
}

/** "Sardor Rasulov" → "SR", "@sardor" → "S". Avatar uchun. */
function boshHarflar(s: string): string {
  const b = s
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (b.length === 0) return "?";
  const bir = (x: string) => x[0].toLocaleUpperCase("uz");
  return b.length === 1 ? bir(b[0]) : bir(b[0]) + bir(b[1]);
}

/** Qator ustidagi to'liq izoh — sichqoncha ushlab turilganda. */
function ipucha(g: AdminErrorGroup): string {
  const q = [`${g.ref} · ${g.code}`, g.title];
  if (g.where) q.push(`Joy: ${g.where}`);
  if (g.path) q.push(`Yo'l: ${g.path}`);
  if (g.message) q.push(`Xabar: ${g.message}`);
  if (g.note) q.push(`Izoh: ${g.note}`);
  return q.join("\n");
}

/* ── Xabarchalar (toast) ───────────────────────────────────────────── */

type XabarKor = "ok" | "xato" | "kritik";
type Xabarcha = { id: number; kor: XabarKor; sarlavha: string; matn: string };

const XABAR_RANG: Record<XabarKor, { rang: string; fon: string; hoshiya: string }> = {
  ok: { rang: YASHIL, fon: "#f2fbf6", hoshiya: "#b7e3ca" },
  xato: { rang: QIZIL, fon: QIZIL_FON, hoshiya: QIZIL_HOSHIYA },
  kritik: { rang: QIZIL, fon: QIZIL_FON, hoshiya: QIZIL_HOSHIYA },
};

/* ── Sahifa ────────────────────────────────────────────────────────── */

export default function XatoliklarPage() {
  const [data, setData] = useState<PagedErrors | null>(null);
  const [stat, setStat] = useState<AdminErrorStats | null>(null);
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [xato, setXato] = useState<APIError | null>(null);

  const [q, setQ] = useState(SUKUT.q);
  const [qKech, setQKech] = useState(SUKUT.q); // debounce natijasi
  const [daraja, setDaraja] = useState(SUKUT.daraja);
  const [modul, setModul] = useState(SUKUT.modul);
  const [holat, setHolat] = useState(SUKUT.holat);
  const [davr, setDavr] = useState(SUKUT.davr);
  const [dan, setDan] = useState("");
  const [gacha, setGacha] = useState("");
  const [sort, setSort] = useState<Saralash>(SUKUT.sort);
  /** Vaqt ustuni QAYSI maydonni ko'rsatayotgani — sarlavha yorlig'i shundan. */
  const [vaqtMaydoni, setVaqtMaydoni] = useState<"last" | "first">("last");
  const [page, setPage] = useState(1);
  const [avto, setAvto] = useState(true);

  const [rol, setRol] = useState<AdminRole | null>(null);
  const [hozir, setHozir] = useState(() => Date.now());

  // Oynalar
  const [tanlangan, setTanlangan] = useState<AdminErrorGroup | null>(null);
  const [yangiHolat, setYangiHolat] = useState<XatoHolat>("watching");
  const [izoh, setIzoh] = useState("");
  const [izohXato, setIzohXato] = useState(false);
  const [tasdiq, setTasdiq] = useState(false);
  const [saqlanmoqda, setSaqlanmoqda] = useState(false);

  const [xabarlar, setXabarlar] = useState<Xabarcha[]>([]);
  const xabarRaqami = useRef(0);

  const xabarQosh = useCallback((kor: XabarKor, sarlavha: string, matn: string) => {
    const id = ++xabarRaqami.current;
    setXabarlar((v) => [...v.slice(-2), { id, kor, sarlavha, matn }]);
    // Xabarcha o'zi ketadi; qo'lda yopish ham mumkin.
    window.setTimeout(() => setXabarlar((v) => v.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    setRol(getAdminRole() as AdminRole | null);
  }, []);

  // "3 daqiqa oldin" yozuvlari o'zi yangilanib turadi — sahifa qayta
  // yuklanmasa ham.
  useEffect(() => {
    const t = window.setInterval(() => setHozir(Date.now()), YANGILASH_MS);
    return () => window.clearInterval(t);
  }, []);

  // Qidiruv: har harfda so'rov yubormaymiz.
  useEffect(() => {
    const t = window.setTimeout(() => setQKech(q.trim()), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const superadmin = rol === "superadmin";
  const oynaOchiq = tanlangan !== null;

  const davrMeta = DAVR.find((d) => d.kod === davr) ?? DAVR[1];
  const ixtiyoriy = davrMeta.soat === 0;
  // ISO satrlarni leksikografik solishtirish sana solishtirishga teng.
  const sanaXato = ixtiyoriy && Boolean(dan && gacha && dan > gacha);

  const filtrBor =
    qKech !== SUKUT.q ||
    daraja !== SUKUT.daraja ||
    modul !== SUKUT.modul ||
    holat !== SUKUT.holat ||
    davr !== SUKUT.davr;

  /** Ro'yxat va ko'rsatkichlar uchun umumiy so'rov qatori. */
  const parametrlar = useCallback((): URLSearchParams => {
    const p = new URLSearchParams({
      page: String(Math.max(1, Math.floor(page))),
      limit: String(LIMIT),
      status: holat,
      sort,
    });
    if (qKech) p.set("q", qKech);
    if (daraja) p.set("severity", daraja);
    if (modul) p.set("module", modul);
    if (ixtiyoriy) {
      if (dan) {
        const d = new Date(`${dan}T00:00:00`);
        if (!Number.isNaN(d.getTime())) p.set("from", d.toISOString());
      }
      if (gacha) {
        // Kun OXIRIGACHA: aks holda "28.08" tanlagan admin o'sha kunning
        // xatoliklarini umuman ko'rmasdi.
        const d = new Date(`${gacha}T23:59:59.999`);
        if (!Number.isNaN(d.getTime())) p.set("to", d.toISOString());
      }
    } else {
      p.set("from", new Date(Date.now() - davrMeta.soat * 3600_000).toISOString());
    }
    return p;
  }, [page, holat, sort, qKech, daraja, modul, ixtiyoriy, dan, gacha, davrMeta.soat]);

  const soravRaqami = useRef(0);
  // Ko'rilgan kritik guruhlar — takroriy xabarcha chiqmasligi uchun.
  const korilgan = useRef<Set<string>>(new Set());
  const birinchi = useRef(true);

  const load = useCallback(
    async (jim = false) => {
      if (sanaXato) return;
      const men = ++soravRaqami.current;
      if (!jim) setYuklanmoqda(true);
      try {
        const res = await api.get<PagedErrors>(
          `/api/admin/errors?${parametrlar().toString()}`,
          { auth: "admin" } as any,
        );
        if (men !== soravRaqami.current) return;
        setData(res);
        setXato(null);

        // Yangi KRITIK xatolik — Figma 3.12.2 · F uchinchi xabarchasi.
        //
        // Faqat AVTOYANGILANISHDA (`jim`) e'lon qilinadi. Filtr yoki sahifa
        // almashganda ham chiqarsak, "Holat: Barchasi" ni tanlagan admin
        // bir yillik eski kritiklar uchun "hozir qayd etildi" degan xabarni
        // olardi — bu jurnalning eng muhim signalini yolg'onga aylantiradi.
        // Ko'rilganlar to'plami esa har doim to'ldiriladi: admin ko'zi bilan
        // ko'rgan qator keyin "yangi" bo'lib qichqirmasligi kerak.
        const yangilar = (res.items ?? []).filter(
          (g) => g.severity === "critical" && g.status === "new" && !korilgan.current.has(g.id),
        );
        (res.items ?? []).forEach((g) => korilgan.current.add(g.id));
        if (jim && !birinchi.current && yangilar.length > 0) {
          const g = yangilar[0];
          const qoshimcha = yangilar.length > 1 ? ` (+${yangilar.length - 1})` : "";
          xabarQosh(
            "kritik",
            "Yangi kritik xatolik qayd etildi",
            `${g.title} · ${nisbiy(new Date(g.lastSeenAt), Date.now())}${qoshimcha}`,
          );
        }
        birinchi.current = false;
      } catch (e) {
        if (men !== soravRaqami.current) return;
        setData(null);
        setXato((e as APIError) ?? null);
      } finally {
        if (men === soravRaqami.current) setYuklanmoqda(false);
      }
    },
    [parametrlar, sanaXato, xabarQosh],
  );

  /**
   * Ko'rsatkichlar filtrdan MUSTAQIL, shuning uchun alohida so'rov va
   * alohida xato ishlovi: agregatsiya yiqilsa jadval baribir ko'rinadi.
   */
  const statYukla = useCallback(async () => {
    try {
      const res = await api.get<AdminErrorStats>("/api/admin/errors/stats", {
        auth: "admin",
      } as any);
      setStat(res);
    } catch {
      setStat(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    statYukla();
  }, [statYukla]);

  // Filtr o'zgarsa — birinchi sahifaga.
  useEffect(() => {
    setPage(1);
  }, [qKech, daraja, modul, holat, davr, dan, gacha, sort]);

  // Avtoyangilanish. Oyna ochiq bo'lsa yoki tab ko'rinmasa — to'xtaydi:
  // ochiq oyna ostidan qator almashishi ham chalg'itadi, ham "boshqa
  // xatolikning holatini o'zgartirib qo'yish" xavfini tug'diradi.
  useEffect(() => {
    if (!avto || oynaOchiq || xato) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load(true);
      statYukla();
    }, YANGILASH_MS);
    return () => window.clearInterval(t);
  }, [avto, oynaOchiq, xato, load, statYukla]);

  const total = data?.total ?? 0;
  const hodisalar = data?.events ?? 0;
  const sahifalar = Math.max(1, Math.ceil(total / LIMIT));
  const qatorlar = data?.items ?? [];
  const boshi = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const oxiri = Math.min(page * LIMIT, total);

  const tozala = useCallback(() => {
    setQ(SUKUT.q);
    setQKech(SUKUT.q);
    setDaraja(SUKUT.daraja);
    setModul(SUKUT.modul);
    setHolat(SUKUT.holat);
    setDavr(SUKUT.davr);
    setDan("");
    setGacha("");
    setSort(SUKUT.sort);
    setVaqtMaydoni("last");
    setPage(1);
  }, []);

  const karta: React.CSSProperties = useMemo(
    () => ({ boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` }),
    [],
  );
  const maydonHoshiya = (xatoli?: boolean): React.CSSProperties => ({
    boxShadow: `inset 0 0 0 ${xatoli ? 1.5 : 1}px ${xatoli ? QIZIL_HOSHIYA : HOSHIYA_QUYUQ}`,
    color: IK,
  });

  const ruxsatYoq = xato?.code === "forbidden";

  /* ── Holatni o'zgartirish ──────────────────────────────────────── */

  const oynaniOch = useCallback((g: AdminErrorGroup) => {
    setTanlangan(g);
    // Sukut bo'yicha "mantiqiy keyingi qadam": yangi → kuzatilmoqda,
    // kuzatilmoqda → hal qilindi. Hech qachon "e'tiborsiz" emas.
    setYangiHolat(g.status === "new" ? "watching" : g.status === "watching" ? "resolved" : g.status);
    setIzoh(g.note ?? "");
    setIzohXato(false);
    setTasdiq(false);
  }, []);

  const oynaniYop = useCallback(() => {
    if (saqlanmoqda) return;
    setTanlangan(null);
    setTasdiq(false);
  }, [saqlanmoqda]);

  const saqla = useCallback(async () => {
    const g = tanlangan;
    if (!g) return;
    const t = izoh.trim();
    // "E'tiborsiz" — ikki bosqichli: sabab MAJBURIY, keyin tasdiq oynasi.
    // Uzunlik serverdagi `minIgnoreReason` bilan bir xil, aks holda admin
    // yozganini yo'qotib, xatoni faqat yuborgandan keyin ko'rardi.
    if (yangiHolat === "ignored") {
      if (t.length < SABAB_ENG_KAM) {
        setIzohXato(true);
        setTasdiq(false);
        return;
      }
      if (!tasdiq) {
        setTasdiq(true);
        return;
      }
    }
    setSaqlanmoqda(true);
    try {
      // `note` va `reason` — SERVERDA ikki xil maydon: birinchisi
      // ro'yxatda ko'rinadigan izoh, ikkinchisi e'tiborsiz qoldirishning
      // majburiy sababi. `ignored` ga `note` yuborilsa, server uni
      // 400 `reason_required` bilan qaytaradi.
      await api.patch(
        `/api/admin/errors/${encodeURIComponent(g.id)}/status`,
        yangiHolat === "ignored"
          ? { status: yangiHolat, reason: t }
          : { status: yangiHolat, note: t },
        { auth: "admin" } as any,
      );
      const izohlar: Record<XatoHolat, string> = {
        new: "yana ro'yxat boshiga qaytdi",
        watching: "kuzatuvga olindi",
        fixing: "mas'ul admin ish boshladi",
        resolved: "7 kun kuzatuvda qoladi",
        regressed: "tizim belgisi — qo'lda qo'yilmaydi",
        ignored: "ogohlantirishlar yuborilmaydi",
      };
      xabarQosh(
        "ok",
        `Xatolik «${HOLAT[yangiHolat].nomi}» deb belgilandi`,
        `${g.ref} · ${izohlar[yangiHolat]}`,
      );
      setTanlangan(null);
      setTasdiq(false);
      load(true);
      statYukla();
    } catch (e) {
      const err = e as APIError | undefined;
      xabarQosh(
        "xato",
        "Amalni bajarib bo'lmadi",
        err?.code === "forbidden"
          ? "Faqat superadmin holatni o'zgartira oladi."
          : err?.code === "reason_required"
            ? `Sabab kamida ${SABAB_ENG_KAM} belgi bo'lishi kerak.`
            : err?.message || "Server javob bermadi. Qayta urinib ko'ring.",
      );
      setTasdiq(false);
    } finally {
      setSaqlanmoqda(false);
    }
  }, [tanlangan, yangiHolat, tasdiq, izoh, xabarQosh, load, statYukla]);

  /** Vaqt ustuni sarlavhasi: bosilganda avval sortga o'tadi, keyin almashadi. */
  const vaqtSarlavhasi = () => {
    if (sort !== vaqtMaydoni) {
      setSort(vaqtMaydoni);
      return;
    }
    const keyingi = vaqtMaydoni === "last" ? "first" : "last";
    setVaqtMaydoni(keyingi);
    setSort(keyingi);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha kartasi ───────────────────────────────────────── */}
      <div
        className="flex h-[83px] items-center gap-[14px] rounded-2xl bg-white px-5"
        style={karta}
      >
        <span
          aria-hidden
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]"
          style={{ background: AVATAR_KO_K }}
        >
          <TriangleAlert size={18} color={KO_K} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-6" style={{ color: IK }}>
            Xatoliklar
          </h1>
          <p className="mt-[2px] truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
            Dastur tomonidan yuzaga kelgan xatoliklar va hodisalar oqimi
          </p>
        </div>
        {/* Figma'da bu yozuv statik. Tugmaga aylantirildi: stack trace o'qib
            turgan admin ostidan jadval almashib ketmasligi kerak. */}
        <button
          type="button"
          onClick={() => setAvto((v) => !v)}
          aria-pressed={avto}
          className={`ml-auto inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-full px-[11px] transition-colors hover:brightness-95 ${FOKUS}`}
          style={{ background: avto ? AVATAR_FON : "#fff", boxShadow: avto ? undefined : `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
          title={avto ? "Avtoyangilanishni to'xtatish" : "Avtoyangilanishni yoqish"}
        >
          <RefreshCw
            size={13}
            color={avto ? KO_K : OCH_KUL}
            aria-hidden
            className={avto && yuklanmoqda ? "animate-spin" : undefined}
          />
          <span
            className="whitespace-nowrap text-[12px] leading-4"
            style={{ color: avto ? KUL : OCH_KUL }}
          >
            {avto ? "Har 30 soniyada yangilanadi" : "Avtoyangilanish o'chirilgan"}
          </span>
        </button>
      </div>

      {/* ── Ko'rsatkichlar ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Korsatkich
          yorliq="Ochiq xatoliklar"
          qiymat={stat?.open}
          rang={stat && stat.open === 0 ? YASHIL : QIZIL}
          uslub={karta}
        />
        <Korsatkich
          yorliq="Kritik (hal etilmagan)"
          qiymat={stat?.critical}
          rang={stat && stat.critical === 0 ? YASHIL : QIZIL}
          uslub={karta}
        />
        <Korsatkich
          yorliq="Hodisalar · 24 soat"
          qiymat={stat?.events24h}
          rang={IK}
          uslub={karta}
        />
        <Korsatkich
          yorliq="Ta'sirlangan foydalanuvchi"
          qiymat={stat?.users24h}
          rang={KO_K}
          uslub={karta}
        />
        <Korsatkich
          yorliq="Hal qilindi · 7 kun"
          qiymat={stat?.resolved7d}
          rang={YASHIL}
          uslub={karta}
        />
      </div>

      {/* ── Filtr + jadval kartasi ─────────────────────────────────── */}
      <div className="overflow-hidden rounded-[14px] bg-white" style={karta}>
        <div className="flex flex-wrap items-end gap-3 px-5 pb-[15px] pt-[15px]">
          {/* Qidiruv */}
          <div className="w-[250px] min-w-[190px] flex-shrink-0">
            <label
              htmlFor="xato-q"
              className="mb-[6px] block text-[12px] leading-4"
              style={{ color: OCH_KUL }}
            >
              Qidiruv
            </label>
            <div className="relative">
              <Search
                size={15}
                color={qKech ? KO_K : OCH_KUL}
                aria-hidden
                className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2"
              />
              <input
                id="xato-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={100}
                placeholder="Xabar, kod yoki endpoint…"
                className={`h-10 w-full rounded-[10px] bg-white pl-[34px] pr-[12px] text-[13px] leading-[18px] outline-none placeholder:text-[#9aa0b0] ${FOKUS}`}
                style={maydonHoshiya()}
              />
            </div>
          </div>

          <Tanlov
            id="xato-daraja"
            nomi="Muhimlik"
            kenglik="w-[144px] min-w-[128px]"
            qiymat={daraja}
            ozgardi={setDaraja}
            uslub={maydonHoshiya()}
            variantlar={[
              { kod: "", nomi: "Barchasi" },
              ...DARAJA_TARTIBI.map((d) => ({ kod: d, nomi: DARAJA[d].nomi })),
            ]}
          />
          <Tanlov
            id="xato-modul"
            nomi="Manba"
            kenglik="w-[164px] min-w-[148px]"
            qiymat={modul}
            ozgardi={setModul}
            uslub={maydonHoshiya()}
            variantlar={[
              { kod: "", nomi: "Barcha modullar" },
              ...MODUL_TARTIBI.map((m) => ({ kod: m, nomi: MODUL[m] })),
            ]}
          />
          <Tanlov
            id="xato-holat"
            nomi="Holat"
            kenglik="w-[144px] min-w-[128px]"
            qiymat={holat}
            ozgardi={setHolat}
            uslub={maydonHoshiya()}
            variantlar={HOLAT_FILTRI}
          />
          <Tanlov
            id="xato-davr"
            nomi="Davr"
            kenglik="w-[150px] min-w-[134px]"
            qiymat={davr}
            ozgardi={setDavr}
            uslub={maydonHoshiya(sanaXato)}
            variantlar={DAVR.map((d) => ({ kod: d.kod, nomi: d.nomi }))}
          />

          {/* Natija — Figma'dagi o'ng blok. Filtrlangan to'plam bo'yicha. */}
          <div className="ml-auto w-[147px] min-w-[130px] flex-shrink-0 text-right">
            <div className="mb-[6px] text-[12px] leading-4" style={{ color: OCH_KUL }}>
              Natija
            </div>
            <div
              className="flex h-10 items-center justify-end text-[13px] font-semibold leading-[18px]"
              style={{ color: IK }}
            >
              {data ? `${son(total)} guruh · ${son(hodisalar)} hodisa` : "—"}
            </div>
          </div>
        </div>

        {/* Ixtiyoriy oraliq — Figma "Ixtiyoriy oraliq…" tanlangandagina.
            Birinchi qatorning o'lchamlari buzilmasin. */}
        {ixtiyoriy && (
          <div className="flex flex-wrap items-end gap-3 px-5 pb-[15px]">
            <SanaMaydon
              id="xato-dan"
              nomi="Dan"
              qiymat={dan}
              ozgardi={setDan}
              xatoli={sanaXato}
              uslub={maydonHoshiya(sanaXato)}
            />
            <SanaMaydon
              id="xato-gacha"
              nomi="Gacha"
              qiymat={gacha}
              ozgardi={setGacha}
              xatoli={sanaXato}
              uslub={maydonHoshiya(sanaXato)}
            />
            {(dan || gacha) && (
              <span
                className="pb-[11px] text-[13px] leading-[18px]"
                style={{ color: OCH_KUL }}
              >
                {dan && gacha
                  ? `${sanaMatn(dan)} — ${sanaMatn(gacha)}`
                  : dan
                    ? `${sanaMatn(dan)} dan`
                    : `${sanaMatn(gacha)} gacha`}
              </span>
            )}
          </div>
        )}

        {sanaXato && (
          <div className="px-5 pb-[15px]">
            <div
              role="alert"
              className="inline-flex items-center gap-[8px] rounded-[9px] px-3 py-[9px]"
              style={{ background: QIZIL_FON, boxShadow: `inset 0 0 0 1px ${QIZIL_HOSHIYA}` }}
            >
              <CircleAlert size={15} color={QIZIL} aria-hidden />
              <span className="text-[13px] leading-[18px]" style={{ color: QIZIL }}>
                Sana oralig&apos;i noto&apos;g&apos;ri — «Dan» «Gacha»dan keyin turibdi.
              </span>
            </div>
          </div>
        )}

        <div className="h-px" style={{ background: HOSHIYA }} />

        {/* ── Jadval ───────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] table-fixed border-collapse text-[14px]">
            <colgroup>
              {/* Figma ustun kengliklari. Uchta yangi ustun qo'shilgach
                  (Qurilma · Ilova versiyasi · Mas'ul — 3.12.3 · N) jami
                  1480 px bo'ldi: jadval endi 1380 px dan pastda gorizontal
                  suriladi, siqilib o'qib bo'lmaydigan holga kelmaydi. */}
              {[320, 156, 112, 140, 112, 96, 112, 140, 152, 140].map((w, i) => (
                <col key={i} style={{ width: `${(w / 1480) * 100}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: SARLAVHA_FON }}>
                <th className="h-[46px] pl-5 pr-3 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Xatolik
                </th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Qurilma
                </th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Ilova versiyasi
                </th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Manba
                </th>
                <SarlavhaTugma
                  nomi="Muhimlik"
                  faol={sort === "severity"}
                  bosildi={() => setSort("severity")}
                />
                <SarlavhaTugma
                  nomi="Hodisalar"
                  ongga
                  faol={sort === "count"}
                  bosildi={() => setSort("count")}
                />
                <SarlavhaTugma
                  nomi="Foydalanuvchi"
                  ongga
                  faol={sort === "users"}
                  bosildi={() => setSort("users")}
                />
                {/* Ikki holatli: "Oxirgi marta" ↔ "Birinchi marta". Yorliq
                    HAR DOIM katakda nima turganini aytadi (Figma 3.12.2 · D
                    beshta saralashni talab qiladi, filtr yo'lagida esa
                    oltinchi maydon uchun joy yo'q). */}
                <SarlavhaTugma
                  nomi={vaqtMaydoni === "first" ? "Birinchi marta" : "Oxirgi marta"}
                  faol={sort === "last" || sort === "first"}
                  bosildi={vaqtSarlavhasi}
                />
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Holat
                </th>
                <th className="px-3 pr-5 text-left text-[12px] font-semibold leading-4" style={{ color: KUL }}>
                  Mas&apos;ul
                </th>
              </tr>
            </thead>
            <tbody>
              {/* `yuklanmoqda` faqat OCHIQ yuklashda yoqiladi (`load(false)`).
                  Avtoyangilanish `load(true)` bilan ketadi va skeletni
                  chiqarmaydi — har 30 soniyada jadval o'chib-yonishi
                  o'qishning imkonini bermasdi. */}
              {yuklanmoqda ? (
                Array.from({ length: LIMIT }).map((_, i) => (
                  <tr
                    key={`skelet-${i}`}
                    className="border-b last:border-b-0"
                    style={{ borderColor: HOSHIYA, background: i % 2 ? ZEBRA : "#fff" }}
                  >
                    {[200, 96, 64, 96, 60, 40, 40, 90, 84, 70].map((w, j) => (
                      <td
                        key={j}
                        className={`h-[61px] ${j === 0 ? "pl-5 pr-3" : j === 9 ? "px-3 pr-5" : "px-3"}`}
                      >
                        <span
                          className="block h-[10px] animate-pulse rounded-full"
                          style={{
                            width: w,
                            maxWidth: "100%",
                            background: HOSHIYA_OCH,
                            marginLeft: j === 5 || j === 6 ? "auto" : undefined,
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : xato ? (
                <tr>
                  <td colSpan={10} className="px-5 py-[46px]">
                    <Holat
                      ikon={
                        ruxsatYoq ? (
                          <ShieldOff size={34} color={XIRA} aria-hidden />
                        ) : (
                          <CircleAlert size={34} color={QIZIL} aria-hidden />
                        )
                      }
                      sarlavha={ruxsatYoq ? "Ruxsat yo'q" : "Ma'lumotni yuklab bo'lmadi"}
                      sarlavhaRang={ruxsatYoq ? IK : QIZIL}
                      tavsif={
                        ruxsatYoq
                          ? "Xatoliklar jurnali faqat superadmin va moderator uchun ochiq."
                          : xato.message ||
                            "Server javob bermadi yoki tarmoq uzildi. Qaytadan urinib ko'ring."
                      }
                      amal={
                        ruxsatYoq ? null : (
                          <button
                            type="button"
                            onClick={() => load()}
                            className={tugma("asosiy").className}
                            style={{ ...tugma("asosiy").style, height: 38 }}
                          >
                            <RotateCw size={15} aria-hidden />
                            Qayta urinish
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : qatorlar.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-[46px]">
                    <Holat
                      ikon={<CircleCheck size={34} color={YASHIL} aria-hidden />}
                      sarlavha="Xatolik topilmadi"
                      sarlavhaRang={IK}
                      tavsif={
                        filtrBor
                          ? "Tanlangan filtr bo'yicha bironta ham xatolik yo'q. Bu yaxshi belgi — dastur barqaror ishlayapti."
                          : "Oxirgi 24 soatda bironta ham xatolik qayd etilmadi. Bu yaxshi belgi — dastur barqaror ishlayapti."
                      }
                      amal={
                        filtrBor ? (
                          <button
                            type="button"
                            onClick={tozala}
                            className={tugma("ikkilamchi").className}
                            style={{ ...tugma("ikkilamchi").style, height: 38 }}
                          >
                            <X size={15} aria-hidden />
                            Filtrni tozalash
                          </button>
                        ) : null
                      }
                    />
                  </td>
                </tr>
              ) : (
                qatorlar.map((g, i) => (
                  <Qator
                    key={g.id}
                    g={g}
                    juft={i % 2 === 1}
                    hozir={hozir}
                    maydon={vaqtMaydoni}
                    ozgartirsaBoladi={superadmin}
                    bosildi={() => oynaniOch(g)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pastki yo'lak ────────────────────────────────────────── */}
        {(qatorlar.length > 0 || (yuklanmoqda && data !== null)) && (
          <>
            <div className="h-px" style={{ background: HOSHIYA }} />
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-[13px]">
              <span className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
                {boshi}–{oxiri} / {son(total)} ta guruh · sahifada {LIMIT} tadan
              </span>
              {sahifalar > 1 && (
                <nav className="flex items-center gap-[6px]" aria-label="Sahifalar">
                  <SahifaTugma
                    belgi={<ChevronLeft size={15} aria-hidden />}
                    nomi="Oldingi sahifa"
                    ochiq={page <= 1}
                    bosildi={() => setPage((v) => Math.max(1, v - 1))}
                  />
                  {sahifaRoyxati(page, sahifalar).map((n, i) =>
                    n === "…" ? (
                      <span
                        key={`uch-nuqta-${i}`}
                        aria-hidden
                        className="grid h-[30px] w-[30px] place-items-center text-[13px]"
                        style={{ color: XIRA_QUYUQ }}
                      >
                        …
                      </span>
                    ) : (
                      <SahifaTugma
                        key={n}
                        belgi={n}
                        nomi={`${n}-sahifa`}
                        faol={n === page}
                        bosildi={() => setPage(n)}
                      />
                    ),
                  )}
                  <SahifaTugma
                    belgi={<ChevronRight size={15} aria-hidden />}
                    nomi="Keyingi sahifa"
                    ochiq={page >= sahifalar}
                    bosildi={() => setPage((v) => Math.min(sahifalar, v + 1))}
                  />
                </nav>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Oyna: holatni o'zgartirish ─────────────────────────────── */}
      <AdminModal
        open={tanlangan !== null && !tasdiq}
        onClose={oynaniYop}
        title="Holatni o'zgartirish"
        maxWidth="max-w-[435px]"
        footer={
          <>
            <button
              type="button"
              onClick={oynaniYop}
              disabled={saqlanmoqda}
              className={tugma("ikkilamchi", { ochiq: saqlanmoqda }).className}
              style={tugma("ikkilamchi", { ochiq: saqlanmoqda }).style}
            >
              Bekor qilish
            </button>
            <button
              type="button"
              onClick={saqla}
              disabled={saqlanmoqda || !tanlangan || yangiHolat === tanlangan.status}
              className={
                tugma("asosiy", {
                  ochiq: saqlanmoqda || !tanlangan || yangiHolat === tanlangan.status,
                }).className
              }
              style={
                tugma("asosiy", {
                  ochiq: saqlanmoqda || !tanlangan || yangiHolat === tanlangan.status,
                }).style
              }
            >
              {saqlanmoqda ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </>
        }
      >
        {tanlangan && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[14px] font-semibold leading-[19px]" style={{ color: IK }}>
                {tanlangan.title}
              </div>
              <div className="mt-[3px] text-[12px] leading-4" style={{ color: OCH_KUL }}>
                {tanlangan.ref} · {tanlangan.code} · {MODUL[tanlangan.module] ?? tanlangan.module}
              </div>
            </div>

            <div>
              <div className="mb-[8px] text-[12px] leading-4" style={{ color: OCH_KUL }}>
                Yangi holat
              </div>
              <div className="flex flex-wrap gap-2">
                {HOLAT_TARTIBI.map((h) => {
                  const meta = HOLAT[h];
                  const tanlandi = yangiHolat === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setYangiHolat(h)}
                      aria-pressed={tanlandi}
                      className={`inline-flex h-8 items-center gap-[6px] rounded-full px-[12px] text-[13px] font-medium transition-colors ${FOKUS}`}
                      style={{
                        color: tanlandi ? "#fff" : (meta.matn ?? meta.rang),
                        background: tanlandi ? meta.rang : "#fff",
                        boxShadow: tanlandi ? undefined : `inset 0 0 0 1px ${meta.rang}`,
                      }}
                    >
                      {tanlandi && <Check size={14} aria-hidden />}
                      {meta.nomi}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="xato-izoh"
                className="mb-[6px] block text-[12px] leading-4"
                style={{ color: OCH_KUL }}
              >
                {yangiHolat === "ignored" ? "Sabab (majburiy)" : "Izoh (ixtiyoriy)"}
              </label>
              <textarea
                id="xato-izoh"
                value={izoh}
                onChange={(e) => {
                  setIzoh(e.target.value);
                  if (izohXato) setIzohXato(false);
                }}
                maxLength={500}
                rows={3}
                placeholder={
                  yangiHolat === "ignored"
                    ? `Masalan: uchinchi tomon SDK'sining ma'lum nuqsoni, bizga bog'liq emas (kamida ${SABAB_ENG_KAM} belgi)`
                    : "Masalan: 1.4.3 versiyada tuzatildi — javob null bo'lganda tekshiruv qo'shildi."
                }
                className={`w-full resize-none rounded-[10px] bg-white px-3 py-[10px] text-[13px] leading-[18px] outline-none placeholder:text-[#9aa0b0] ${FOKUS}`}
                style={maydonHoshiya(izohXato)}
              />
              {izohXato && (
                <span className="mt-[5px] block text-[12px] leading-4" style={{ color: QIZIL }}>
                  Sabab kamida {SABAB_ENG_KAM} belgi bo&apos;lishi kerak — keyin bu qarorni hech kim
                  tushuntira olmaydi.
                </span>
              )}
            </div>

            {/* Amal audit logga yozilishini oldindan aytamiz — bosgandan
                keyin emas. */}
            <p className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
              Holat o&apos;zgarishi audit logga yoziladi.
            </p>
          </div>
        )}
      </AdminModal>

      {/* ── Oyna: e'tiborsiz qoldirish tasdig'i ────────────────────── */}
      <AdminModal
        open={tasdiq && tanlangan !== null}
        onClose={() => (saqlanmoqda ? undefined : setTasdiq(false))}
        title="E'tiborsiz qoldirasizmi?"
        maxWidth="max-w-[435px]"
        footer={
          <>
            <button
              type="button"
              onClick={() => setTasdiq(false)}
              disabled={saqlanmoqda}
              className={tugma("ikkilamchi", { ochiq: saqlanmoqda }).className}
              style={tugma("ikkilamchi", { ochiq: saqlanmoqda }).style}
            >
              Bekor qilish
            </button>
            <button
              type="button"
              onClick={saqla}
              disabled={saqlanmoqda}
              className={tugma("xavf", { ochiq: saqlanmoqda }).className}
              style={tugma("xavf", { ochiq: saqlanmoqda }).style}
            >
              <EyeOff size={15} aria-hidden />
              {saqlanmoqda ? "Bajarilmoqda…" : "E'tiborsiz qoldirish"}
            </button>
          </>
        }
      >
        {tanlangan && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-[19px]" style={{ color: KUL }}>
              «{tanlangan.title}» ({tanlangan.ref}) ro&apos;yxatning ochiq qismidan
              chiqadi va bu xatolik bo&apos;yicha ogohlantirish yuborilmaydi. Xatolik
              o&apos;zi yo&apos;qolmaydi — hodisalar yozilishda davom etadi.
            </p>
            {/* Ogohlantirish qutisi — panelning boshqa ekranlaridagi bilan
                bir xil: ORANJ_FON, hoshiyasiz, 16 px ikon, 13/18 matn
                (users, admins, notifications). */}
            <div
              role="note"
              className="flex gap-[10px] rounded-[10px] px-[13px] py-[7px]"
              style={{ background: ORANJ_FON }}
            >
              <TriangleAlert
                size={16}
                aria-hidden
                className="mt-[2px] shrink-0"
                style={{ color: ORANJ }}
              />
              <p className="text-[13px] font-semibold leading-[18px]" style={{ color: ORANJ_MATN }}>
                Faqat superadmin bu amalni bajara oladi. Amal audit logga yoziladi.
              </p>
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Xabarchalar ────────────────────────────────────────────── */}
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
                <div className="mt-[2px] break-words text-[12px] leading-4" style={{ color: OCH_KUL }}>
                  {x.matn}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setXabarlar((v) => v.filter((y) => y.id !== x.id))}
                aria-label="Xabarchani yopish"
                className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-md transition-opacity hover:opacity-60 ${FOKUS}`}
              >
                <X size={13} color={OCH_KUL} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Bo'laklar ─────────────────────────────────────────────────────── */

function Korsatkich({
  yorliq,
  qiymat,
  rang,
  uslub,
}: {
  yorliq: string;
  qiymat?: number;
  rang: string;
  uslub: React.CSSProperties;
}) {
  return (
    <div className="h-[104px] rounded-[14px] bg-white px-[18px] pt-[21px]" style={uslub}>
      <div className="truncate text-[12px] leading-4" style={{ color: OCH_KUL }} title={yorliq}>
        {yorliq}
      </div>
      {qiymat === undefined ? (
        <span
          className="mt-[16px] block h-[18px] w-[64px] animate-pulse rounded-full"
          style={{ background: HOSHIYA_OCH }}
        />
      ) : (
        <div className="mt-[6px] text-[28px] font-bold leading-[40px]" style={{ color: rang }}>
          {son(qiymat)}
        </div>
      )}
    </div>
  );
}

function Tanlov({
  id,
  nomi,
  kenglik,
  qiymat,
  ozgardi,
  uslub,
  variantlar,
}: {
  id: string;
  nomi: string;
  kenglik: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  uslub: React.CSSProperties;
  variantlar: { kod: string; nomi: string }[];
}) {
  return (
    <div className={`${kenglik} flex-shrink-0`}>
      <label htmlFor={id} className="mb-[6px] block text-[12px] leading-4" style={{ color: OCH_KUL }}>
        {nomi}
      </label>
      <div className="relative">
        <select
          id={id}
          value={qiymat}
          onChange={(e) => ozgardi(e.target.value)}
          className={`h-10 w-full appearance-none rounded-[10px] bg-white pl-[12px] pr-[30px] text-[13px] leading-[18px] outline-none ${FOKUS}`}
          style={uslub}
        >
          {variantlar.map((v) => (
            <option key={v.kod} value={v.kod}>
              {v.nomi}
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          color={OCH_KUL}
          aria-hidden
          className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
}

function SanaMaydon({
  id,
  nomi,
  qiymat,
  ozgardi,
  xatoli,
  uslub,
}: {
  id: string;
  nomi: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  xatoli: boolean;
  uslub: React.CSSProperties;
}) {
  // O'lchamlari "3.11 · Audit log" dagi bilan bir xil: ikkala ekranda ham
  // bu aynan bitta boshqaruv elementi.
  return (
    <div className="w-[180px] min-w-[150px] flex-shrink-0">
      <label htmlFor={id} className="mb-[6px] block text-[12px] leading-4" style={{ color: OCH_KUL }}>
        {nomi}
      </label>
      <div className="relative">
        <CalendarDays
          size={15}
          color={xatoli ? QIZIL : qiymat ? KO_K : OCH_KUL}
          aria-hidden
          className="pointer-events-none absolute left-[11px] top-1/2 z-[1] -translate-y-1/2"
        />
        {/* Brauzerning o'z kalendar belgisi shaffof qilinib butun maydonni
            qoplaydi: chapdagi ikonka Figma'dagidek qoladi, bosilganda esa
            baribir tizim kalendari ochiladi. */}
        <input
          id={id}
          type="date"
          value={qiymat}
          onChange={(e) => ozgardi(e.target.value)}
          aria-invalid={xatoli || undefined}
          className={`h-10 w-full rounded-[10px] bg-white pl-[34px] pr-[12px] text-[13px] leading-[18px] outline-none ${FOKUS} [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`}
          style={uslub}
        />
      </div>
    </div>
  );
}

/** Saralanadigan ustun sarlavhasi. Faol ustunda pastga qaragan strelka. */
function SarlavhaTugma({
  nomi,
  ongga,
  faol,
  bosildi,
}: {
  nomi: string;
  ongga?: boolean;
  faol: boolean;
  bosildi: () => void;
}) {
  return (
    <th className="px-3" aria-sort={faol ? "descending" : "none"}>
      <button
        type="button"
        onClick={bosildi}
        className={`inline-flex w-full items-center gap-[5px] whitespace-nowrap text-[12px] font-semibold leading-4 transition-colors hover:opacity-70 ${
          ongga ? "justify-end" : "justify-start"
        } ${FOKUS}`}
        style={{ color: faol ? KO_K : KUL }}
        title={`«${nomi}» bo'yicha saralash`}
      >
        {nomi}
        <ArrowDown size={12} aria-hidden style={{ opacity: faol ? 1 : 0.28 }} />
      </button>
    </th>
  );
}

/** Daraja/holat nishoni: shaffof fon, 1 px aksent hoshiya, 12 px matn. */
function Nishon({
  nomi,
  rang,
  matn,
  nuqta,
}: {
  nomi: string;
  rang: string;
  matn?: string;
  nuqta?: boolean;
}) {
  return (
    <span
      className="inline-flex h-[21px] max-w-full items-center rounded-full"
      style={{
        boxShadow: `inset 0 0 0 1px ${rang}`,
        paddingLeft: nuqta ? 8 : 9,
        paddingRight: 9,
      }}
    >
      {nuqta && (
        <span
          aria-hidden
          className="mr-[5px] h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: rang }}
        />
      )}
      <span
        className="truncate text-[12px] font-medium leading-4"
        style={{ color: matn ?? rang }}
      >
        {nomi}
      </span>
    </span>
  );
}

function Holat({
  ikon,
  sarlavha,
  sarlavhaRang,
  tavsif,
  amal,
}: {
  ikon: React.ReactNode;
  sarlavha: string;
  sarlavhaRang: string;
  tavsif: string;
  amal: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-[10px] text-center">
      {ikon}
      <div className="text-[16px] font-semibold leading-[22px]" style={{ color: sarlavhaRang }}>
        {sarlavha}
      </div>
      <p className="max-w-[460px] text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
        {tavsif}
      </p>
      {amal && <div className="mt-[4px]">{amal}</div>}
    </div>
  );
}

function SahifaTugma({
  belgi,
  nomi,
  faol,
  ochiq,
  bosildi,
}: {
  belgi: React.ReactNode;
  nomi: string;
  faol?: boolean;
  ochiq?: boolean;
  bosildi: () => void;
}) {
  return (
    <button
      type="button"
      onClick={bosildi}
      disabled={ochiq}
      aria-label={nomi}
      aria-current={faol ? "page" : undefined}
      className={`grid h-[30px] min-w-[30px] place-items-center rounded-lg px-[5px] text-[13px] font-medium leading-[18px] transition-colors ${
        ochiq ? "cursor-not-allowed" : faol ? "" : "hover:bg-[#f4f6fc]"
      } ${FOKUS}`}
      style={
        faol
          ? { background: KO_K, color: "#fff" }
          : {
              background: "#fff",
              color: ochiq ? XIRA : KUL,
              boxShadow: `inset 0 0 0 1px ${ochiq ? HOSHIYA_OCH : HOSHIYA_QUYUQ}`,
            }
      }
    >
      {belgi}
    </button>
  );
}

function Qator({
  g,
  juft,
  hozir,
  maydon,
  ozgartirsaBoladi,
  bosildi,
}: {
  g: AdminErrorGroup;
  juft: boolean;
  hozir: number;
  maydon: "last" | "first";
  ozgartirsaBoladi: boolean;
  bosildi: () => void;
}) {
  const router = useRouter();
  const [ustida, setUstida] = useState(false);
  const dMeta = DARAJA[g.severity];
  const hMeta = HOLAT[g.status];
  const qur = qurilmaQatorlari(g);
  const d = new Date(maydon === "first" ? g.firstSeenAt : g.lastSeenAt);
  const yaroqli = !Number.isNaN(d.getTime());
  // Ikkinchi qator: yorliq + eng ma'lumotli mavjud matn. Xabar bo'lmasa
  // joy yoki kod — bo'sh qator qoldirmaymiz.
  const ikkinchi = g.message || g.where || g.path || g.code;

  const manzil = `/admin/errors/${encodeURIComponent(g.id)}`;

  /**
   * Butun qator bosiladi (Figma'da ham qatorning o'zi bosiladigan
   * ko'rinishda), lekin ikki holatda o'tmaymiz:
   *
   * 1. Odam matn belgilayotgan bo'lsa — xato kodini nusxalash uchun
   *    belgilagan odamni sahifadan uloqtirish jahl chiqaradi.
   * 2. Bosilgan joy havola yoki tugma bo'lsa — "Holat" ustunidagi tugma
   *    o'z oynasini ochishi kerak, ustiga navigatsiya qo'shilmasin.
   */
  const qatorBosildi = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (window.getSelection()?.toString()) return;
    if ((e.target as HTMLElement).closest("a,button,input,textarea")) return;
    router.push(manzil);
  };

  return (
    <tr
      className="cursor-pointer border-b transition-colors last:border-b-0"
      style={{
        borderColor: HOSHIYA,
        // Zebra fon inline berilgani uchun `hover:` sinfi uni bosa
        // olmaydi — shuning uchun hover holatini o'zimiz saqlaymiz.
        background: ustida ? "#f4f6fc" : juft ? ZEBRA : "#fff",
      }}
      onClick={qatorBosildi}
      onMouseEnter={() => setUstida(true)}
      onMouseLeave={() => setUstida(false)}
    >
      {/* Xatolik */}
      <td className="h-[61px] pl-5 pr-3 align-middle">
        {/* Havola sarlavhada: klaviatura bilan yurish, o'rta tugma bilan
            yangi oynada ochish va manzilni nusxalash ishlashi uchun. */}
        <Link
          href={manzil}
          className={`block min-w-0 rounded-[6px] ${FOKUS}`}
          title={ipucha(g)}
          aria-label={`${g.title || g.code} — batafsil`}
        >
          <div
            className="truncate text-[14px] font-semibold leading-[19px]"
            style={{ color: IK, textDecoration: ustida ? "underline" : undefined }}
          >
            {g.title || g.code}
          </div>
          <div className="truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
            <span style={{ color: XIRA_QUYUQ }}>{g.ref}</span> · {ikkinchi}
          </div>
        </Link>
      </td>

      {/* Qurilma (Figma 3.12.3 · N) — model ustda, OS ostida. */}
      <td className="px-3 align-middle">
        <div className="min-w-0" title={g.lastDevice || undefined}>
          <div
            className="truncate text-[13px] leading-[18px]"
            style={{ color: qur.xira ? OCH_KUL : IK }}
          >
            {qur.ust}
          </div>
          {qur.ost && (
            <div className="truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
              {qur.ost}
            </div>
          )}
        </div>
      </td>

      {/* Ilova versiyasi (Figma 3.12.3 · N) — "1.4.2 (118)". */}
      <td className="px-3 align-middle">
        {g.lastAppVersion ? (
          <span
            className="block truncate text-[13px] leading-[18px]"
            style={{ color: IK }}
            title={g.lastAppVersion}
          >
            {g.lastAppVersion}
          </span>
        ) : (
          <span
            className="text-[13px] leading-[18px]"
            style={{ color: XIRA }}
            title={
              SERVER_MUHITI.includes(g.runtime)
                ? "Server tomonidagi xatolik — ilova versiyasiga bog'liq emas"
                : "Ilova versiyasi yuborilmagan"
            }
          >
            —
          </span>
        )}
      </td>

      {/* Manba */}
      <td className="px-3 align-middle">
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-[18px]" style={{ color: IK }}>
            {/* Katalogda yo'q modul — backend yangi guruh qo'shgan. Xom
                kodni ko'rsatamiz, qatorni yashirmaymiz. */}
            {MODUL[g.module] ?? g.module}
          </div>
          <div className="truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
            {g.runtime || "—"}
          </div>
        </div>
      </td>

      {/* Muhimlik */}
      <td className="px-3 align-middle">
        {dMeta ? (
          <Nishon nomi={dMeta.nomi} rang={dMeta.rang} matn={dMeta.matn} nuqta />
        ) : (
          <span style={{ color: XIRA }}>{g.severity}</span>
        )}
      </td>

      {/* Hodisalar */}
      <td className="px-3 text-right align-middle">
        <span className="text-[14px] font-semibold leading-[19px]" style={{ color: IK }}>
          {son(g.count)}
        </span>
      </td>

      {/* Foydalanuvchi */}
      <td className="px-3 text-right align-middle">
        {g.usersCount > 0 ? (
          <span className="text-[14px] leading-[19px]" style={{ color: KUL }}>
            {son(g.usersCount)}
          </span>
        ) : (
          // Nol — "hech kimga tegmadi" EMAS: fon jarayoni yoki
          // autentifikatsiyadan oldingi xatolikda foydalanuvchi umuman
          // ma'lum bo'lmaydi.
          <span className="text-[14px] leading-[19px]" style={{ color: XIRA }} title="Foydalanuvchi aniqlanmagan">
            —
          </span>
        )}
      </td>

      {/* Oxirgi / Birinchi marta */}
      <td className="px-3 align-middle">
        {yaroqli ? (
          <>
            <div className="text-[13px] leading-[18px]" style={{ color: IK }}>
              {nisbiy(d, hozir)}
            </div>
            <div className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
              {sana(d)} {soat(d)}
            </div>
          </>
        ) : (
          <span style={{ color: XIRA }}>—</span>
        )}
      </td>

      {/* Holat — nishon nuqta bilan (Figma 3.12.3 · N: [ellipse] nuqta). */}
      <td className="px-3 align-middle">
        {ozgartirsaBoladi ? (
          <button
            type="button"
            onClick={bosildi}
            className={`max-w-full rounded-full transition-opacity hover:opacity-70 ${FOKUS}`}
            title={`Holatni o'zgartirish · ${g.ref}`}
          >
            <Nishon
              nomi={hMeta ? hMeta.nomi : g.status}
              rang={hMeta ? hMeta.rang : HOSHIYA_QUYUQ}
              matn={hMeta?.matn}
              nuqta
            />
          </button>
        ) : (
          <Nishon
            nomi={hMeta ? hMeta.nomi : g.status}
            rang={hMeta ? hMeta.rang : HOSHIYA_QUYUQ}
            matn={hMeta?.matn}
            nuqta
          />
        )}
      </td>

      {/* Mas'ul (Figma 3.12.3 · N + J) — kim tuzatayotgani ro'yxatning
          o'zida ko'rinadi, batafsil ekranga kirmasdan. */}
      <td className="px-3 pr-5 align-middle">
        {g.assignee ? (
          <div className="flex min-w-0 items-center gap-[7px]" title={g.assignee}>
            <span
              aria-hidden
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[11px] font-semibold"
              style={{ background: AVATAR_KO_K, color: "#1c4fb3" }}
            >
              {boshHarflar(g.assignee)}
            </span>
            <span className="truncate text-[13px] leading-[18px]" style={{ color: IK }}>
              {g.assignee}
            </span>
          </div>
        ) : (
          <span
            className="text-[13px] leading-[18px]"
            style={{ color: XIRA }}
            title="Mas'ul biriktirilmagan"
          >
            —
          </span>
        )}
      </td>
    </tr>
  );
}
