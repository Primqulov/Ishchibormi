"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import { api, APIError, Elon, getAdminRole } from "@/lib/api";
import { AdminModal } from "@/components/admin/AdminModal";
import { DeleteMode, DeleteModeModal } from "@/components/admin/DeleteModeModal";
import { Tanlov } from "@/components/admin/Filtr";
import { ELON_HOLAT, ElonNishoni, HolatKor, elonHolatKor } from "@/components/admin/ElonHolat";
import { ARIZA_RANG } from "@/components/admin/ArizaHolat";
import { safeHref, safeImageSrc } from "@/lib/url";
import {
  AVATAR_FON,
  HOSHIYA,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  ORANJ,
  QIZIL,
  QIZIL_FON,
  QIZIL_HOSHIYA,
  QUTI_FON,
  SIYOH,
  SOYA,
  XIRA_QUYUQ,
  YASHIL,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.5.1 · E'lon — batafsil (1440 × 2313)".

   Sahifa BITTA so'rovdan yashaydi: `GET /api/admin/elons/{id}`
   (apps/api/internal/admin/elon_detail.go). U e'lonning o'zi, egasi,
   arizalari, admin amallari va shikoyatlarini bir javobda beradi —
   shuning uchun bu yerda beshta emas, bitta `load()` bor.

   O'lchamlar Figma'dan aynan olingan: e'lon kartasi ichki oraliq 14 va
   ichki chegara 20/22, qolgan kartalar 10 va 18/22. Maydon qatorining
   yorliq ustuni 130 px QAT'IY — qiymatlar hamma kartada bir chizig'da
   turishi kerak.

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow.

   # NEGA TUGMALAR `tugma()` DAN

   Figma bu ekranda tugmani r9 / gap7 / Medium qilib chizgan, ro'yxat
   ekranida esa r10 / gap8 / Semi Bold. Ikkinchisi `components/admin/ui.ts`
   ga yozilgan va allaqachon uchta ekranda ishlatiladi. Bir piksellik
   radius uchun ikkinchi tugma tizimini ochish — panel bo'ylab tugmalar
   bir-biridan uzoqlashishining eng oson yo'li, shuning uchun bu yerda
   umumiy `tugma()` ishlatiladi.
   ───────────────────────────────────────────────────────────────────── */

/* ── Turlar (backend javobi) ──────────────────────────────────────── */

/**
 * `lib/api.ts` dagi ommaviy `Elon` da `updatedAt` va `viewsCount` YO'Q —
 * ular ommaviy feedda ko'rsatilmaydi. Admin javobida esa bor
 * (`models.Elon`), va Figma ikkalasini ham ko'rsatadi ("Oxirgi tahrir",
 * "Ko'rishlar"). Shuning uchun ommaviy turni kengaytirayapmiz: ommaviy
 * turga qo'shib qo'ysak, kabinet sahifalari ham bu maydonlar borday
 * yozilib ketardi.
 */
type ElonToliq = Elon & {
  updatedAt?: string;
  viewsCount?: number;
};

/** E'lon egasi — `elonOwnerBrief` (to'liq profil emas, ataylab). */
interface Egasi {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string;
  region?: string;
  district?: string;
  isPhoneVerified: boolean;
  isBlocked: boolean;
  isDeleted: boolean;
  createdAt: string;
  elonsTotal: number;
  elonsActive: number;
}

/** Bitta ariza qatori. Ishchining TELEFONI javobda yo'q — ataylab. */
interface ArizaQatoriTuri {
  id: string;
  workerId: string;
  workerName?: string;
  peopleCount: number;
  status: string;
  appliedAt: string;
  decidedAt?: string;
}

interface ShikoyatTuri {
  id: string;
  reason: string;
  description?: string;
  status: string;
  reporterName?: string;
  createdAt: string;
}

/** Admin jurnalidan olingan bitta amal (`elonAdminAction`). */
interface AmalTuri {
  kind: string;
  status?: string;
  at: string;
  detail?: string;
  actor?: string;
}

interface Detail {
  elon: ElonToliq;
  /** Hisob butunlay o'chirilgan bo'lsa `null` — bo'sh obyekt emas. */
  owner: Egasi | null;
  applications: ArizaQatoriTuri[];
  /** Holat bo'yicha TO'LIQ sanoq (qatorlar 100 ta bilan chegaralangan). */
  applicationCounts: Record<string, number>;
  reports: ShikoyatTuri[];
  adminActions: AmalTuri[];
}

/* ── Doimiylar ────────────────────────────────────────────────────── */

/**
 * E'lon identifikatori — faqat 24 belgili hex (MongoDB ObjectID).
 *
 * Manzil bo'lagi brauzerdan keladi, ya'ni ixtiyoriy matn bo'lishi mumkin.
 * Shakl tekshirilmasa, har noto'g'ri manzil serverga so'rov yuborardi va
 * javob 400 bo'lardi — ya'ni tashqi odam admin endpointini shakl
 * tekshiruvi sifatida ishlatib turardi. Ro'yxat sahifasidagi qorovul
 * bilan bir xil (app/admin/elons/page.tsx · oqOid).
 */
const oqOid = (v: string) => (/^[0-9a-f]{24}$/i.test(v) ? v : "");

/** Sahifa boshidagi qaytish havolasining ko'rinishi. */
interface QaytishJoyi {
  href: string;
  matn: string;
  izoh: string;
}

/** Odatiy joy — e'lonlar ro'yxati (Figma 3.5.1 dagi havola). */
const QAYTISH_ROYXAT: QaytishJoyi = {
  href: "/admin/elons",
  matn: "E'lonlar",
  izoh: "E'lonlar ro'yxatiga qaytish",
};

/**
 * Arizalar ro'yxati (Figma 3.6).
 *
 * Filtr va sahifa raqami ATAYLAB uzatilmaydi: bu yerda tekshirilmagan
 * `status=…` qiymatlari yana havolaga tushardi. Ro'yxat holatini
 * arizaning batafsil sahifasi (Figma 3.6.1) o'z manzilida saqlaydi —
 * pastdagi `kel=ariza` + `ariza=<id>` shoxi shu sahifaga qaytaradi.
 */
const QAYTISH_ARIZALAR: QaytishJoyi = {
  href: "/admin/applications",
  matn: "Arizalar",
  izoh: "Arizalar ro'yxatiga qaytish",
};

/**
 * Qaytish havolasi — admin bu sahifaga QAYERDAN kelganiga qarab.
 *
 * # NEGA MANZILDAN O'QILADI
 * Bitta e'longa TO'RT yo'ldan kelinadi: e'lonlar ro'yxatidan, biror
 * foydalanuvchining batafsil sahifasidan («E'lonlari» / «Arizalari»
 * bloklari), arizalar ro'yxatidan va bitta arizaning batafsil
 * sahifasidan (Figma 3.6.1 · «E'lonni ko'rish»). Havola qattiq
 * `/admin/elons` bo'lib qolsa, profildan kelgan admin qaytishda o'zi
 * qidirib topgan foydalanuvchidan uzilib qolardi, arizalar jadvalini
 * filtrlab o'tirgan admin esa filtridan.
 *
 * # NIMA ATAYLAB YO'Q — TAYYOR YO'L QABUL QILINMAYDI
 * Manzildan FAQAT belgi va identifikator o'qiladi: `kel` (bu yerdagi
 * qisqa ro'yxatdan), `kim` va `ariza` — 24 belgili ObjectID lar.
 * Yo'lning o'zi shu yerda yasaladi. `?kel=/istalgan/yo'l` shaklida qabul
 * qilinganda, admin panelga havola yuborib uni tashqi saytga
 * (`//boshqa.example`) yoki `javascript:` ga yo'naltirish mumkin
 * bo'lardi — ochiq yo'naltirish (open redirect) teshigi. Tanimagan
 * qiymat jimgina ro'yxatga qaytaradi.
 *
 * # NEGA `router.back()` EMAS
 * Sahifa amaldan keyin qayta yuklanadi va manzil tarixida bir nechta yozuv
 * qoladi; `back()` esa e'lonni yashirish oynasidan chiqqan adminni shu
 * sahifaning o'ziga qaytarardi. Bu yerda kelgan joy ANIQ ko'rsatiladi.
 */
function qaytishJoyi(kel: string | null, kim: string | null, ariza: string | null): QaytishJoyi {
  if (kel === "ariza") {
    // Ariza ID si bo'lsa — o'sha arizaning batafsil sahifasi. U yerdagi
    // «← Arizalar» esa ro'yxatga filtri bilan qaytadi, ya'ni zanjir
    // uzilmaydi. ID bo'lmasa (arizalar jadvalidan kelgan eski havola)
    // to'g'ridan-to'g'ri ro'yxatga.
    const aid = oqOid(ariza || "");
    if (aid) {
      return {
        href: `/admin/applications/${encodeURIComponent(aid)}`,
        matn: "Ariza",
        izoh: "Arizaning batafsil sahifasiga qaytish",
      };
    }
    return QAYTISH_ARIZALAR;
  }
  if (kel === "user") {
    const uid = oqOid(kim || "");
    if (uid) {
      return {
        href: `/admin/users/${encodeURIComponent(uid)}`,
        matn: "Foydalanuvchi",
        izoh: "Foydalanuvchining batafsil sahifasiga qaytish",
      };
    }
  }
  return QAYTISH_ROYXAT;
}

/**
 * Figma ajratgichlari: kartaning xulosasida IKKI, maydon qiymatlarida
 * UCH bo'shliq.
 *
 * Oddiy bo'shliq yaramaydi — HTML ketma-ket bo'shliqlarni bittaga
 * yig'ib yuboradi va Figma'dagi nafas yo'qolardi. Shuning uchun uzuq
 * bo'shliq (` `), lekin faqat ajratgich ichida: satr baribir
 * so'zlar orasidan bo'linadi.
 */
const AJR = "  ·  ";
const AJR_KENG = "   ·   ";

/** Kartada ko'rinadigan ariza qatorlari — qolgani oynada. */
const ARIZA_KORINADI = 5;
/** Kartada ko'rinadigan admin amallari (Figma izohi: "Oxirgi 3 ta"). */
const AMAL_KORINADI = 3;

/**
 * Ariza holatlari — Figma 3.5.1 dagi nishonlar.
 *
 * Yorliqlar KICHIK harfda: bu ekranda nishon matni holat nomi
 * (`components/admin/ElonHolat.tsx` bilan bir oila), sarlavha emas.
 * Arizalar ro'yxatida (Figma 3.6) esa ular bosh harfda — o'sha jadvalda
 * nishon ustunning to'liq qiymati.
 *
 * RANG faqat `components/admin/ArizaHolat.tsx` dan olinadi: Figma 3.6a
 * qoidasi — «Har bir holat rangi butun panel bo'ylab bir xil
 * ishlatiladi». Shu yerda qo'lda yozilganda "qabul qilingan" bu ekranda
 * yashil, arizalar ro'yxatida ko'k bo'lib qolardi.
 */
const ARIZA_HOLAT: Record<string, HolatKor> = {
  pending: { matn: "kutilmoqda", rang: ARIZA_RANG.pending },
  accepted: { matn: "qabul qilingan", rang: ARIZA_RANG.accepted },
  rejected: { matn: "rad etilgan", rang: ARIZA_RANG.rejected },
  cancelled: { matn: "bekor qilingan", rang: ARIZA_RANG.cancelled },
  completed: { matn: "bajarilgan", rang: ARIZA_RANG.completed },
};

/** Kartaning xulosasidagi sanoq tartibi (Figma: qabul → kutilmoqda → rad). */
const ARIZA_TARTIB = ["accepted", "pending", "rejected", "cancelled", "completed"];

/** Shikoyat holati (backend: open|resolved|dismissed). */
const SHIKOYAT_HOLAT: Record<string, HolatKor> = {
  open: { matn: "hal qilinmagan", rang: ORANJ },
  resolved: { matn: "hal qilindi", rang: YASHIL },
  dismissed: { matn: "rad etildi", rang: OCH_KUL },
};

/**
 * Admin amali turlari — backend `elonAction*` doimiylari
 * (apps/api/internal/admin/elon_detail.go).
 *
 * Ranglar Figma qoidasiga bo'ysunadi: yashil = foydalanuvchilarga
 * qaytdi, kulrang = qaytariladigan yashirish, qizil = qaytarib
 * bo'lmaydigan o'chirish. Siyoh esa "boshqa holatga o'tkazildi" —
 * moderatsiya emas, oddiy tahrir.
 */
const AMAL_TUR: Record<string, HolatKor> = {
  hidden: { matn: "yashirildi", rang: XIRA_QUYUQ },
  restored: { matn: "tiklandi", rang: YASHIL },
  status: { matn: "holat o'zgardi", rang: SIYOH },
  deleted: { matn: "o'chirildi", rang: QIZIL },
  purged: { matn: "bazadan o'chirildi", rang: QIZIL },
};

const AMAL_TARTIB = ["hidden", "restored", "status", "deleted", "purged"];

/**
 * Admin panelidan QO'YILISHI mumkin bo'lgan holatlar.
 *
 * Server tomonidagi `elonStatusSettable` bilan AYNAN bir xil
 * (apps/api/internal/admin/elons.go): draft / in_progress / completed
 * e'lonning o'z hayotiy davri natijasi va ularni qo'lda qo'yish ishning
 * haqiqiy borishini buzardi. Ro'yxat oq ro'yxat sifatida ham ishlaydi —
 * `<select>` qiymati brauzer vositalari orqali o'zgartirilishi mumkin.
 */
const QOYILADIGAN = ["recruiting", "filled", "cancelled", "hidden"];

/** To'lov turi yorliqlari (Figma 3.5.1 · "Ish shartlari va to'lov"). */
const TOLOV_TURI: Record<string, string> = {
  total: "Belgilangan summa",
  per_worker: "Har bir ishchi uchun",
  negotiable: "Kelishuv",
};

/**
 * Jins talabi yorliqlari.
 *
 * `mixed` bu yerda «Farqi yo'q» — `lib/api.ts` dagi `GENDER_LABEL` da esa
 * «Aralash». O'sha yorliq FILTR uchun (feedda "aralash e'lonlar"), bu
 * yerda esa e'lonning sharti o'qiladi: "aralash ishchi kerak" degan gap
 * yo'q, "jinsi farqi yo'q" degan gap bor.
 */
const JINS: Record<string, string> = {
  male: "Erkaklar",
  female: "Ayollar",
  mixed: "Farqi yo'q",
};

/* ── Formatlash ───────────────────────────────────────────────────── */

const OYLAR = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/** Figma sana ko'rinishi: "18-avgust 2026". */
function sana(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()}-${OYLAR[d.getMonth()]} ${d.getFullYear()}`;
}

/** Figma sana + soat ko'rinishi: "12-avgust 2026, 14:29". */
function sanaVaqt(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sana(iso)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * "Ish boshlanadi" — bu maydon bazada SATR (`models.Elon.StartDate`),
 * vaqt belgisi emas: uni foydalanuvchi kiritadi.
 *
 * Shuning uchun o'qib bo'lmasa xom qiymat ko'rsatiladi — "—" yozsak,
 * moderator e'londa sana yo'q deb o'ylardi, holbuki foydalanuvchi
 * nimadir yozgan va aynan shuni ko'rish kerak.
 */
function sanaMatn(xom?: string): string {
  const v = (xom || "").trim();
  if (!v) return "";
  const s = sana(v);
  return s === "—" ? v.slice(0, 40) : s;
}

/** Ming ajratgichi — uzuq bo'shliq (Figma: "450 000"). */
function son(v?: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "0";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Figma telefon ko'rinishi: +998 91 604 88 12. Mos kelmasa — o'zgarishsiz. */
function telefon(v?: string): string {
  const t = (v || "").replace(/[^\d+]/g, "");
  const m = /^\+?998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(t);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (v || "").slice(0, 24);
}

/** Avatar o'rnidagi harf. */
function bosh(nom?: string): string {
  const s = (nom || "").trim();
  return s ? s[0].toUpperCase() : "?";
}

/**
 * Xarita havolasi — HAVOLA + KO'RINADIGAN MATN.
 *
 * # NEGA KO'RINADIGAN MATN MANZILDAN QAYTA YASALADI
 *
 * `locationUrl` ni foydalanuvchi kiritadi va serverda uning HOSTI
 * tekshirilmaydi (oq ro'yxat yo'q). Ya'ni bu yerda ko'rsatiladigan matn
 * — moderatorning oxirgi himoyasi: xom satrni chizsak,
 * `https://maps.google.com@evil.example/...` "google" bo'lib ko'rinardi.
 * Manzil `URL` bilan qayta tahlil qilinganda esa `host` HAQIQIY host
 * bo'ladi va u matnning boshida turadi.
 *
 * `safeHref` sxemani (javascript:, data: …) allaqachon kesadi; bu yerda
 * qo'shimcha ravishda faqat http/https qoldiriladi — "xaritada ochish"
 * uchun mailto:/tel: ma'nosiz.
 */
function xarita(xom?: string): { href: string; korinish: string } | null {
  const xavfsiz = safeHref(xom);
  if (!xavfsiz) return null;
  let u: URL;
  try {
    u = new URL(xavfsiz);
  } catch {
    // Sayt ichidagi nisbiy havola — xarita manzili bo'lolmaydi.
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const matn = `${u.host}${u.pathname}${u.search}`.replace(/\/$/, "");
  return {
    href: u.toString(),
    korinish: matn.length > 72 ? `${matn.slice(0, 71)}…` : matn,
  };
}

/**
 * Admin amali izohi — bazadagi holat kodini o'zbekcha yorliqqa
 * almashtiradi.
 *
 * Izohni backend yozadi (`elonStatusUpdate`, `DeleteElon`) va u
 * allaqachon o'zbekcha, lekin ICHIDA xom holat kodi qoladi:
 * «tiklandi — oldingi holatiga qaytarildi: recruiting». Moderator esa
 * ekranning boshqa joylarida "yig'ilmoqda" ni ko'rib turadi — bitta
 * holat ikki xil nomda ko'rinsa, u ikkita boshqa narsa deb o'qiladi.
 */
function sababMatni(detail?: string): string {
  const d = (detail || "").trim();
  if (!d) return "Izoh yozilmagan";
  // `elonStatusUpdate` ning default tarmog'i: izoh AYNAN holat kodi.
  if (ELON_HOLAT[d]) return `holat «${ELON_HOLAT[d].matn}» ga o'zgartirildi`;
  return d
    .replace(
      /([:,]\s)(draft|recruiting|filled|in_progress|completed|cancelled|hidden)\b/g,
      (_m, ajr: string, kod: string) => `${ajr}${ELON_HOLAT[kod].matn}`,
    )
    .slice(0, 200);
}

/**
 * Amalni kim bajargani.
 *
 * Bo'sh bo'lsa admin bazadan o'chirilgan: yozuv qoldi, muallifi noma'lum.
 * "Avtomatik" deb ko'rsatish YOLG'ON bo'lardi — bu amallarni tizim
 * qilmaydi, faqat odam qiladi.
 */
function amalKim(a: AmalTuri): string {
  return a.actor || "Admin (o'chirilgan)";
}

/* ── Sahifa ───────────────────────────────────────────────────────── */

/**
 * `useSearchParams` Suspense chegarasini talab qiladi (Next App Router):
 * chegarasiz ishlatilsa qurish paytida ogohlantirish beradi. Sahifa
 * ma'lumotni brauzerda yuklaydi, shuning uchun `fallback` bo'sh —
 * «Yuklanmoqda…» kartasi ichkarida chiziladi.
 */
export default function AdminElonDetail() {
  return (
    <Suspense fallback={null}>
      <ElonBatafsil />
    </Suspense>
  );
}

function ElonBatafsil() {
  const params = useParams<{ id: string | string[] }>();
  // `useParams` massiv qaytarishi mumkin (catch-all yo'llar). Bitta
  // qiymatga keltiramiz: aks holda so'rov yo'liga "a,b" tushib qolardi.
  const xomId = params?.id;
  const id = oqOid((Array.isArray(xomId) ? xomId[0] : xomId) || "");
  const router = useRouter();
  const qidiruv = useSearchParams();
  const qaytish = qaytishJoyi(
    qidiruv?.get("kel") ?? null,
    qidiruv?.get("kim") ?? null,
    qidiruv?.get("ariza") ?? null,
  );

  const [d, setD] = useState<Detail | null>(null);
  const [yuklashXato, setYuklashXato] = useState("");
  const [amalXato, setAmalXato] = useState("");
  const [band, setBand] = useState(false);
  const [isSuper, setIsSuper] = useState(false);

  const [holatOpen, setHolatOpen] = useState(false);
  const [holatQiy, setHolatQiy] = useState("recruiting");
  const [arizaOpen, setArizaOpen] = useState(false);
  const [amalOpen, setAmalOpen] = useState(false);
  const [ochirOpen, setOchirOpen] = useState(false);
  const [ochirXato, setOchirXato] = useState("");

  /**
   * So'rov navbati — kechikib kelgan javob yangisini bosib ketmasin.
   *
   * Sahifa har amaldan keyin qayta yuklanadi va amallar tez ketma-ket
   * bo'lishi mumkin. Raqamsiz: birinchi so'rov sekin qaytsa, ekranda
   * ESKI holat turib qolardi va moderator "yashirilmadi" deb o'ylab,
   * ochiq e'lon ustidan ikkinchi qaror qabul qilardi.
   */
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setYuklashXato("E'lon manzili noto'g'ri");
      return;
    }
    const raqam = ++soravRaqami.current;
    try {
      // `encodeURIComponent` — id manzil bo'lagiga tushadi. Yuqorida
      // shakli tekshirilgan bo'lsa ham qoldirilgan: qorovul o'zgarib
      // ketsa, bu qator baribir so'rovni boshqa endpointga
      // yo'naltirib yuborishning oldini oladi.
      const javob = await api.get<Detail>(
        `/api/admin/elons/${encodeURIComponent(id)}`,
        { auth: "admin" } as any,
      );
      if (raqam !== soravRaqami.current) return;
      setD(javob);
      setYuklashXato("");
    } catch (e) {
      if (raqam !== soravRaqami.current) return;
      // Xom javob tanasi EMAS — faqat backendning tayyor xabari. Aks
      // holda texnik tafsilot (yo'l, so'rov) ekranga chiqib ketardi.
      setYuklashXato((e as APIError)?.message || "Ma'lumotni yuklab bo'lmadi");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  // Rol faqat ko'rinishni boshqaradi — ruxsat baribir serverda
  // tekshiriladi (internal/admin/deletemode.go). Bu yerdagi tekshiruv
  // "bosilib 403 olish" ni oldini oladi, xavfsizlik qorovuli emas.
  useEffect(() => {
    setIsSuper(getAdminRole() === "superadmin");
  }, []);

  /** Holatni o'zgartirish — yashirish, tiklash va oynadagi tanlov uchun bitta yo'l. */
  const holatniQoy = useCallback(
    async (yangi: string, xatoMatni: string) => {
      if (band || !id || !QOYILADIGAN.includes(yangi)) return;
      setBand(true);
      setAmalXato("");
      try {
        await api.patch(
          `/api/admin/elons/${encodeURIComponent(id)}/status`,
          { status: yangi },
          { auth: "admin" } as any,
        );
        setHolatOpen(false);
        await load();
      } catch (e) {
        setAmalXato((e as APIError)?.message || xatoMatni);
      } finally {
        setBand(false);
      }
    },
    [band, id, load],
  );

  async function ochir(mode: DeleteMode) {
    if (!id) return;
    setBand(true);
    setOchirXato("");
    try {
      await api.delete(
        `/api/admin/elons/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,
        { auth: "admin" } as any,
      );
      setOchirOpen(false);
      if (mode === "purge") {
        // Bazadan o'chirilgan e'lon endi yo'q — bu sahifani qayta
        // yuklash 404 berardi va moderator xato ekranda qolardi. Kelgan
        // joyga qaytariladi: profildan kelgan admin o'sha profilda ishini
        // davom ettirsin.
        router.push(qaytish.href);
        return;
      }
      await load();
    } catch (e) {
      setOchirXato((e as APIError)?.message || "O'chirib bo'lmadi");
    } finally {
      setBand(false);
    }
  }

  const karta: React.CSSProperties = { boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` };

  /* Ma'lumot kelmaguncha butun sahifa o'rniga BITTA karta turadi —
     bloklar bittalab paydo bo'lmaydi. Xato ham shu yerda: bo'sh sahifa
     "ma'lumot yo'q" deb o'qilmasligi kerak (3.4a · 4 bilan bir xil). */
  if (!d) {
    return (
      <div
        className="grid h-[90px] place-items-center rounded-[14px] bg-white px-5 text-center text-[13px] font-medium leading-[18px]"
        style={{ ...karta, color: yuklashXato ? QIZIL : XIRA_QUYUQ }}
      >
        {yuklashXato || "Yuklanmoqda…"}
      </div>
    );
  }

  const e = d.elon;
  const egasi = d.owner;
  const arizalar = d.applications ?? [];
  const sanoq = d.applicationCounts ?? {};
  const shikoyatlar = d.reports ?? [];
  const amallar = d.adminActions ?? [];
  const neg = e.pricingType === "negotiable";
  const yashirilgan = e.status === "hidden";
  const rasmlar = Array.isArray(e.images) ? e.images : [];
  const xar = xarita(e.locationUrl);

  // Arizalar sanog'i qatorlardan EMAS, `applicationCounts` dan olinadi:
  // qatorlar 100 ta bilan chegaralangan, sarlavhadagi son esa to'liq
  // bo'lishi kerak.
  const arizaJami = Object.values(sanoq).reduce((s, n) => s + (n || 0), 0);
  const arizaXulosa = [
    ...ARIZA_TARTIB.filter((s) => (sanoq[s] || 0) > 0).map(
      (s) => `${son(sanoq[s])} ${ARIZA_HOLAT[s].matn}`,
    ),
    `kerakli ishchi ${son(e.workersNeeded)} ta`,
  ].join(AJR);

  const amalXulosa = [
    ...AMAL_TARTIB.filter((k) => amallar.some((a) => a.kind === k)).map(
      (k) => `${amallar.filter((a) => a.kind === k).length} marta ${AMAL_TUR[k].matn}`,
    ),
    "e'lon egasiga tegishli amallar bu ro'yxatga kirmaydi",
  ].join(AJR);

  /* «hozirgi holat» nishoni — jurnaldagi qaysi yozuv HOZIR kuchda
     ekanini aytadi. Sana bilan javob berish mumkin emas: eng yangi
     yozuv holatni o'zgartirmagan bo'lishi mumkin (masalan takroriy
     yashirish). Shuning uchun holati e'lonning hozirgi holatiga mos
     keladigan ENG YANGI yozuv belgilanadi. */
  const hozirgiAmal = amallar.findIndex((a) => !!a.status && a.status === e.status);

  const egaIsmi = egasi
    ? `${egasi.firstName || ""} ${egasi.lastName || ""}`.trim()
    : (e.ownerName || "").trim();

  const egaHolati = egasi
    ? [
        egasi.isDeleted ? "O'chirilgan" : egasi.isBlocked ? "Bloklangan" : "Faol",
        egasi.isPhoneVerified ? "telefon tasdiqlangan" : "telefon tasdiqlanmagan",
      ].join(AJR_KENG)
    : "";

  const egaHudud = egasi
    ? [egasi.region, egasi.district].filter(Boolean).join(", ")
    : [e.region, e.district].filter(Boolean).join(", ");

  const koordinata =
    typeof e.lat === "number" &&
    typeof e.lng === "number" &&
    Number.isFinite(e.lat) &&
    Number.isFinite(e.lng) &&
    (e.lat !== 0 || e.lng !== 0)
      ? `${e.lat.toFixed(5)},  ${e.lng.toFixed(5)}`
      : "";

  const ishVaqti = [e.workTimeFrom, e.workTimeTo].filter(Boolean).join(" — ");

  return (
    <div className="flex flex-col gap-4">
      {/* Qaytish havolasi — matni ham manzili ham kelgan joyga qarab
          o'zgaradi: admin qayerga qaytayotganini BOSISHDAN OLDIN ko'rsin. */}
      <Link
        href={qaytish.href}
        title={qaytish.izoh}
        className="inline-flex w-fit items-center gap-[7px] text-[13px] font-medium leading-[18px] hover:underline"
        style={{ color: OCH_KUL }}
      >
        <ArrowLeft size={15} aria-hidden />
        {qaytish.matn}
      </Link>

      {/* Amal xatosi. Yashirish/Tiklash tasdiq oynasisiz bajariladi, ya'ni
          jimgina yo'qolgan xato eng yomon variant bo'lardi: moderator
          "bosdim, bo'ldi" deb ketardi, e'lon esa ochiq qolardi. */}
      {amalXato && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[14px] px-5 py-[11px] text-[12px] font-medium leading-[17px]"
          style={{
            background: QIZIL_FON,
            color: QIZIL,
            boxShadow: `inset 0 0 0 1px ${QIZIL_HOSHIYA}`,
          }}
        >
          {amalXato}
        </div>
      )}

      {/* ── 1. E'lon kartasi ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-[14px] rounded-[14px] bg-white px-[22px] py-5" style={karta}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="flex min-w-0 flex-wrap items-center gap-[10px]">
              <h1 className="min-w-0 text-[20px] font-bold leading-[26px]" style={{ color: IK }}>
                {e.title || "Sarlavhasiz e'lon"}
              </h1>
              <ElonNishoni {...elonHolatKor(e.status)} />
              {/* O'chirilgan yozuv nishoni — ro'yxat sahifasidagi bilan
                  bir xil. Holat nishoni bilan ziddiyat yo'q: u e'lonning
                  ish holati, bu esa yozuvning taqdiri. */}
              {e.isDeleted && <ElonNishoni matn="o'chirilgan" rang={QIZIL} />}
            </div>
            <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
              {[e.categoryName, egaHudud, `ID ${e.id}`].filter(Boolean).join(AJR)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setAmalXato("");
                setHolatQiy(QOYILADIGAN.includes(e.status) ? e.status : "recruiting");
                setHolatOpen(true);
              }}
              disabled={band || e.isDeleted}
              title={e.isDeleted ? "O'chirilgan e'lon holati o'zgartirilmaydi" : ""}
              {...tugma("ikkilamchi", { ochiq: band || e.isDeleted })}
            >
              <RefreshCw size={15} aria-hidden />
              Holatni o&apos;zgartirish
            </button>

            {/* O'chirilgan e'londa «Yashirish/Tiklash» UMUMAN chizilmaydi
                (Figma 3.5a · 2) — u allaqachon ko'rinmaydi va qaytmaydi.
                Server ham shu qoidani qo'llaydi: 409 `elon_deleted`. */}
            {!e.isDeleted && (
              <button
                onClick={() =>
                  holatniQoy(
                    yashirilgan ? "recruiting" : "hidden",
                    yashirilgan ? "E'lonni tiklab bo'lmadi" : "E'lonni yashirib bo'lmadi",
                  )
                }
                disabled={band}
                {...tugma("ikkilamchi", { ochiq: band })}
              >
                {yashirilgan ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
                {yashirilgan ? "Tiklash" : "Yashirish"}
              </button>
            )}

            {(!e.isDeleted || isSuper) && (
              <button
                onClick={() => {
                  setOchirXato("");
                  setOchirOpen(true);
                }}
                disabled={band}
                {...tugma("xavf", { ochiq: band })}
              >
                <Trash2 size={15} aria-hidden />
                {e.isDeleted ? "Bazadan o'chirish" : "O'chirish"}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-[12px]">
          <Stat
            yorliq="Umumiy to'lov"
            qiymat={neg ? "kelishiladi" : `${son(e.priceAmount)} so'm`}
          />
          <Stat yorliq="Kerakli ishchi" qiymat={`${son(e.workersNeeded)} ta`} />
          <Stat yorliq="Ko'rishlar" qiymat={son(e.viewsCount)} />
          <Stat
            yorliq="Arizalar"
            qiymat={
              `${son(arizaJami)} ta` +
              (e.acceptedCount > 0 ? `${AJR}${son(e.acceptedCount)} qabul qilingan` : "")
            }
          />
        </div>

        <div className="flex flex-col gap-[3px]">
          <p className="flex flex-wrap items-baseline gap-[5px]">
            <span className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
              Joylangan:
            </span>
            <span
              className="text-[13px] font-bold leading-[18px]"
              style={{ color: e.publishedAt ? IK : XIRA_QUYUQ }}
            >
              {e.publishedAt ? sanaVaqt(e.publishedAt) : "hali e'lon qilinmagan"}
            </span>
          </p>
          <p className="text-[11px] leading-4" style={{ color: XIRA_QUYUQ }}>
            {`Yaratilgan: ${sanaVaqt(e.createdAt)}${AJR_KENG}Oxirgi tahrir: ${sanaVaqt(e.updatedAt)}`}
          </p>
        </div>

        <div className="flex flex-col gap-[4px]">
          <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            Tavsif:
          </p>
          {/* Foydalanuvchi matni JSX matn sifatida chiziladi —
              `dangerouslySetInnerHTML` bu sahifada umuman yo'q.
              `whitespace-pre-line` faqat qatorlarni saqlaydi, teg
              tanimaydi. */}
          <p
            className="whitespace-pre-line break-words text-[13px] leading-[18px]"
            style={{ color: e.description ? KUL : XIRA_QUYUQ }}
          >
            {e.description || "tavsif yozilmagan"}
          </p>
        </div>
      </section>

      {/* ── 2. Kim joylashtirgan ─────────────────────────────────────── */}
      <Karta
        nom="Kim joylashtirgan (e'lon egasi)"
        xulosa={`E'lonni joylagan ish beruvchi${AJR}ma'lumot e'lon yaratilgan paytda nusxalangan`}
        havola={
          egasi && (
            <Link
              href={`/admin/users/${encodeURIComponent(egasi.id)}`}
              className="shrink-0 text-[12px] font-medium leading-4 hover:underline"
              style={{ color: KO_K }}
            >
              Profilni ko&apos;rish
            </Link>
          )
        }
        izoh={
          "Ism, telefon va hudud e'lon yaratilgan paytdagi nusxa — profil keyin " +
          "o'zgargan bo'lishi mumkin. Eng so'nggi ma'lumot uchun profilni ochish kerak. " +
          "«Faol e'lon» — o'chirilmagan va holati «yig'ilmoqda», «to'ldi» yoki " +
          "«jarayonda» bo'lgan e'lon."
        }
      >
        <div className="flex items-center gap-[12px]">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full text-[16px] font-bold"
            style={{ background: AVATAR_FON, color: KO_K }}
            aria-hidden
          >
            {safeImageSrc(egasi?.avatarUrl || e.ownerAvatarUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={safeImageSrc(egasi?.avatarUrl || e.ownerAvatarUrl)}
                alt=""
                className="h-full w-full object-cover"
                // Rasm tashqi manzilda bo'lishi mumkin — admin
                // panelining manzili (e'lon id'si bilan) begona
                // serverga Referer bo'lib ketmasligi kerak.
                referrerPolicy="no-referrer"
              />
            ) : (
              bosh(egaIsmi)
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-[2px]">
            <p className="truncate text-[14px] font-semibold leading-5" style={{ color: IK }}>
              {egaIsmi || "Ismsiz hisob"}
            </p>
            <p className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
              {egasi
                ? [telefon(egasi.phone) || "raqam yo'q", egaHudud, "ish beruvchi"]
                    .filter(Boolean)
                    .join(AJR_KENG)
                : `hisob o'chirilgan${AJR_KENG}e'londagi nusxa`}
            </p>
          </div>
        </div>

        <Ajratgich />

        {/* Qatorlar HAR DOIM chiziladi — qiymat bo'lmasa halol javob
            yoziladi. Yo'q qatorni yashirsak, moderator "bu ma'lumot
            umuman yo'q" bilan "hisob o'chirilgani uchun yo'q" ni
            ajratib olmasdi. */}
        <div className="flex flex-col gap-[7px]">
          <Maydon yorliq="Foydalanuvchi ID">{egasi?.id || e.ownerId || "—"}</Maydon>
          <Maydon yorliq="Hisob holati" xira={!egasi}>
            {egasi ? egaHolati : "hisob topilmadi"}
          </Maydon>
          <Maydon yorliq="Ro'yxatdan o'tgan" xira={!egasi}>
            {egasi ? sanaVaqt(egasi.createdAt) : "noma'lum"}
          </Maydon>
          <Maydon yorliq="Jami e'lonlari" xira={!egasi}>
            {egasi
              ? `${son(egasi.elonsTotal)} ta${AJR_KENG}${son(egasi.elonsActive)} tasi faol`
              : "noma'lum"}
          </Maydon>
        </div>
      </Karta>

      {/* ── 3. Vaqt belgilari ────────────────────────────────────────── */}
      <Karta
        nom="Vaqt belgilari"
        xulosa={`E'lon hayotidagi barcha sana va soatlar${AJR}Asia/Tashkent mintaqasi`}
        izoh={
          "«Yaratilgan» — e'lon bazaga yozilgan payt, «E'lon qilingan» — " +
          "foydalanuvchilarga ko'rina boshlagan payt. «Ish boshlanadi» va «Ish vaqti» — " +
          "e'lon egasi kiritgan qiymatlar, tizim vaqti emas."
        }
      >
        <div className="flex flex-col gap-[7px]">
          <Maydon yorliq="Yaratilgan">{sanaVaqt(e.createdAt)}</Maydon>
          <Maydon yorliq="E'lon qilingan" xira={!e.publishedAt}>
            {e.publishedAt ? sanaVaqt(e.publishedAt) : "e'lon qilinmagan"}
          </Maydon>
          <Maydon yorliq="Oxirgi tahrir">{sanaVaqt(e.updatedAt)}</Maydon>
          <Maydon yorliq="Ish boshlanadi" xira={!sanaMatn(e.startDate)}>
            {sanaMatn(e.startDate) || "kiritilmagan"}
          </Maydon>
          <Maydon yorliq="Ish vaqti" xira={!ishVaqti}>
            {ishVaqti || "kiritilmagan"}
          </Maydon>
          <Maydon yorliq="O'chirilgan" xira={!e.deletedAt}>
            {e.deletedAt ? sanaVaqt(e.deletedAt) : "o'chirilmagan"}
          </Maydon>
        </div>
      </Karta>

      {/* ── 4. Ish shartlari va to'lov ───────────────────────────────── */}
      <Karta
        nom="Ish shartlari va to'lov"
        xulosa="E'lon egasi ko'rsatgan shartlar"
        izoh={
          "To'lov summalari server tomonida hisoblanadi. «Kelishuv» tanlanganda " +
          "ikkala summa ham 0 bo'lib qoladi va e'londa «kelishuv» deb ko'rsatiladi."
        }
      >
        <div className="flex flex-col gap-[7px]">
          <Maydon yorliq="To'lov turi">
            {TOLOV_TURI[e.pricingType] || (e.pricingType || "—").slice(0, 24)}
          </Maydon>
          <Maydon yorliq="Umumiy summa" xira={neg}>
            {neg ? "kelishiladi" : `${son(e.priceAmount)} so'm`}
          </Maydon>
          <Maydon yorliq="1 ishchiga" xira={neg}>
            {neg ? "kelishiladi" : `${son(e.perWorkerAmount)} so'm`}
          </Maydon>
          <Maydon yorliq="Kerakli ishchi">{`${son(e.workersNeeded)} ta`}</Maydon>
          {/* Bo'sh `gender` = "aralash" (feed filtri ham shunday
              hisoblaydi), shuning uchun bu qator hech qachon "—"
              bo'lmaydi. */}
          <Maydon yorliq="Jins talabi">{JINS[e.gender || "mixed"] || JINS.mixed}</Maydon>
          <Maydon yorliq="Aloqa telefoni" xira={!e.contactPhone}>
            {e.contactPhone ? telefon(e.contactPhone) : "kiritilmagan"}
          </Maydon>
        </div>
      </Karta>

      {/* ── 5. Manzil va ish joyi ────────────────────────────────────── */}
      <Karta
        nom="Manzil va ish joyi"
        xulosa="Koordinatalar e'lon egasi xaritada tanlagan nuqtadan olinadi"
        havola={
          xar && (
            <a
              href={xar.href}
              target="_blank"
              // `noopener` VA `noreferrer` ikkalasi ham: birinchisi yangi
              // oynaga `window.opener` bermaydi, ikkinchisi admin
              // panelining manzilini begona saytga uzatmaydi.
              rel="noopener noreferrer"
              className="shrink-0 text-[12px] font-medium leading-4 hover:underline"
              style={{ color: KO_K }}
            >
              Xaritada ochish
            </a>
          )
        }
        izoh="Viloyat va tuman koordinatalardan avtomatik aniqlanadi — foydalanuvchi ularni qo'lda yozmaydi."
      >
        <div className="flex flex-col gap-[7px]">
          <Maydon yorliq="Viloyat" xira={!e.region}>
            {e.region || "aniqlanmagan"}
          </Maydon>
          <Maydon yorliq="Tuman" xira={!e.district}>
            {e.district || "aniqlanmagan"}
          </Maydon>
          <Maydon yorliq="Manzil izohi" xira={!e.locationText}>
            {e.locationText || "yozilmagan"}
          </Maydon>
          <Maydon yorliq="Koordinatalar" xira={!koordinata}>
            {koordinata || "belgilanmagan"}
          </Maydon>
          <Maydon yorliq="Xarita havolasi" xira={!xar} rang={xar ? KO_K : undefined}>
            {/* Ko'rinadigan matn manzildan qayta yasalgan (xarita()
                izohiga qarang) — xom satr chizilmaydi. */}
            {xar ? xar.korinish : "havola yo'q"}
          </Maydon>
        </div>
      </Karta>

      {/* ── 6. Rasmlar ───────────────────────────────────────────────── */}
      <Karta
        nom={`Rasmlar (${rasmlar.length})`}
        xulosa={`E'lon egasi yuklagan${AJR}maksimal 6 ta`}
        izoh={
          "E'lon yashirilganda yoki o'chirilganda fayllar saqlashdan butunlay " +
          "o'chiriladi — shu holatda bu joyda «rasm mavjud emas» ko'rsatiladi."
        }
      >
        {rasmlar.length ? (
          <div className="flex flex-wrap gap-[12px]">
            {rasmlar.map((xom, i) => {
              const src = safeImageSrc(xom);
              return (
                <div
                  key={`${i}-${xom}`}
                  className="grid h-[120px] w-[176px] shrink-0 place-items-center overflow-hidden rounded-[11px]"
                  style={{ background: AVATAR_FON, boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    // Manzil xavfsiz sxemadan o'tmadi. Jimgina bo'sh
                    // katak qoldirmaymiz: moderator "rasm yuklanmadi"
                    // bilan "manzil buzilgan" ni ajratishi kerak.
                    <span className="text-[11px] leading-[15px]" style={{ color: XIRA_QUYUQ }}>
                      manzil xato
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] leading-[18px]" style={{ color: XIRA_QUYUQ }}>
            rasm mavjud emas
          </p>
        )}
      </Karta>

      {/* ── 7. Arizalar ──────────────────────────────────────────────── */}
      <Karta
        nom={`Arizalar (${son(arizaJami)})`}
        xulosa={arizaXulosa}
        havola={
          arizalar.length > ARIZA_KORINADI && (
            <button
              onClick={() => setArizaOpen(true)}
              className="shrink-0 text-[12px] font-medium leading-4 hover:underline"
              style={{ color: KO_K }}
            >
              Barchasini ko&apos;rish
            </button>
          )
        }
        izoh={
          (arizalar.length > ARIZA_KORINADI
            ? `Oxirgi ${ARIZA_KORINADI} ta ariza ko'rsatildi. `
            : "") +
          "Ariza qatorlari havola emas — ishchi profilini «Arizalar» bo'limidan " +
          "ochish mumkin. Guruh arizasi bo'lsa, ishchi soni ism yonida ko'rsatiladi."
        }
      >
        {arizalar.length ? (
          <div className="flex flex-col">
            {arizalar.slice(0, ARIZA_KORINADI).map((a, i) => (
              <div key={a.id}>
                {i > 0 && <Ajratgich />}
                <ArizaQatori a={a} />
              </div>
            ))}
          </div>
        ) : (
          <BoshHolat />
        )}
      </Karta>

      {/* ── 8. Admin amallari ────────────────────────────────────────── */}
      <Karta
        nom={`Admin amallari (${amallar.length})`}
        xulosa={amallar.length ? amalXulosa : `Amal qilinmagan${AJR}e'lon egasiga tegishli amallar bu ro'yxatga kirmaydi`}
        havola={
          amallar.length > AMAL_KORINADI && (
            <button
              onClick={() => setAmalOpen(true)}
              className="shrink-0 text-[12px] font-medium leading-4 hover:underline"
              style={{ color: KO_K }}
            >
              Barchasini ko&apos;rish
            </button>
          )
        }
        izoh={
          (amallar.length > AMAL_KORINADI ? `Oxirgi ${AMAL_KORINADI} ta amal ko'rsatiladi. ` : "") +
          "Bu ro'yxat admin jurnalidan olinadi va faqat moderator hamda superadminga ko'rinadi."
        }
      >
        {amallar.length ? (
          <div className="flex flex-col">
            {amallar.slice(0, AMAL_KORINADI).map((a, i) => (
              <div key={`${a.at}-${a.kind}-${i}`}>
                {i > 0 && <Ajratgich />}
                <AmalYozuvi a={a} hozirgi={i === hozirgiAmal} />
              </div>
            ))}
          </div>
        ) : (
          <BoshHolat />
        )}
      </Karta>

      {/* ── 9. Shikoyatlar ───────────────────────────────────────────── */}
      <Karta
        nom={`Shikoyatlar (${shikoyatlar.length})`}
        izoh={
          shikoyatlar.length
            ? "Har yozuvda shikoyat sababi, kim yozgani va vaqti ko'rsatiladi. Muallif hisobi o'chirilgan bo'lsa ismi noma'lum bo'lib qoladi."
            : "Bu e'lon ustidan shikoyat tushmagan. Shikoyat tushsa, sababi, kim yozgani va vaqti shu yerda ko'rinadi."
        }
      >
        {shikoyatlar.length ? (
          <div className="flex flex-col">
            {shikoyatlar.map((s, i) => (
              <div key={s.id}>
                {i > 0 && <Ajratgich />}
                <ShikoyatYozuvi s={s} />
              </div>
            ))}
          </div>
        ) : (
          <BoshHolat />
        )}
      </Karta>

      {/* ── Oynalar ──────────────────────────────────────────────────── */}

      {/* Holatni o'zgartirish. Figma 3.5.1 da tugma bor, oyna chizilmagan —
          karkas 3.3a/3.5a oynalari bilan bitta komponentdan (AdminModal).

          Ro'yxat serverdagi `elonStatusSettable` bilan bir xil: qolgan
          holatlar (qoralama, jarayonda, yakunlandi) e'lonning o'z hayotiy
          davri natijasi va ularni qo'lda qo'yish ishning haqiqiy borishini
          buzardi. */}
      <AdminModal
        open={holatOpen}
        onClose={() => setHolatOpen(false)}
        title="Holatni o'zgartirish"
        footer={
          <>
            <button onClick={() => setHolatOpen(false)} {...tugma("ikkilamchi")}>
              Bekor qilish
            </button>
            <button
              onClick={() => holatniQoy(holatQiy, "Holatni o'zgartirib bo'lmadi")}
              disabled={band}
              {...tugma("asosiy", { ochiq: band })}
            >
              Saqlash
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-[18px]" style={{ color: KUL }}>
            <span className="font-semibold">{e.title || "Sarlavhasiz e'lon"}</span> —
            hozirgi holati «{elonHolatKor(e.status).matn}».
          </p>
          <Tanlov
            nomi="Yangi holat"
            qiymat={holatQiy}
            ozgardi={(v) => setHolatQiy(QOYILADIGAN.includes(v) ? v : "recruiting")}
          >
            {QOYILADIGAN.map((s) => (
              <option key={s} value={s}>
                {ELON_HOLAT[s].matn}
              </option>
            ))}
          </Tanlov>
          <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
            E&apos;lon yashirilgan bo&apos;lsa, «{ELON_HOLAT.recruiting.matn}» tanlash uni
            yashirishdan OLDINGI holatiga qaytaradi — boshlanib ketgan ish qaytadan ariza
            qabul qila boshlamaydi.
          </p>
          {amalXato && (
            <p className="text-[12px] font-medium leading-[17px]" style={{ color: QIZIL }}>
              {amalXato}
            </p>
          )}
        </div>
      </AdminModal>

      {/* Barcha arizalar. Havola `/admin/applications` ga OLIB BORMAYDI:
          o'sha sahifa manzildagi filtrni o'qimaydi va bosilgan e'lonni
          umuman ochmasdi — ya'ni havola yolg'on bo'lardi. */}
      <AdminModal
        open={arizaOpen}
        onClose={() => setArizaOpen(false)}
        title={`Arizalar (${son(arizaJami)})`}
        maxWidth="max-w-[620px]"
      >
        <div className="flex max-h-[60vh] flex-col overflow-y-auto">
          {arizalar.map((a, i) => (
            <div key={a.id}>
              {i > 0 && <Ajratgich />}
              <ArizaQatori a={a} />
            </div>
          ))}
        </div>
      </AdminModal>

      <AdminModal
        open={amalOpen}
        onClose={() => setAmalOpen(false)}
        title={`Admin amallari (${amallar.length})`}
        maxWidth="max-w-[620px]"
      >
        <div className="flex max-h-[60vh] flex-col overflow-y-auto">
          {amallar.map((a, i) => (
            <div key={`${a.at}-${a.kind}-${i}`}>
              {i > 0 && <Ajratgich />}
              <AmalYozuvi a={a} hozirgi={i === hozirgiAmal} />
            </div>
          ))}
        </div>
      </AdminModal>

      {/* Ro'yxat sahifasidagi bilan BITTA komponent — o'chirish oynasi
          panel bo'ylab bir xil ko'rinishi va bir xil tasdiq so'rashi
          kerak. `canPurge` faqat interfeys: haqiqiy qorovul serverda
          (internal/admin/deletemode.go). */}
      <DeleteModeModal
        open={ochirOpen}
        title="E'lonni o'chirish"
        what="e'lon"
        canPurge={isSuper}
        kim={{
          yorliq: "E'lon",
          nomi: e.title || "(sarlavhasiz)",
          tafsilot: [e.categoryName, e.region, elonHolatKor(e.status).matn]
            .filter(Boolean)
            .join(" · "),
        }}
        busy={band}
        error={ochirXato}
        onCancel={() => setOchirOpen(false)}
        onConfirm={ochir}
      />
    </div>
  );
}

/* ── Yordamchi komponentlar ───────────────────────────────────────── */

/**
 * Kartaning umumiy karkasi — Figma 3.5.1: V gap10, ichki chegara 18/22,
 * sarlavha (nom + xulosa) chapda, havola o'ngda, izoh eng oxirida.
 */
function Karta({
  nom,
  xulosa,
  havola,
  izoh,
  children,
}: {
  nom: string;
  xulosa?: string;
  havola?: React.ReactNode;
  izoh?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-[10px] rounded-[14px] bg-white px-[22px] py-[18px]"
      style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-[2px]">
          <h2 className="text-[14px] font-semibold leading-5" style={{ color: IK }}>
            {nom}
          </h2>
          {xulosa && (
            <p className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
              {xulosa}
            </p>
          )}
        </div>
        {havola}
      </div>
      {children}
      {izoh && (
        <p className="text-[11px] leading-4" style={{ color: XIRA_QUYUQ }}>
          {izoh}
        </p>
      )}
    </section>
  );
}

/**
 * E'lon kartasidagi ko'rsatkich katagi — Figma: 4 ta quti bir qatorda,
 * har biri qolgan joyni teng bo'lib oladi.
 */
function Stat({ yorliq, qiymat }: { yorliq: string; qiymat: string }) {
  return (
    <div
      className="flex min-w-[180px] flex-1 flex-col gap-[4px] rounded-[11px] px-[14px] py-[11px]"
      style={{ background: QUTI_FON, boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
    >
      <span className="text-[11px] leading-[15px]" style={{ color: XIRA_QUYUQ }}>
        {yorliq}
      </span>
      <span
        className="truncate text-[14px] font-semibold leading-[19px]"
        style={{ color: IK }}
        title={qiymat}
      >
        {qiymat}
      </span>
    </div>
  );
}

/**
 * "Yorliq — qiymat" qatori. Yorliq ustuni 130 px QAT'IY: qiymatlar
 * beshta kartada ham bitta chizig'da turishi kerak, aks holda ko'z har
 * kartada qiymatni qaytadan izlardi.
 *
 * `xira` — qiymat haqiqiy ma'lumot emas, halol javob ("o'chirilmagan",
 * "kiritilmagan"). Rang bilan ajratiladi, chunki "kiritilmagan" ni
 * qiymat deb o'qib qo'yish oson (Figma 3.5.1 "O'chirilgan" qatori).
 */
function Maydon({
  yorliq,
  children,
  xira,
  rang,
}: {
  yorliq: string;
  children: React.ReactNode;
  xira?: boolean;
  rang?: string;
}) {
  return (
    <div className="flex items-start gap-[10px]">
      <span
        className="w-[130px] shrink-0 text-[13px] leading-[19px]"
        style={{ color: XIRA_QUYUQ }}
      >
        {yorliq}
      </span>
      <span
        className="min-w-0 break-words text-[13px] font-medium leading-[19px]"
        style={{ color: rang || (xira ? XIRA_QUYUQ : KUL) }}
      >
        {children}
      </span>
    </div>
  );
}

/** Figma'dagi ajratgich: stroke emas, 1 px balandlikdagi to'ldirilgan yo'lak. */
function Ajratgich() {
  return <div className="h-px w-full" style={{ background: HOSHIYA }} />;
}

/**
 * Bo'sh ro'yxat yozuvi.
 *
 * Karta bo'sh bo'lsa ham chiziladi: "Ma'lumot yo'q" ham javob, va
 * bloklarning soni sahifa bo'ylab o'zgarib turmasligi kerak.
 */
function BoshHolat() {
  return (
    <p className="text-[13px] leading-[18px]" style={{ color: XIRA_QUYUQ }}>
      Ma&apos;lumot yo&apos;q
    </p>
  );
}

/**
 * Bitta ariza qatori — Figma: chapda ism, o'ngda nishon + sana.
 *
 * Qator BOSILMAYDI (Figma izohi): bu ro'yxat e'lon bilan bog'liqlikni
 * ko'rsatadi, ishchi profilining boshqaruvi esa o'z bo'limida.
 */
function ArizaQatori({ a }: { a: ArizaQatoriTuri }) {
  const kor = ARIZA_HOLAT[a.status] || {
    matn: (a.status || "").slice(0, 24) || "—",
    rang: OCH_KUL,
  };
  const ism = (a.workerName || "").trim() || "Ismsiz ishchi";
  return (
    <div className="flex items-center justify-between gap-3 py-[9px]">
      <span className="truncate text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
        {/* Guruh arizasida ishchi soni ism yonida: u `acceptedCount` ni
            bittadan ko'proq oshiradi, ya'ni moderator uchun bu son
            arizaning o'zi qadar muhim. */}
        {a.peopleCount > 1 ? `${ism}${AJR}${a.peopleCount} kishi` : ism}
      </span>
      <span className="flex shrink-0 items-center gap-[10px]">
        <ElonNishoni matn={kor.matn} rang={kor.rang} />
        <span
          className="whitespace-nowrap text-[13px] font-medium leading-[18px]"
          style={{ color: KUL }}
        >
          {sanaVaqt(a.appliedAt)}
        </span>
      </span>
    </div>
  );
}

/** Admin jurnalidagi bitta yozuv — nishon + izoh + vaqt, ostida kim. */
function AmalYozuvi({ a, hozirgi }: { a: AmalTuri; hozirgi: boolean }) {
  const kor = AMAL_TUR[a.kind] || { matn: (a.kind || "").slice(0, 24) || "—", rang: OCH_KUL };
  return (
    <div className="flex flex-col gap-[5px] py-[11px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-[9px]">
          <ElonNishoni matn={kor.matn} rang={kor.rang} />
          <span className="min-w-0 text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
            {sababMatni(a.detail)}
          </span>
          {hozirgi && <ElonNishoni matn="hozirgi holat" rang={KO_K} />}
        </div>
        <span
          className="shrink-0 whitespace-nowrap text-[12px] leading-4"
          style={{ color: XIRA_QUYUQ }}
        >
          {sanaVaqt(a.at)}
        </span>
      </div>
      <span className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
        {amalKim(a)}
      </span>
    </div>
  );
}

/**
 * Bitta shikoyat — Figma bu kartaning faqat BO'SH holatini chizgan,
 * shuning uchun to'la yozuv «Admin amallari» yozuvi karkasidan oladi:
 * nishon + sabab + vaqt, ostida kim yozgani va izohi.
 */
function ShikoyatYozuvi({ s }: { s: ShikoyatTuri }) {
  const kor = SHIKOYAT_HOLAT[s.status] || {
    matn: (s.status || "").slice(0, 24) || "—",
    rang: OCH_KUL,
  };
  const ost = [s.reporterName || "muallifi noma'lum", s.description].filter(Boolean).join(AJR);
  return (
    <div className="flex flex-col gap-[5px] py-[11px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-[9px]">
          <ElonNishoni matn={kor.matn} rang={kor.rang} />
          <span className="min-w-0 text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
            {(s.reason || "").slice(0, 120) || "Sabab ko'rsatilmagan"}
          </span>
        </div>
        <span
          className="shrink-0 whitespace-nowrap text-[12px] leading-4"
          style={{ color: XIRA_QUYUQ }}
        >
          {sanaVaqt(s.createdAt)}
        </span>
      </div>
      <span className="break-words text-[12px] leading-4" style={{ color: OCH_KUL }}>
        {ost}
      </span>
    </div>
  );
}
