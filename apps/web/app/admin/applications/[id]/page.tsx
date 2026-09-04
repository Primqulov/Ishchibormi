"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, FileText, Info, UserRound } from "lucide-react";
import { api, APIError, getAdminRole } from "@/lib/api";
import { nusxaOl } from "@/components/admin/xatoQismlar";
import {
  ARIZA_HOLAT,
  ARIZA_HOLATLARI,
  ARIZA_RANG,
  ArizaNishoni,
  KutishChipi,
  UZOQ_KUTISH_KUN,
  arizaHolatKor,
  kutishKunlari,
} from "@/components/admin/ArizaHolat";
import { ElonNishoni, elonHolatKor } from "@/components/admin/ElonHolat";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KO_K_FON,
  KUL,
  OCH_KUL,
  ORANJ,
  QIZIL,
  QUTI_FON,
  SARLAVHA_FON,
  SOYA,
  XIRA,
  XIRA_QUYUQ,
  YASHIL,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.6.1 · Ariza — batafsil (1440 × 2847)" va
          "3.6.1a · Ariza batafsil — holatlar va hodisalar (1560 × 2987)".

   Sahifa BITTA so'rovdan yashaydi: `GET /api/admin/applications/{id}`
   (apps/api/internal/admin/application_detail.go). U arizaning o'zi,
   ishchi, e'lon + egasi, e'londagi arizalar taqsimoti, shu ishchining
   boshqa arizalari va (faqat superadminga) jurnalni bir javobda beradi.

   # BU EKRAN FAQAT KO'RISH UCHUN

   Figma 3.6.1a · 7-panel: «bu sahifa arizani KO'RSATADI, unga TA'SIR
   QILMAYDI». Shuning uchun bu yerda: tasdiqlash/rad etish tugmasi yo'q,
   holatni qo'lda o'zgartirish yo'q, izoh maydoni yo'q, xabar yuborish
   yo'q, o'chirish/arxivlash yo'q. Sahifadagi HAR BIR tugma boshqa
   sahifaga olib boradi. Backend ham shu qoidada: bu yo'lda faqat `GET`.

   # DIZAYNDAN FARQLAR — MA'LUMOT MANBASI YO'Q

   Quyidagi maydonlar ATAYLAB chizilmagan, chunki ularni to'ldiradigan
   ma'lumot platformada yig'ilmaydi va "—" chizib qo'yish moderatorga
   "bo'sh" deb yolg'on gapirardi:

     · «Ish beruvchi ko'rgan» — arizani ko'rish vaqti hech qayerda
       yozilmaydi (`models.Application` da `viewedAt` yo'q). Shu sababli
       vaqt chizig'i ham 5 emas, 4 qadamdan iborat.
     · «Ishchi izohi» — ariza yuborishda faqat telefon va kishilar soni
       so'raladi (`applyReq`), izoh maydoni umuman yo'q.
     · «Guruh a'zolari» kartochkasi — guruh arizasida faqat SON saqlanadi
       (`peopleCount`), sheriklarning ro'yxati emas. Figma 3.6.1a · 4
       qoidasi shu holat uchun «kartochka umuman chizilmaydi» deydi.
     · §4 dagi «Ishga tayyor», «Tajriba», «Aloqa usuli» — ariza
       yuborishda so'ralmaydi.
     · §5 dagi «Yozuv yangilangan» — arizada `updatedAt` yo'q.

   Kartochkalar shu sababli KETMA-KET raqamlangan (1…7): bo'sh raqam
   qoldirish ("2 · …" dan keyin "4 · …") ekranda buzilgan sahifa bo'lib
   ko'rinardi.

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow.
   ───────────────────────────────────────────────────────────────────── */

/* ── Turlar (backend javobi) ──────────────────────────────────────── */

/** `models.Application` — batafsil sahifada to'liq hujjat keladi. */
interface Ariza {
  id: string;
  elonId: string;
  elonTitle: string;
  workerId: string;
  employerId: string;
  workerPhone: string;
  peopleCount: number;
  workerName: string;
  elonCategoryName: string;
  elonRegion: string;
  elonDistrict: string;
  ownerName: string;
  amount: number;
  isNegotiable: boolean;
  status: string;
  employerConfirmedDone: boolean;
  workerConfirmedDone: boolean;
  autoCompleted: boolean;
  cancelledBy: string;
  cancelReason?: string;
  appliedAt: string;
  decidedAt?: string;
  completedAt?: string;
}

/** `appWorkerBrief` — to'liq profil emas, ataylab. */
interface Ishchi {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  region?: string;
  district?: string;
  isPhoneVerified: boolean;
  isBlocked: boolean;
  isDeleted: boolean;
  createdAt: string;
  completedJobsCount: number;
  applicationsTotal: number;
}

/** `appElonBrief` — e'lonning HOZIRGI holati (arizadagi nusxa emas). */
interface ElonQisqa {
  id: string;
  title: string;
  status: string;
  isDeleted: boolean;
  categoryName?: string;
  region?: string;
  district?: string;
  locationText?: string;
  workersNeeded: number;
  acceptedCount: number;
  pricingType?: string;
  priceAmount: number;
  perWorkerAmount: number;
  publishedAt?: string;
  createdAt: string;
  ownerId: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerDeleted: boolean;
}

/** `appWorkerAppRow` — «Shu ishchining boshqa arizalari» qatori. */
interface ArizaSatri {
  id: string;
  elonId: string;
  elonTitle: string;
  categoryName: string;
  amount: number;
  isNegotiable: boolean;
  status: string;
  appliedAt: string;
}

/** `appJournalRow` — jurnaldagi bitta yozuv. */
interface JurnalYozuvi {
  kind: string;
  at: string;
  actor?: string;
  actorRole?: string;
  source: string;
  detail?: string;
}

interface Batafsil {
  application: Ariza;
  /** Hisob bazadan o'chirilgan bo'lsa `null` — bo'sh obyekt emas. */
  worker: Ishchi | null;
  /** E'lon bazadan o'chirilgan bo'lsa `null`. */
  elon: ElonQisqa | null;
  elonApplicationCounts: Record<string, number>;
  workerApplications: ArizaSatri[];
  /** Faqat superadminga to'ldiriladi; moderatorda bo'sh massiv. */
  journal: JurnalYozuvi[];
}

/* ── Doimiylar ────────────────────────────────────────────────────── */

/**
 * Ariza identifikatori — faqat 24 belgili hex (MongoDB ObjectID).
 *
 * Manzil bo'lagi brauzerdan keladi, ya'ni ixtiyoriy matn bo'lishi mumkin.
 * Shakl tekshirilmasa, har noto'g'ri manzil serverga so'rov yuborardi.
 * Ro'yxat sahifasidagi qorovul bilan bir xil.
 */
const oqOid = (v: string) => (/^[0-9a-f]{24}$/i.test(v) ? v : "");

/**
 * Figma ajratgichlari: xulosada IKKI, maydon qiymatlarida UCH bo'shliq.
 * Uzuq bo'shliq (nbsp) — HTML ketma-ket bo'shliqlarni bittaga yig'adi.
 */
const AJR = "  ·  ";
const AJR_KENG = "   ·   ";

/**
 * Ro'yxatdan uzatiladigan holat — «← Arizalar» ayni o'sha ko'rinishga
 * qaytishi uchun (Figma 3.6.1a · hodisalar: «filtr, qidiruv va sahifa
 * raqami saqlanadi»).
 *
 * # NEGA OQ RO'YXAT VA NEGA TAYYOR YO'L QABUL QILINMAYDI
 *
 * Manzildan faqat SHU to'rt kalit o'qiladi va har biri o'z shakliga
 * tekshiriladi; qaytish yo'lining o'zi («/admin/applications») shu yerda
 * yasaladi. `?kel=/istalgan/yo'l` shaklida qabul qilsak, admin panelga
 * havola yuborib uni tashqi saytga yoki `javascript:` ga yo'naltirish
 * mumkin bo'lardi — ochiq yo'naltirish teshigi.
 */
const ROYXAT_KALIT: Record<string, (v: string) => boolean> = {
  page: (v) => /^[1-9]\d{0,3}$/.test(v),
  status: (v) => ARIZA_HOLATLARI.includes(v),
  stale: (v) => v === "1",
  worker: (v) => !!oqOid(v),
};

/** To'lov turi yorliqlari — `app/admin/elons/[id]` bilan bir xil. */
const TOLOV_TURI: Record<string, string> = {
  total: "Belgilangan summa",
  per_worker: "Har bir ishchi uchun",
  negotiable: "Kelishuv",
};

/** E'londagi arizalar xulosasidagi tartib (Figma 3.6.1 · 3-bo'lim). */
const ARIZA_TARTIB = ["pending", "accepted", "rejected", "cancelled", "completed"];

/**
 * Jurnal amalining ko'rinishi — backend `appJournal*` doimiylari
 * (apps/api/internal/admin/application_detail.go).
 *
 * Ranglar `ARIZA_RANG` dan olinadi: Figma 3.6a qoidasi — «har bir holat
 * rangi butun panel bo'ylab bir xil». Qo'lda yozilganda "qabul qilindi"
 * bu jadvalda yashil, yuqoridagi nishonda ko'k bo'lib qolardi.
 */
const JURNAL_TUR: Record<string, { matn: string; rang: string }> = {
  created: { matn: "Ariza yaratildi", rang: KO_K },
  accepted: { matn: "Ish beruvchi arizani qabul qildi", rang: ARIZA_RANG.accepted },
  rejected: { matn: "Ish beruvchi arizani rad etdi", rang: ARIZA_RANG.rejected },
  cancelled: { matn: "Ariza bekor qilindi", rang: ARIZA_RANG.cancelled },
  completed: { matn: "Ish bajarilgan deb belgilandi", rang: ARIZA_RANG.completed },
  admin: { matn: "Admin amali", rang: OCH_KUL },
};

/**
 * «Manba» ustuni — yozuv qayerdan kelgani.
 *
 * `app` uchun "Mobil ilova" ATAYLAB emas: ishchi ham, ish beruvchi ham
 * saytdan (veb) foydalanishi mumkin va ariza qaysi klientdan
 * yuborilgani saqlanmaydi. "Ilova" — ikkalasini ham qamrab oladigan,
 * yolg'on bo'lmagan yorliq.
 */
const JURNAL_MANBA: Record<string, string> = {
  app: "Ilova",
  admin: "Admin panel",
  system: "Avtomatik",
};

/* ── Formatlash ───────────────────────────────────────────────────── */

const OYLAR = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/** Figma sana ko'rinishi: "27-avgust 2026". */
function sana(iso?: string | null): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return `${d.getDate()}-${OYLAR[d.getMonth()]} ${d.getFullYear()}`;
}

/** Figma sana + soat ko'rinishi: "27-avgust 2026, 14:12". */
function sanaVaqt(iso?: string | null): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sana(iso)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Ming ajratgichi — uzuq bo'shliq (Figma: "350 000"). */
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

/** Avatar o'rnidagi harflar: "Sardor Qodirov" → "SQ". */
function bosh(nom?: string): string {
  const b = (nom || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");
  return b || "?";
}

/**
 * Davomiylik — Figma "7 kun 2 soat".
 *
 * Eng kichik birlik daqiqa: sekundlarni ko'rsatish kutish muddatiga
 * hech narsa qo'shmaydi, lekin "0 daqiqa" degan g'alati qiymat beradi.
 */
function davomiylik(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const daqiqa = Math.floor(ms / 60000);
  if (daqiqa < 1) return "1 daqiqadan kam";
  const kun = Math.floor(daqiqa / 1440);
  const soat = Math.floor((daqiqa % 1440) / 60);
  const qoldiq = daqiqa % 60;
  if (kun > 0) return soat > 0 ? `${kun} kun ${soat} soat` : `${kun} kun`;
  if (soat > 0) return qoldiq > 0 ? `${soat} soat ${qoldiq} daqiqa` : `${soat} soat`;
  return `${qoldiq} daqiqa`;
}

/** Holat nomining kichik harfli shakli — xulosa satrlari uchun. */
const kichik = (s: string) => (ARIZA_HOLAT[s]?.matn || s).toLowerCase();

/** Ariza summasi: kelishiladigan arizada son ma'noga ega emas. */
function summaMatni(a: Ariza): string {
  return a.isNegotiable ? "Kelishuv asosida" : `${son(a.amount)} so'm / ishchi`;
}

/**
 * E'londagi to'lov — `pricingType` ga qarab.
 *
 * Birlik «so'm / ishchi»: bazadagi `perWorkerAmount` bitta ishchiga
 * to'lanadigan summa. Figma'da "so'm / kun" yozilgan, lekin qiymat
 * kunlik EMAS — noto'g'ri birlik ma'lumotni buzib ko'rsatardi (arizalar
 * ro'yxatidagi izoh bilan bir xil sabab).
 */
function elonNarxMatni(e: ElonQisqa): string {
  if (e.pricingType === "negotiable") return "Kelishuv asosida";
  if (e.pricingType === "total") return `${son(e.priceAmount)} so'm (jami)`;
  return `${son(e.perWorkerAmount)} so'm / ishchi`;
}

/**
 * Ariza summasini e'lon narxi bilan solishtirish (Figma «Farq» qatori).
 *
 * Faqat `per_worker` e'lonida hisoblanadi: `total` narx butun ish uchun,
 * ariza summasi esa bitta ishchi uchun — ularni ayirish ikki xil
 * o'lchovni qo'shish bo'lardi va moderator "arzon" degan yolg'on
 * xulosani ekrandan o'qib olardi.
 */
function narxFarqi(a: Ariza, e: ElonQisqa | null): { matn: string; rang: string } | null {
  if (!e || a.isNegotiable || e.pricingType !== "per_worker") return null;
  if (!e.perWorkerAmount || !a.amount) return null;
  const farq = a.amount - e.perWorkerAmount;
  if (farq === 0) return { matn: "0 so'm — narx teng", rang: YASHIL };
  if (farq < 0) return { matn: `${son(-farq)} so'm arzon`, rang: YASHIL };
  return { matn: `${son(farq)} so'm qimmat`, rang: QIZIL };
}

/** Bekor qilgan tomonning yorlig'i. Bo'sh bo'lsa — taxmin qilinmaydi. */
const BEKOR_KIM: Record<string, string> = {
  worker: "ishchi",
  employer: "ish beruvchi",
};

/* ── Vaqt chizig'i ────────────────────────────────────────────────── */

type QadamHolat = "tugadi" | "joriy" | "kelgusi";

interface Qadam {
  nom: string;
  izoh: string;
  holat: QadamHolat;
  rang: string;
}

/**
 * Arizaning yo'li — Figma 3.6.1 · 1-bo'lim.
 *
 * Dizaynda besh qadam: yuborildi → ish beruvchi ko'rdi → javob →
 * qabul/rad → yakun. IKKINCHI qadam bu yerda YO'Q: arizani ko'rish vaqti
 * saqlanmaydi (fayl boshidagi izohga qarang), ya'ni u qadamni chizsak
 * uning ostida hech qachon sana turmasdi.
 *
 * Har bir qadamning matni faqat MAVJUD ma'lumotdan yasaladi: kelgusi
 * qadamlarda sana o'rniga "nima bo'lishi" yoziladi, taxminiy sana emas.
 */
function arizaYoli(a: Ariza): Qadam[] {
  const ishchi = (a.workerName || "").trim();
  const beruvchi = (a.ownerName || "").trim();
  const kun = kutishKunlari(a.appliedAt);
  const bajarilgan = a.status === "completed";
  const qabul = a.status === "accepted" || bajarilgan;
  const yopilgan = a.status === "rejected" || a.status === "cancelled";

  const qadamlar: Qadam[] = [
    {
      nom: "Ishchi ariza yubordi",
      izoh: [sanaVaqt(a.appliedAt), ishchi].filter(Boolean).join(AJR),
      holat: "tugadi",
      rang: KO_K,
    },
  ];

  if (qabul) {
    qadamlar.push({
      nom: "Ish beruvchi arizani qabul qildi",
      izoh: [sanaVaqt(a.decidedAt), beruvchi].filter(Boolean).join(AJR),
      holat: "tugadi",
      rang: KO_K,
    });
  } else if (a.status === "rejected") {
    qadamlar.push({
      nom: "Ish beruvchi arizani rad etdi",
      izoh: [sanaVaqt(a.decidedAt), beruvchi, (a.cancelReason || "").trim()]
        .filter(Boolean)
        .join(AJR),
      holat: "joriy",
      rang: QIZIL,
    });
  } else if (a.status === "cancelled") {
    qadamlar.push({
      nom: "Ariza bekor qilindi",
      izoh: [
        sanaVaqt(a.decidedAt),
        BEKOR_KIM[a.cancelledBy] ? `bekor qilgan: ${BEKOR_KIM[a.cancelledBy]}` : "",
        (a.cancelReason || "").trim(),
      ]
        .filter(Boolean)
        .join(AJR),
      holat: "joriy",
      rang: OCH_KUL,
    });
  } else {
    qadamlar.push({
      nom: "Ish beruvchi javobi kutilmoqda",
      izoh: `${kun > 0 ? `${kun} kundan beri kutmoqda` : "bugun yuborilgan"}${AJR}qarorni faqat ish beruvchi qabul qiladi — admin aralashmaydi`,
      holat: "joriy",
      rang: ORANJ,
    });
  }

  const tasdiq = [
    a.workerConfirmedDone ? "ishchi tasdiqladi" : "ishchi hali tasdiqlamagan",
    a.employerConfirmedDone ? "ish beruvchi tasdiqladi" : "ish beruvchi hali tasdiqlamagan",
  ].join(AJR);

  if (bajarilgan) {
    qadamlar.push({
      nom: "Ish bajarildi",
      izoh: tasdiq,
      holat: "tugadi",
      rang: YASHIL,
    });
    qadamlar.push({
      nom: "Yakunlandi — yakuniy holat",
      izoh: [
        sanaVaqt(a.completedAt),
        a.autoCompleted ? "tizim avtomatik yakunladi" : beruvchi,
      ]
        .filter(Boolean)
        .join(AJR),
      holat: "tugadi",
      rang: YASHIL,
    });
    return qadamlar;
  }

  qadamlar.push({
    nom: qabul ? "Ish bajarilishi kutilmoqda" : "Ish bajarilishi",
    izoh: yopilgan
      ? "Ariza yopilgani uchun bu qadam bo'lmaydi"
      : qabul
        ? tasdiq
        : "Ariza qabul qilinsa, ishni ishchi va ish beruvchi tasdiqlaydi",
    holat: qabul ? "joriy" : "kelgusi",
    rang: KO_K,
  });
  qadamlar.push({
    nom: "Yakunlandi — yakuniy holat",
    izoh: yopilgan
      ? "Ariza yopildi — bu qadamga yetmadi"
      : "Ish tugagach ish beruvchi belgilaydi; ariza arxivga o'tadi",
    holat: "kelgusi",
    rang: YASHIL,
  });
  return qadamlar;
}

/* ── Sahifa ───────────────────────────────────────────────────────── */

/**
 * `useSearchParams` va `useParams` Suspense chegarasini talab qiladi
 * (Next App Router). `fallback` bo'sh — «Yuklanmoqda…» skeleti ichkarida.
 */
export default function AdminArizaBatafsil() {
  return (
    <Suspense fallback={null}>
      <ArizaBatafsil />
    </Suspense>
  );
}

function ArizaBatafsil() {
  const params = useParams<{ id: string | string[] }>();
  // `useParams` massiv qaytarishi mumkin (catch-all yo'llar). Bitta
  // qiymatga keltiramiz: aks holda so'rov yo'liga "a,b" tushardi.
  const xomId = params?.id;
  const id = oqOid((Array.isArray(xomId) ? xomId[0] : xomId) || "");
  const router = useRouter();
  const qidiruv = useSearchParams();

  /* Ro'yxat holati — qaytish havolasi ham, qo'shni arizaga o'tish ham
     shu satrni olib yuradi, ya'ni zanjirning oxirida ham «← Arizalar»
     admin qoldirgan filtrga qaytaradi. */
  const holatSatri = useMemo(() => {
    const out = new URLSearchParams();
    for (const [kalit, ok] of Object.entries(ROYXAT_KALIT)) {
      const v = (qidiruv?.get(kalit) || "").trim();
      if (v && ok(v)) out.set(kalit, v);
    }
    return out.toString();
  }, [qidiruv]);
  const royxatHavola = holatSatri ? `/admin/applications?${holatSatri}` : "/admin/applications";
  const arizaHavola = useCallback(
    (v: string) =>
      `/admin/applications/${encodeURIComponent(v)}${holatSatri ? `?${holatSatri}` : ""}`,
    [holatSatri],
  );

  const [d, setD] = useState<Batafsil | null>(null);
  const [xato, setXato] = useState("");
  const [xatoKodi, setXatoKodi] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  /**
   * So'rov navbati — kechikib kelgan javob yangisini bosib ketmasin.
   * Sahifa fokus qaytganda qayta yuklanadi, ya'ni ikki so'rov bir vaqtda
   * yo'lda bo'lishi mumkin.
   */
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setXatoKodi("bad_id");
      setXato("Ariza manzili noto'g'ri");
      return;
    }
    const raqam = ++soravRaqami.current;
    try {
      const javob = await api.get<Batafsil>(
        `/api/admin/applications/${encodeURIComponent(id)}`,
        { auth: "admin" } as any,
      );
      if (raqam !== soravRaqami.current) return;
      setD(javob);
      setXato("");
      setXatoKodi("");
    } catch (e) {
      if (raqam !== soravRaqami.current) return;
      // Xom javob tanasi EMAS — faqat backendning tayyor xabari va kodi.
      setXatoKodi((e as APIError)?.code || "");
      setXato((e as APIError)?.message || "Ma'lumotni yuklab bo'lmadi");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Rol faqat ko'rinishni boshqaradi — jurnalni serverning o'zi ham
  // superadmindan boshqasiga to'ldirmaydi (application_detail.go).
  useEffect(() => {
    setIsSuper(getAdminRole() === "superadmin");
  }, []);

  /* Figma 3.6.1a · hodisalar: «avtomatik yangilanish yo'q, lekin sahifaga
     qaytilganda ma'lumot qayta o'qiladi». Kutish muddati real vaqtda
     o'sadigan yagona qiymat — u ham shu yerda yangilanadi. */
  useEffect(() => {
    function qaytdi() {
      load();
    }
    window.addEventListener("focus", qaytdi);
    return () => window.removeEventListener("focus", qaytdi);
  }, [load]);

  /* Esc — ro'yxatga qaytaradi (Figma 3.6.1a · hodisalar). Sahifada oyna
     (modal) yo'q, ya'ni Esc boshqa hech narsani yopmaydi. */
  useEffect(() => {
    function tugma(ev: KeyboardEvent) {
      if (ev.key === "Escape") router.push(royxatHavola);
    }
    window.addEventListener("keydown", tugma);
    return () => window.removeEventListener("keydown", tugma);
  }, [router, royxatHavola]);

  const karta: React.CSSProperties = { boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` };

  const ortga = (
    <Link
      href={royxatHavola}
      title="Arizalar ro'yxatiga qaytish"
      className="inline-flex w-fit items-center gap-[7px] text-[13px] font-medium leading-[18px] hover:underline"
      style={{ color: OCH_KUL }}
    >
      <ArrowLeft size={15} aria-hidden />
      Arizalar
    </Link>
  );

  /* Xato holatlari — Figma 3.6.1a · 2-panel. Uchtasi boshqa-boshqa
     harakat talab qiladi, shuning uchun matn ham boshqa: topilmagan
     arizada «qayta urinish» ma'nosiz, ruxsat yo'qligida esa u
     chalg'ituvchi. */
  if (!d && xato) {
    const topilmadi = xatoKodi === "not_found" || xatoKodi === "bad_id";
    const ruxsatYoq = xatoKodi === "forbidden";
    return (
      <div className="flex flex-col gap-4">
        {ortga}
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-2 rounded-[14px] bg-white px-5 py-[64px] text-center"
          style={karta}
        >
          <p
            className="text-[15px] font-semibold leading-5"
            style={{ color: topilmadi ? IK : QIZIL }}
          >
            {topilmadi ? "Ariza topilmadi" : ruxsatYoq ? "Ruxsat yo'q" : "Server javob bermadi"}
          </p>
          <p className="max-w-[520px] text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            {topilmadi
              ? "Bu ariza o'chirilgan yoki manzil noto'g'ri. Ro'yxatdan qaytadan tanlang."
              : ruxsatYoq
                ? "Arizalar bo'limini faqat superadmin va moderator ko'radi."
                : "Ma'lumotni yuklab bo'lmadi. Qaytadan urinib ko'ring."}
          </p>
          <p className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
            {xato}
          </p>
          {!topilmadi && !ruxsatYoq && (
            <button
              type="button"
              onClick={load}
              className="mt-1 inline-flex h-9 select-none items-center justify-center rounded-[9px] px-4 text-[13px] font-semibold leading-[18px] text-white transition-colors hover:brightness-95"
              style={{ background: KO_K }}
            >
              Qayta urinish
            </button>
          )}
        </div>
      </div>
    );
  }

  /* Yuklanmoqda — Figma 3.6.1a · 2: sarlavha kartasi + uchta blok
     skeleti. Bloklar bittalab paydo bo'lmaydi va balandlik ham
     o'zgarmaydi: javob kelganda sahifa sakramaydi. */
  if (!d) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        {ortga}
        <span className="sr-only">Ariza yuklanmoqda…</span>
        <div className="h-[214px] animate-pulse rounded-[14px] bg-white" style={karta} aria-hidden />
        {[168, 220, 196].map((h, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[14px] bg-white"
            style={{ ...karta, height: h }}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  const a = d.application;
  const ishchi = d.worker;
  const e = d.elon;
  const sanoq = d.elonApplicationCounts ?? {};
  const boshqalar = d.workerApplications ?? [];
  const jurnal = d.journal ?? [];

  const holat = arizaHolatKor(a.status);
  const kun = a.status === "pending" ? kutishKunlari(a.appliedAt) : 0;
  const guruh = a.peopleCount > 1;

  const ishchiIsmi =
    (ishchi ? `${ishchi.firstName || ""} ${ishchi.lastName || ""}`.trim() : "") ||
    (a.workerName || "").trim();
  const ishchiTel = (ishchi?.phone || a.workerPhone || "").trim();
  // Figma 3.6.1a · 4: ism bo'lmasa TELEFON asosiy identifikator bo'ladi.
  const sarlavha = ishchiIsmi || telefon(ishchiTel) || "Ismsiz ishchi";

  /* «Oxirgi o'zgarish» — arizada `updatedAt` yo'q, shuning uchun u
     mavjud vaqt belgilarining eng kechikkanidan hisoblanadi. Bu
     taxmin emas: holatni faqat shu uchta hodisa o'zgartiradi. */
  const oxirgi = [a.completedAt, a.decidedAt, a.appliedAt]
    .map((v) => Date.parse(v || ""))
    .filter((t) => Number.isFinite(t))
    .sort((x, y) => y - x)[0];

  /* Kutish muddati: «Kutilmoqda» da real vaqtda o'sadi, boshqa
     holatlarda javob berilgan paytda QOTIB qoladi (Figma 3.6.1 · 5
     izohi).

     Javob vaqti yo'q bo'lsa (holat o'zgargan, lekin `decidedAt`
     yozilmagan g'alati yozuv) natija NaN bo'ladi va ekranda "—"
     chiqadi: yuborilgan vaqtni javob vaqti deb hisoblab "1 daqiqadan
     kam" yozish o'ylab topilgan qiymat bo'lardi. */
  const kutishOxiri =
    a.status === "pending" ? Date.now() : Date.parse(a.decidedAt || a.completedAt || "");
  const kutishMs = kutishOxiri - Date.parse(a.appliedAt);

  const elonJami = Object.values(sanoq).reduce((s, n) => s + (n || 0), 0);
  const elonTaqsim = ARIZA_TARTIB.filter((s) => (sanoq[s] || 0) > 0)
    .map((s) => `${son(sanoq[s])} ${kichik(s)}`)
    .join(AJR);

  const qadamlar = arizaYoli(a);
  const hozirgiQadam = qadamlar.reduce(
    (n, q, i) => (q.holat === "kelgusi" ? n : i + 1),
    1,
  );

  const farq = narxFarqi(a, e);
  const elonKor = e ? elonHolatKor(e.status) : null;

  const elonTugma = tugma("ikkilamchi");
  const ishchiTugma = tugma("ikkilamchi");

  return (
    <div className="flex flex-col gap-4">
      {ortga}

      {/* ── Sarlavha kartasi (Figma 3.6.1 boshi) ─────────────────────── */}
      <section className="flex flex-col gap-[14px] rounded-[14px] bg-white px-[22px] py-[18px]" style={karta}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-[6px]">
            <div className="flex flex-wrap items-center gap-[10px]">
              <h1 className="text-[18px] font-bold leading-6" style={{ color: IK }}>
                {sarlavha}
              </h1>
              <ArizaNishoni {...holat} />
              {/* Chip FAQAT «Kutilmoqda» da va chegaradan keyin — arizalar
                  ro'yxatidagi shart bilan bir xil (Figma 3.6.1a · 3). */}
              {kun >= UZOQ_KUTISH_KUN && <KutishChipi kun={kun} />}
            </div>
            <div
              className="flex flex-wrap items-center gap-y-[2px] text-[13px] leading-[18px]"
              style={{ color: OCH_KUL }}
            >
              <span className="truncate font-medium" style={{ color: KUL }}>
                {a.elonTitle || "(sarlavhasiz e'lon)"}
              </span>
              {[
                (e?.district || a.elonDistrict || "").trim(),
                (e?.categoryName || a.elonCategoryName || "").trim(),
                guruh ? `Guruh arizasi${AJR}${son(a.peopleCount)} kishi` : "Yakka ariza",
              ]
                .filter(Boolean)
                // Kalit sifatida indeks: tuman va turkum nomi bir xil
                // bo'lib qolishi mumkin ("Yuk tashish"), matnni kalit
                // qilsak React takroriy kalitdan ogohlantirardi.
                .map((v, i) => (
                  <span key={i}>
                    {AJR}
                    {v}
                  </span>
                ))}
              <span className="flex items-center">
                {AJR_KENG}
                <span className="mr-[6px]">Ariza ID</span>
                <Nusxa qiymat={a.id} izoh="Ariza ID sini nusxalash" />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-[10px]">
            {/* Ikkala tugma ham BOSHQA sahifaga olib boradi — bu ekranda
                amal bajaradigan tugma yo'q (Figma 3.6.1a · 7). */}
            {e ? (
              <Link
                href={`/admin/elons/${encodeURIComponent(e.id)}?kel=ariza&ariza=${encodeURIComponent(a.id)}`}
                className={elonTugma.className}
                style={elonTugma.style}
                title="E'lonning batafsil sahifasi"
              >
                <FileText size={15} aria-hidden />
                E&apos;lonni ko&apos;rish
              </Link>
            ) : (
              <span
                {...tugma("ikkilamchi", { ochiq: true })}
                title="E'lon bazadan o'chirilgan — ochib bo'lmaydi"
              >
                <FileText size={15} aria-hidden />
                E&apos;lonni ko&apos;rish
              </span>
            )}
            {ishchi ? (
              <Link
                href={`/admin/users/${encodeURIComponent(ishchi.id)}`}
                className={ishchiTugma.className}
                style={ishchiTugma.style}
                title="Ishchining profil sahifasi"
              >
                <UserRound size={15} aria-hidden />
                Ishchi profili
              </Link>
            ) : (
              <span
                {...tugma("ikkilamchi", { ochiq: true })}
                title="Ishchi hisobi o'chirilgan — profil ochilmaydi"
              >
                <UserRound size={15} aria-hidden />
                Ishchi profili
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-[10px]">
          <Stat yorliq="So'ralgan summa" qiymat={summaMatni(a)} />
          <Stat
            yorliq={a.status === "pending" ? "Kutish muddati" : "Javobgacha kutildi"}
            qiymat={davomiylik(kutishMs)}
          />
          <Stat
            yorliq="Ishchilar soni"
            qiymat={guruh ? `${son(a.peopleCount)} kishi` : "1 kishi (yakka)"}
          />
          <Stat
            yorliq="E'lon holati"
            qiymat={
              e && elonKor
                ? `${elonKor.matn}${elonJami ? `${AJR}${son(elonJami)} ta ariza` : ""}`
                : "E'lon o'chirilgan"
            }
          />
        </div>

        <div className="flex flex-col gap-[3px]">
          <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            Yuborilgan:{" "}
            <span className="font-semibold" style={{ color: IK }}>
              {sanaVaqt(a.appliedAt)}
            </span>
          </p>
          <p className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
            Oxirgi o&apos;zgarish: {sanaVaqt(oxirgi ? new Date(oxirgi).toISOString() : null)}
            {AJR}Asia/Tashkent
          </p>
        </div>
      </section>

      {/* ── Faqat ko'rish uchun banneri (Figma 3.6.1) ────────────────── */}
      <div
        className="flex items-start gap-[10px] rounded-[12px] px-[18px] py-[13px] text-[13px] leading-[18px]"
        style={{ background: KO_K_FON, boxShadow: `inset 0 0 0 1px #dce9ff`, color: KO_K }}
      >
        <Info size={16} className="mt-[1px] shrink-0" aria-hidden />
        <p>
          Bu sahifa faqat ko&apos;rish uchun. Admin arizani tasdiqlay ham, rad eta ham olmaydi —
          holatni ishchi va ish beruvchi o&apos;zgartiradi. Bu yerdagi barcha tugmalar boshqa
          sahifaga olib boradi.
        </p>
      </div>

      {/* ── 1 · Ariza yo'li ─────────────────────────────────────────── */}
      <Karta
        nom="1 · Ariza yo'li (vaqt chizig'i)"
        xulosa="Har bir qadamni kim bajargani va qachon bo'lgani"
        havola={
          <span
            className="shrink-0 whitespace-nowrap text-[12px] font-medium leading-4"
            style={{ color: ARIZA_RANG[a.status] || OCH_KUL }}
          >
            Hozirgi qadam: {hozirgiQadam} / {qadamlar.length}
          </span>
        }
        izoh="Vaqt chizig'ida arizani ko'rish qadami yo'q: ish beruvchi arizani qachon ko'rgani platformada saqlanmaydi."
      >
        <div className="flex flex-col pt-[2px]">
          {qadamlar.map((q, i) => (
            <QadamQatori key={q.nom} q={q} chiziq={i < qadamlar.length - 1} />
          ))}
        </div>
      </Karta>

      {/* ── 2 · Ishchi ──────────────────────────────────────────────── */}
      <Karta
        nom="2 · Ishchi — arizani yuborgan"
        xulosa={
          ishchi
            ? "Ma'lumot ishchi profilidan olinadi; bu yerda tahrirlanmaydi"
            : "Hisob bazadan o'chirilgan — quyidagi ma'lumot ariza yozuvidagi nusxadan"
        }
        havola={ishchi ? <Havola href={`/admin/users/${encodeURIComponent(ishchi.id)}`}>Profilni ko&apos;rish</Havola> : undefined}
        izoh="Ishchi ismini kiritmagan bo'lsa, telefon raqami asosiy identifikator bo'lib qoladi."
      >
        <div className="flex items-center gap-[12px]">
          <span
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-[13px] font-semibold"
            style={{ background: AVATAR_FON, color: KO_K }}
            aria-hidden
          >
            {bosh(ishchiIsmi || ishchiTel)}
          </span>
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span
              className="truncate text-[14px] font-semibold leading-[19px]"
              style={{ color: ishchiIsmi ? IK : XIRA_QUYUQ }}
            >
              {ishchiIsmi || "Ism ko'rsatilmagan"}
            </span>
            <span className="truncate text-[12px] leading-4" style={{ color: OCH_KUL }}>
              {[telefon(ishchiTel), (ishchi?.region || "").trim(), (ishchi?.district || "").trim()]
                .filter(Boolean)
                .join(AJR) || "Qo'shimcha ma'lumot yo'q"}
            </span>
          </span>
        </div>
        <Ajratgich />
        <div className="flex flex-col gap-[7px]">
          <Maydon yorliq="Telefon">
            {ishchiTel ? (
              <Nusxa qiymat={ishchiTel} korinish={telefon(ishchiTel)} izoh="Telefon raqamini nusxalash" />
            ) : (
              <span style={{ color: XIRA_QUYUQ }}>Kiritilmagan</span>
            )}
          </Maydon>
          <Maydon yorliq="Viloyat / tuman" xira={!ishchi?.region}>
            {[ishchi?.region, ishchi?.district].filter(Boolean).join(AJR) || "Ko'rsatilmagan"}
          </Maydon>
          <Maydon yorliq="Ro'yxatdan o'tgan" xira={!ishchi}>
            {ishchi ? sanaVaqt(ishchi.createdAt) : "Ma'lum emas"}
          </Maydon>
          <Maydon
            yorliq="Profil holati"
            rang={
              !ishchi
                ? OCH_KUL
                : ishchi.isDeleted
                  ? OCH_KUL
                  : ishchi.isBlocked
                    ? QIZIL
                    : YASHIL
            }
          >
            {ishchi
              ? [
                  ishchi.isDeleted ? "O'chirilgan" : ishchi.isBlocked ? "Bloklangan" : "Faol",
                  ishchi.isPhoneVerified ? "telefon tasdiqlangan" : "telefon tasdiqlanmagan",
                ].join(AJR_KENG)
              : "Hisob bazadan o'chirilgan"}
          </Maydon>
          <Maydon yorliq="Jami arizalari" xira={!ishchi}>
            {ishchi ? `${son(ishchi.applicationsTotal)} ta` : "Ma'lum emas"}
          </Maydon>
          <Maydon yorliq="Bajargan ishlari" xira={!ishchi}>
            {ishchi ? `${son(ishchi.completedJobsCount)} ta` : "Ma'lum emas"}
          </Maydon>
          <Maydon yorliq="Ishchi ID">
            <Nusxa qiymat={a.workerId} izoh="Ishchi ID sini nusxalash" />
          </Maydon>
        </div>
      </Karta>

      {/* ── 3 · E'lon ───────────────────────────────────────────────── */}
      <Karta
        nom="3 · E'lon — ariza shu e'longa yuborilgan"
        xulosa="E'lon o'zgarsa, bu blok ham yangilanadi — nusxa saqlanmaydi"
        havola={
          e ? (
            <Havola
              href={`/admin/elons/${encodeURIComponent(e.id)}?kel=ariza&ariza=${encodeURIComponent(a.id)}`}
            >
              E&apos;lonni ochish
            </Havola>
          ) : undefined
        }
        izoh="E'lon o'chirilgan bo'lsa, nomi o'rnida kulrang matn chiqadi va «E'lonni ochish» havolasi ko'rsatilmaydi. Ariza yozuvi baribir saqlanadi."
      >
        <div className="flex flex-wrap items-center gap-[10px]">
          <h3
            className="min-w-0 truncate text-[15px] font-semibold leading-[21px]"
            style={{ color: e ? IK : XIRA_QUYUQ }}
          >
            {e ? e.title || "(sarlavhasiz)" : a.elonTitle || "E'lon o'chirilgan"}
          </h3>
          {e && elonKor && <ElonNishoni {...elonKor} />}
          {e?.isDeleted && (
            <span className="text-[12px] leading-4" style={{ color: QIZIL }}>
              yashirilgan
            </span>
          )}
        </div>
        {e ? (
          <div className="flex flex-col gap-[7px]">
            <Maydon yorliq="Turkum" xira={!e.categoryName}>
              {e.categoryName || "Ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Manzil" xira={!e.region && !e.locationText}>
              {[e.region, e.district].filter(Boolean).join(AJR) ||
                (e.locationText || "").trim() ||
                "Ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Ish beruvchi" xira={!e.ownerName}>
              {e.ownerName || "Ism ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Ish beruvchi telefoni" xira={!e.ownerPhone}>
              {e.ownerPhone ? (
                <Nusxa
                  qiymat={e.ownerPhone}
                  korinish={telefon(e.ownerPhone)}
                  izoh="Ish beruvchi telefonini nusxalash"
                />
              ) : e.ownerDeleted ? (
                "Ish beruvchi o'chirilgan"
              ) : (
                "Kiritilmagan"
              )}
            </Maydon>
            <Maydon yorliq="E'londagi to'lov">{elonNarxMatni(e)}</Maydon>
            <Maydon yorliq="Kerakli ishchilar">
              {son(e.workersNeeded)} kishi ({son(e.acceptedCount)} tasi to&apos;ldirilgan)
            </Maydon>
            <Maydon yorliq="E'lon berilgan">{sanaVaqt(e.publishedAt || e.createdAt)}</Maydon>
            <Maydon yorliq="E'londagi arizalar" xira={!elonJami}>
              {elonJami ? `${son(elonJami)} ta${elonTaqsim ? ` (${elonTaqsim})` : ""}` : "Ariza yo'q"}
            </Maydon>
            <Maydon yorliq="E'lon ID">
              <Nusxa qiymat={e.id} izoh="E'lon ID sini nusxalash" />
            </Maydon>
          </div>
        ) : (
          <div className="flex flex-col gap-[7px]">
            <p className="text-[13px] leading-[18px]" style={{ color: XIRA_QUYUQ }}>
              E&apos;lon bazadan o&apos;chirilgan. Quyidagi ma&apos;lumot ariza yozuvidagi
              nusxadan olingan.
            </p>
            <Maydon yorliq="Turkum" xira={!a.elonCategoryName}>
              {a.elonCategoryName || "Ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Manzil" xira={!a.elonRegion}>
              {[a.elonRegion, a.elonDistrict].filter(Boolean).join(AJR) || "Ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Ish beruvchi" xira={!a.ownerName}>
              {a.ownerName || "Ism ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="E'lon ID">
              <Nusxa qiymat={a.elonId} izoh="E'lon ID sini nusxalash" />
            </Maydon>
          </div>
        )}
      </Karta>

      {/* ── 4 · Ariza shartlari ─────────────────────────────────────── */}
      <Karta
        nom="4 · Ariza shartlari va so'ralgan summa"
        xulosa="Bu maydonlarni ishchi ariza yuborishda kiritadi"
        havola={
          <span
            className="shrink-0 whitespace-nowrap text-[12px] leading-4"
            style={{ color: XIRA_QUYUQ }}
          >
            Manba: ishchi kiritgan
          </span>
        }
        izoh="Ariza yuborishda ishchidan faqat telefon va kishilar soni so'raladi — «ishga tayyor», «tajriba» va «aloqa usuli» maydonlari platformada yig'ilmaydi."
      >
        <div className="flex flex-wrap items-start gap-[18px]">
          <div className="flex min-w-[280px] flex-1 flex-col gap-[7px]">
            <Maydon yorliq="To'lov turi" xira={!e?.pricingType}>
              {(e && TOLOV_TURI[e.pricingType || ""]) || "E'londa ko'rsatilmagan"}
            </Maydon>
            <Maydon yorliq="Kelishuv asosida">{a.isNegotiable ? "Ha" : "Yo'q"}</Maydon>
            <Maydon yorliq="Ariza turi">
              {guruh ? `Guruh arizasi${AJR}${son(a.peopleCount)} kishi` : "Yakka ariza"}
            </Maydon>
            <Maydon yorliq="Holat">
              <span style={{ color: ARIZA_RANG[a.status] || KUL }}>{holat.matn}</span>
            </Maydon>
            {a.status === "cancelled" && (
              <Maydon yorliq="Bekor qilgan" xira={!BEKOR_KIM[a.cancelledBy]}>
                {BEKOR_KIM[a.cancelledBy] || "Ko'rsatilmagan"}
              </Maydon>
            )}
            {!!(a.cancelReason || "").trim() && (
              <Maydon yorliq="Sabab">{(a.cancelReason || "").slice(0, 200)}</Maydon>
            )}
            <Maydon yorliq="Ariza ID">
              <Nusxa qiymat={a.id} izoh="Ariza ID sini nusxalash" />
            </Maydon>
          </div>

          {/* Summa kartasi — Figma: o'ng chetda alohida quti. */}
          <div
            className="flex w-full min-w-[280px] max-w-[340px] flex-col gap-[10px] rounded-[12px] px-[16px] py-[14px] sm:w-auto sm:flex-1"
            style={{ background: QUTI_FON, boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
          >
            <span
              className="text-[11px] font-semibold uppercase leading-[15px] tracking-[0.04em]"
              style={{ color: XIRA_QUYUQ }}
            >
              So&apos;ralgan summa
            </span>
            {a.isNegotiable ? (
              <span
                className="inline-flex w-fit items-center rounded-[8px] px-[10px] py-[5px] text-[13px] font-medium leading-[18px]"
                style={{ background: AVATAR_FON, color: KUL }}
              >
                Kelishuv asosida
              </span>
            ) : (
              <span className="flex items-baseline gap-[7px]">
                <span className="text-[26px] font-bold leading-[32px]" style={{ color: IK }}>
                  {son(a.amount)}
                </span>
                <span className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
                  so&apos;m / ishchi
                </span>
              </span>
            )}
            <Ajratgich />
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
                E&apos;londagi narx
              </span>
              <span
                className="text-right text-[12px] font-medium leading-4"
                style={{ color: e ? KUL : XIRA_QUYUQ }}
              >
                {e ? elonNarxMatni(e) : "E'lon o'chirilgan"}
              </span>
            </div>
            {/* «Farq» faqat solishtirish MA'NOLI bo'lganda chiziladi —
                `narxFarqi` izohiga qarang. */}
            {farq && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-[12px] leading-4" style={{ color: XIRA_QUYUQ }}>
                  Farq
                </span>
                <span
                  className="text-right text-[12px] font-medium leading-4"
                  style={{ color: farq.rang }}
                >
                  {farq.matn}
                </span>
              </div>
            )}
          </div>
        </div>
      </Karta>

      {/* ── 5 · Vaqt belgilari ──────────────────────────────────────── */}
      <Karta
        nom="5 · Vaqt belgilari"
        xulosa="Toshkent vaqti (UTC+5) · CSV eksportda ISO 8601 formatida chiqadi"
        havola={
          <span
            className="shrink-0 whitespace-nowrap text-[12px] leading-4"
            style={{ color: XIRA_QUYUQ }}
          >
            6 ta belgi
          </span>
        }
        izoh="«Kutish davomiyligi» faqat «Kutilmoqda» holatida o'sib boradi; javob berilgandan keyin qotib qoladi. Arizada «yozuv yangilangan» belgisi yo'q — hujjat tahrirlanmaydi."
      >
        <div className="flex flex-wrap gap-[10px]">
          <Stat yorliq="Ariza yuborilgan" qiymat={sanaVaqt(a.appliedAt)} />
          <Stat
            yorliq="Holat oxirgi o'zgargan"
            qiymat={sanaVaqt(oxirgi ? new Date(oxirgi).toISOString() : null)}
          />
          <Stat
            yorliq="Kutish davomiyligi"
            qiymat={davomiylik(kutishMs)}
            rang={a.status === "pending" ? ORANJ : undefined}
          />
          <Stat
            yorliq="Javob berilgan"
            qiymat={a.decidedAt ? sanaVaqt(a.decidedAt) : "Hali yo'q"}
            xira={!a.decidedAt}
          />
          <Stat
            yorliq="Ariza yopilgan"
            qiymat={a.completedAt ? sanaVaqt(a.completedAt) : "Hali yo'q"}
            xira={!a.completedAt}
          />
          <Stat
            yorliq="Bekor qilingan"
            qiymat={a.status === "cancelled" ? sanaVaqt(a.decidedAt) : "—"}
            xira={a.status !== "cancelled"}
          />
        </div>
      </Karta>

      {/* ── 6 · Shu ishchining boshqa arizalari ─────────────────────── */}
      {/* Figma'da sarlavha «boshqa arizalari (3)» va jadvalda 3 qator —
          lekin qatorlarning biri HOZIRGI ariza. Ya'ni son «boshqa»
          arizalarning soni emas. Shuning uchun so'z olib tashlangan:
          sarlavhadagi son jadvaldagi qatorlar soniga teng bo'lib
          qolsin, aks holda "3 ta" yozib 4 qator chizilardi. */}
      <Karta
        nom={`6 · Shu ishchining arizalari (${son(boshqalar.length)})`}
        xulosa="Oxirgi arizalar · hozirgi ariza ham ro'yxatda turadi, lekin havola emas"
        havola={
          oqOid(a.workerId) ? (
            <Havola href={`/admin/applications?worker=${encodeURIComponent(a.workerId)}`}>
              Barchasini ko&apos;rish
            </Havola>
          ) : undefined
        }
      >
        {boshqalar.length <= 1 ? (
          <p className="text-[13px] leading-[18px]" style={{ color: XIRA_QUYUQ }}>
            Bu ishchining boshqa arizasi yo&apos;q. Hozirgi ariza ro&apos;yxatda qoladi, lekin
            havola emas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div
                className="flex items-center rounded-[8px] px-[12px] py-[7px] text-[11px] font-semibold leading-[15px]"
                style={{ background: SARLAVHA_FON, color: KUL }}
              >
                <span className="min-w-0 flex-1 truncate pr-3">E&apos;lon</span>
                <span className="w-[150px] shrink-0 truncate px-3">Turkum</span>
                <span className="w-[180px] shrink-0 truncate px-3">So&apos;ralgan summa</span>
                <span className="w-[150px] shrink-0 truncate px-3">Holat</span>
                <span className="w-[130px] shrink-0 truncate pl-3">Yuborilgan</span>
              </div>
              {boshqalar.map((r) => (
                <BoshqaAriza key={r.id} r={r} joriy={r.id === a.id} havola={arizaHavola(r.id)} />
              ))}
            </div>
          </div>
        )}
      </Karta>

      {/* ── 7 · Jurnal (faqat superadmin) ───────────────────────────── */}
      {isSuper && (
        <Karta
          nom="7 · Jurnal — shu ariza bo'yicha qayd etilgan hodisalar"
          xulosa="Manba: arizaning o'z vaqt belgilari va audit jurnali · faqat superadmin ko'radi"
          havola={<Havola href="/admin/audit">Audit logda ko&apos;rish</Havola>}
          izoh="Admin arizani ochib ko'rgani jurnalga yozilmaydi. CSV eksport ham bu ro'yxatga kirmaydi: eksport yozuvi bitta arizaga emas, filtrga tegishli — uni shu arizaga bog'lash yolg'on bo'lardi."
        >
          {!jurnal.length ? (
            <BoshHolat />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div
                  className="flex items-center rounded-[8px] px-[12px] py-[7px] text-[11px] font-semibold leading-[15px]"
                  style={{ background: SARLAVHA_FON, color: KUL }}
                >
                  <span className="w-[180px] shrink-0 truncate pr-3">Vaqt</span>
                  <span className="min-w-0 flex-1 truncate px-3">Amal</span>
                  <span className="w-[220px] shrink-0 truncate px-3">Kim bajardi</span>
                  <span className="w-[120px] shrink-0 truncate pl-3">Manba</span>
                </div>
                {jurnal.map((y, i) => (
                  <JurnalQatori key={`${y.kind}-${y.at}-${i}`} y={y} />
                ))}
              </div>
            </div>
          )}
        </Karta>
      )}

      <p className="pb-2 text-center text-[11px] leading-4" style={{ color: XIRA_QUYUQ }}>
        Ariza yozuvi hech qachon o&apos;chirilmaydi va tahrirlanmaydi. Bu sahifadagi barcha
        ma&apos;lumot ishchi, ish beruvchi va e&apos;lon yozuvlaridan real vaqtda o&apos;qiladi —
        nusxa saqlanmaydi.
      </p>
    </div>
  );
}

/* ── Yordamchi komponentlar ───────────────────────────────────────── */

/**
 * Kartaning umumiy karkasi — `app/admin/elons/[id]` bilan bir xil
 * o'lchamda (Figma: V gap10, ichki chegara 18/22).
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
      <div className="flex items-start justify-between gap-3">
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

/** Kartaning o'ng chetidagi «… →» havolasi (Figma: ko'k, 12/16). */
function Havola({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap text-[12px] font-medium leading-4 hover:underline"
      style={{ color: KO_K }}
    >
      {children}
      <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

/**
 * Ko'rsatkich katagi — Figma: qutilar bir qatorda, har biri qolgan
 * joyni teng bo'lib oladi va 180 px dan kichraymaydi.
 */
function Stat({
  yorliq,
  qiymat,
  xira,
  rang,
}: {
  yorliq: string;
  qiymat: string;
  /** Qiymat haqiqiy ma'lumot emas ("Hali yo'q", "—"). */
  xira?: boolean;
  rang?: string;
}) {
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
        style={{ color: rang || (xira ? XIRA_QUYUQ : IK) }}
        title={qiymat}
      >
        {qiymat}
      </span>
    </div>
  );
}

/**
 * "Yorliq — qiymat" qatori. Yorliq ustuni 130 px QAT'IY: qiymatlar
 * hamma kartada bitta chizig'da turishi kerak.
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
      <span className="w-[130px] shrink-0 text-[13px] leading-[19px]" style={{ color: XIRA_QUYUQ }}>
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

/** Bo'sh ro'yxat yozuvi — karta baribir chiziladi. */
function BoshHolat() {
  return (
    <p className="text-[13px] leading-[18px]" style={{ color: XIRA_QUYUQ }}>
      Ma&apos;lumot yo&apos;q
    </p>
  );
}

/**
 * Buferga nusxalanadigan qiymat — Figma 3.6.1a · hodisalar: «Ariza ID
 * yoki telefon bosilganda qiymat buferga olinadi va 2 soniya
 * «Nusxa olindi» ko'rsatiladi».
 *
 * `title` emas, KO'RINADIGAN yozuv: brauzer ipuchasi bosishdan keyin
 * o'zi paydo bo'lmaydi, ya'ni admin nusxa olinganini bilmasdi.
 * Muvaffaqiyatsizlik ham aytiladi — jimgina "olindi" ko'rsatish
 * yolg'on bo'lardi (`nusxaOl` xavfsiz bo'lmagan kontekstda ishlamaydi).
 */
function Nusxa({
  qiymat,
  korinish,
  izoh,
}: {
  qiymat: string;
  korinish?: string;
  izoh: string;
}) {
  const [holat, setHolat] = useState<"" | "ok" | "xato">("");

  useEffect(() => {
    if (!holat) return;
    const t = setTimeout(() => setHolat(""), 2000);
    return () => clearTimeout(t);
  }, [holat]);

  if (!qiymat) return <span style={{ color: XIRA_QUYUQ }}>—</span>;

  return (
    <span className="inline-flex max-w-full items-center gap-[6px]">
      <button
        type="button"
        title={izoh}
        onClick={async () => setHolat((await nusxaOl(qiymat)) ? "ok" : "xato")}
        className="group inline-flex max-w-full items-center gap-[5px] rounded-[6px] text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6]"
        style={{ color: "inherit" }}
      >
        <span className="truncate">{korinish || qiymat}</span>
        <Copy size={12} className="shrink-0 opacity-40 group-hover:opacity-80" aria-hidden />
      </button>
      {/* `role="status"` — ekran o'quvchisi ham xabardor bo'ladi. */}
      {holat && (
        <span
          role="status"
          className="inline-flex shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[6px] px-[6px] py-[2px] text-[11px] font-medium leading-[15px]"
          style={{
            background: holat === "ok" ? "#e6f5ed" : "#fcebec",
            color: holat === "ok" ? YASHIL : QIZIL,
          }}
        >
          {holat === "ok" ? <Check size={11} aria-hidden /> : null}
          {holat === "ok" ? "Nusxa olindi" : "Nusxalab bo'lmadi"}
        </span>
      )}
    </span>
  );
}

/**
 * Vaqt chizig'ining bitta qadami.
 *
 * Nuqta uch ko'rinishda: to'ldirilgan (bo'ldi), ichi bo'sh rangli halqa
 * (hozirgi qadam) va kulrang halqa (kelgusi). Ulash chizig'i FAQAT
 * bajarilgan qadamdan keyin chiziladi — Figma'da yo'l hozirgi qadamda
 * uziladi, ya'ni "bundan keyin nima bo'lishi hali aniq emas".
 */
function QadamQatori({ q, chiziq }: { q: Qadam; chiziq: boolean }) {
  const kelgusi = q.holat === "kelgusi";
  return (
    <div className="flex gap-[12px]">
      <span className="flex w-[10px] shrink-0 flex-col items-center pt-[5px]">
        <span
          className="h-[10px] w-[10px] shrink-0 rounded-full"
          style={
            q.holat === "tugadi"
              ? { background: q.rang }
              : {
                  background: "#fff",
                  boxShadow: `inset 0 0 0 2px ${q.holat === "joriy" ? q.rang : HOSHIYA_QUYUQ}`,
                }
          }
          aria-hidden
        />
        {chiziq && (
          <span
            className="mt-[3px] w-[2px] flex-1 rounded-full"
            style={{ background: q.holat === "tugadi" ? q.rang : HOSHIYA }}
            aria-hidden
          />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-[2px] pb-[14px]">
        <span
          className="text-[13px] font-semibold leading-[18px]"
          style={{ color: kelgusi ? XIRA_QUYUQ : IK }}
        >
          {q.nom}
        </span>
        <span className="text-[12px] leading-4" style={{ color: kelgusi ? XIRA : OCH_KUL }}>
          {q.izoh}
        </span>
      </div>
    </div>
  );
}

/**
 * «Shu ishchining boshqa arizalari» jadvalining qatori.
 *
 * Joriy ariza havola BO'LMAYDI: o'zini o'ziga bosish hech narsa
 * qilmasdi, lekin admin "bosildi-yu, ochilmadi" deb o'ylardi. Uning
 * o'rniga «Hozirgi sahifa» chipi turadi (Figma 3.6.1 · 7).
 */
function BoshqaAriza({
  r,
  joriy,
  havola,
}: {
  r: ArizaSatri;
  joriy: boolean;
  havola: string;
}) {
  const kor = arizaHolatKor(r.status);
  const ichi = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-[8px] pr-3">
        <span
          className="truncate text-[13px] font-medium leading-[18px]"
          style={{ color: joriy ? IK : KO_K }}
        >
          {r.elonTitle || "(sarlavhasiz)"}
        </span>
        {joriy && (
          <span
            className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[11px] px-[8px] py-[3px] text-[11px] font-medium leading-[15px]"
            style={{ background: "#dce9ff", color: KO_K }}
          >
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: KO_K }} aria-hidden />
            Hozirgi sahifa
          </span>
        )}
      </span>
      <span
        className="w-[150px] shrink-0 truncate px-3 text-[13px] leading-[18px]"
        style={{ color: r.categoryName ? KUL : XIRA_QUYUQ }}
      >
        {r.categoryName || "ko'rsatilmagan"}
      </span>
      <span
        className="w-[180px] shrink-0 truncate px-3 text-[13px] font-medium leading-[18px]"
        style={{ color: KUL }}
      >
        {r.isNegotiable ? "Kelishuv asosida" : `${son(r.amount)} so'm / ishchi`}
      </span>
      <span className="w-[150px] shrink-0 px-3">
        <ArizaNishoni {...kor} />
      </span>
      <span
        className="w-[130px] shrink-0 whitespace-nowrap pl-3 text-[13px] leading-[18px]"
        style={{ color: KUL }}
      >
        {sana(r.appliedAt)}
      </span>
    </>
  );

  if (joriy) {
    return (
      <div
        className="flex items-center px-[12px] py-[11px]"
        style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
      >
        {ichi}
      </div>
    );
  }
  return (
    <Link
      href={havola}
      title={r.elonTitle || undefined}
      className="flex items-center rounded-[8px] px-[12px] py-[11px] outline-none transition-colors hover:bg-[#f4f6fc] focus-visible:bg-[#f4f6fc] focus-visible:shadow-[inset_0_0_0_2px_#004ac6]"
      style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
    >
      {ichi}
    </Link>
  );
}

/** Jurnal jadvalining bitta qatori (Figma 3.6.1 · 8). */
function JurnalQatori({ y }: { y: JurnalYozuvi }) {
  const tur = JURNAL_TUR[y.kind] || { matn: "Hodisa", rang: OCH_KUL };
  // Admin amalining nomi `detail` da keladi (backend yozgan o'zbekcha
  // matn); qolgan turlarda nom shu yerdagi jadvaldan olinadi.
  const amal = y.kind === "admin" ? (y.detail || "").trim() || tur.matn : tur.matn;
  const izoh = y.kind === "admin" ? "" : (y.detail || "").trim();
  const kim = [(y.actor || "").trim(), (y.actorRole || "").trim()].filter(Boolean).join(AJR);
  return (
    <div
      className="flex items-start px-[12px] py-[11px]"
      style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
    >
      <span
        className="w-[180px] shrink-0 pr-3 text-[13px] leading-[18px]"
        style={{ color: OCH_KUL }}
      >
        {sanaVaqt(y.at)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px] px-3">
        <span className="flex items-center gap-[7px]">
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: tur.rang }}
            aria-hidden
          />
          <span className="min-w-0 text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
            {amal}
          </span>
        </span>
        {izoh && (
          <span className="pl-[13px] text-[12px] leading-4" style={{ color: OCH_KUL }}>
            {izoh.slice(0, 200)}
          </span>
        )}
      </span>
      <span
        className="w-[220px] shrink-0 truncate px-3 text-[13px] leading-[18px]"
        style={{ color: kim ? KUL : XIRA_QUYUQ }}
      >
        {kim || "Tizim"}
      </span>
      <span
        className="w-[120px] shrink-0 truncate pl-3 text-[13px] leading-[18px]"
        style={{ color: OCH_KUL }}
      >
        {JURNAL_MANBA[y.source] || "—"}
      </span>
    </div>
  );
}
