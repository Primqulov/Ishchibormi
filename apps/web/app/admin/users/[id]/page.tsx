"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Check, EyeOff, Info, Lock, ShieldAlert, Unlock } from "lucide-react";
import {
  api,
  User,
  Elon,
  Application,
  APIError,
  getAdminRole,
  isUserBlocked,
  moderationBanUntil,
  blockSourceLabel,
  platformLabel,
} from "@/lib/api";
import { AdminModal } from "@/components/admin/AdminModal";
import { HolatKor, elonHolatKor } from "@/components/admin/ElonHolat";
import { arizaHolatKor } from "@/components/admin/ArizaHolat";
import { safeImageSrc } from "@/lib/url";
import {
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KO_K_FON,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_FON,
  ORANJ_MATN,
  QIZIL,
  SOYA,
  XIRA,
  YASHIL,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.4 · Foydalanuvchi — batafsil sahifa (bloklangan)" va
          "3.4a · Batafsil sahifa — holatlar".

   Uslub ro'yxat sahifasi (3.3) bilan BIR XIL manbadan oladi —
   `components/admin/ui.ts`: palitra, tugmalar, `inset` hoshiya. Bu yerda
   yangi rang ham, yangi tugma o'lchami ham kiritilmaydi.

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini 2 px
   kattartirib yuborardi, shuning uchun hamma joyda `inset` box-shadow.
   ───────────────────────────────────────────────────────────────────── */

/* ── Turlar (backend javobi) ──────────────────────────────────────── */

interface Report {
  id: string;
  reason: string;
  description?: string;
  status: string;
  createdAt: string;
}

/**
 * Bitta moderatsiya buzilishi (backend: `moderation_strikes.events[]`).
 *
 * `detail` — tasnif natijasi (masalan `HARM_CATEGORY_HARASSMENT=HIGH`).
 * Foydalanuvchiga hech qachon ko'rsatilmaydi, admin uchun esa aynan shu
 * "nega bloklandi" degan savolga oxirgi javob.
 */
interface StrikeEvent {
  kind: string;
  detail?: string;
  at: string;
}
interface StrikeRecord {
  phone: string;
  strikes: number;
  bannedUntil?: string;
  events?: StrikeEvent[];
  updatedAt: string;
}

/**
 * Admin AYNAN SHU foydalanuvchiga qo'lda yozgan xabar.
 *
 * Broadcast'lar bu ro'yxatga KIRMAYDI: ikkalasi ham `type: "system"` bilan
 * saqlanadi, lekin qo'lda yuborilganida yuborgan admin qayd etiladi va
 * backend aynan shu belgi bo'yicha filtrlaydi.
 */
interface AdminNotification {
  id: string;
  title: string;
  body: string;
  /** Foydalanuvchi xabarni ochganmi. */
  isRead: boolean;
  createdAt: string;
  /** Yuborgan adminning username'i. Admin o'chirilgan bo'lsa bo'sh. */
  sentBy?: string;
}

/**
 * Hisob holatining bitta o'zgarishi (backend: user_status.go).
 *
 * `detail` ning MA'NOSI turga bog'liq — blokda sabab matni,
 * ogohlantirishda buzilish turi kodi. Shuning uchun uni chizishdan oldin
 * har tur o'zicha o'qiladi (`tarixSarlavha`).
 */
interface StatusEvent {
  kind: string;
  at: string;
  detail?: string;
  /** Amalni bajargan admin ("nodira" yoki "nodira · moderator"). */
  actor?: string;
  /** Tizim bajargan — admin emas. */
  auto?: boolean;
  /** Blok qachongacha (faqat muddatli avtomatik blokda). */
  until?: string;
}

interface Detail {
  user: User;
  elons: Elon[];
  applications: Application[];
  reports: Report[];
  /** Buzilishlar tarixi — hech qachon qoida buzmagan foydalanuvchida null. */
  moderationStrikes?: StrikeRecord | null;
  /** Adminlar shu odamga yozgan xabarlar, yangisidan boshlab. */
  adminNotifications?: AdminNotification[];
  /** Hisob holati o'zgarishlari, yangisidan boshlab. */
  statusHistory?: StatusEvent[];
}

/* ── Yorliqlar va ranglar ─────────────────────────────────────────── */

/** Buzilish turi — inson o'qiy oladigan nom (backend: KindElon/Profile/Avatar). */
const STRIKE_KIND: Record<string, string> = {
  elon: "E'lon matni yoki rasmi",
  profile: "Profil ma'lumotlari",
  avatar: "Profil rasmi",
};

/**
 * Holat tarixidagi nishonlar — Figma 3.4 va 3.4a · 7.
 *
 * Ranglar `ui.ts` dagi palitradan: qizil — hisob ishlamay qolgan holat,
 * yashil — tiklangan, sariq — ogohlantirish (hali oqibati yo'q), kul —
 * neytral voqea.
 */
const HOLAT_TUR: Record<string, { matn: string; rang: string }> = {
  signup: { matn: "Ro'yxatdan o'tdi", rang: OCH_KUL },
  verify: { matn: "Tasdiqlandi", rang: YASHIL },
  block: { matn: "Bloklandi", rang: QIZIL },
  unblock: { matn: "Blokdan chiqarildi", rang: YASHIL },
  warn: { matn: "Ogohlantirish", rang: ORANJ },
  delete: { matn: "O'chirildi", rang: QIZIL },
};

/* E'lon holati bu yerda ATAYLAB yozilmaydi — u
   `components/admin/ElonHolat.tsx` dan keladi (`elonHolatKor`). Ilgari shu
   yerda alohida jadval bor edi va u e'lonlar ro'yxatidagidan farq qilib
   ketgan: "to'ldi" va "yakunlandi" ikkalasi ham ko'k edi, ya'ni bu ekranda
   ularni ajratib bo'lmasdi. Figma 3.5a · 1 esa "to'ldi" ni siyoh,
   "yakunlandi" ni kulrang qilib beradi. */

/* Ariza holati bu yerda ATAYLAB yozilmaydi — u
   `components/admin/ArizaHolat.tsx` dan keladi. Figma 3.6a · 1-panel:
   «Har bir holat rangi butun panel bo'ylab bir xil ishlatiladi.» Ilgari
   shu yerda alohida jadval bor edi va u arizalar ro'yxatidagidan farq
   qilardi: "qabul qilingan" yashil, "bajarilgan" ko'k edi — Figma esa
   buning teskarisini beradi, ya'ni ikki ekranni solishtirgan admin bir
   xil rangni boshqa ma'noda o'qirdi. */

/** Shikoyat holati (backend: open|resolved|dismissed). */
const SHIKOYAT_HOLAT: Record<string, { matn: string; rang: string }> = {
  open: { matn: "hal qilinmagan", rang: ORANJ },
  resolved: { matn: "hal qilindi", rang: YASHIL },
  dismissed: { matn: "rad etildi", rang: OCH_KUL },
};

/**
 * Bildirishnoma maydonlarining chegarasi — backend bilan BIR XIL
 * (apps/api/internal/admin/users.go · NotifyUser).
 *
 * Nega ikki joyda: backend qorovul, bu esa maydonning o'zi. Teng
 * bo'lmasa admin uzun matn yozib, "Yuborish" bosgach tushunarsiz xato
 * olardi — chegara yozish paytidayoq bilinishi kerak.
 */
const NOTIFY_SARLAVHA_MAX = 160;
const NOTIFY_MATN_MAX = 4000;
/** Bloklash sababi chegarasi (backend: maxBlockReasonRunes). */
const SABAB_MAX = 500;

/** Kartada ko'rsatiladigan holat yozuvlari — qolgani oynada. */
const TARIX_KORINADI = 3;

/** ObjectID shakli — havola yasashdan oldingi qorovul. */
const OID = /^[0-9a-f]{24}$/i;

/**
 * E'lon havolasi — id shakli TO'G'RI bo'lsagina yasaladi.
 *
 * Bo'sh yoki buzuq id bilan havola yasalsa, `/admin/elons/` ga —
 * ya'ni umuman boshqa sahifaga — olib borardi va admin "e'lon ochilmadi"
 * deb o'ylardi. Shakl tekshiruvi ro'yxat va batafsil sahifalardagi
 * qorovul bilan bir xil (24 belgili ObjectID).
 *
 * # NEGA `kel`/`kim`
 * E'lonning batafsil sahifasidagi qaytish havolasi shu bo'lakni o'qib,
 * adminni AYNAN shu profilga qaytaradi. Bo'lak bo'lmasa, u e'lonlar
 * ro'yxatiga chiqarib yuborardi — admin qidirib topgan profilidan uzilib
 * qolardi. `kim` ham shakl tekshiruvidan o'tadi: e'lon sahifasi buzuq
 * qiymatni tanimay, oddiy ro'yxatga qaytaradi.
 */
function elonHavolasi(id?: string, kimdan?: string): string | undefined {
  if (!id || !OID.test(id)) return undefined;
  const yol = `/admin/elons/${encodeURIComponent(id)}`;
  const kim = kimdan && OID.test(kimdan) ? kimdan : "";
  return kim ? `${yol}?kel=user&kim=${encodeURIComponent(kim)}` : yol;
}

/* ── Formatlash ───────────────────────────────────────────────────── */

const OYLAR = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/**
 * Figma sana ko'rinishi: "14-mart 2026".
 *
 * Qo'lda yozilgan, `dayjs` lokali orqali emas: sahifadagi har bir sana
 * AYNAN shu ko'rinishda bo'lishi kerak va u kutubxona lokali yangilanishiga
 * bog'liq bo'lmasligi lozim. Ro'yxat sahifasi ham xuddi shunday qiladi
 * (app/admin/users/page.tsx · sana()).
 */
function sana(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()}-${OYLAR[d.getMonth()]} ${d.getFullYear()}`;
}

/** Figma sana + soat ko'rinishi: "14-mart 2026, 09:42". */
function sanaVaqt(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sana(iso)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Ming ajratgichi — uzuq bo'shliq (Figma: "450 000"). */
function son(v?: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "0";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Figma telefon ko'rinishi: +998 90 123 45 67. Mos kelmasa — o'zgarishsiz. */
function telefon(v: string): string {
  const t = (v || "").replace(/[^\d+]/g, "");
  const m = /^\+?998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(t);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : v;
}

/** Ism-familiya yonidagi harf — rasm bo'lmaganda. */
function bosh(u: User): string {
  const s = `${u.firstName || ""}${u.lastName || ""}`.trim();
  return s ? s[0].toUpperCase() : "?";
}

/**
 * Holat tarixidagi bitta yozuvning sarlavhasi.
 *
 * Har tur `detail` ni boshqacha o'qiydi (backend izohiga qarang), shuning
 * uchun matn shu yerda yig'iladi — chizish joyida emas.
 */
function tarixSarlavha(ev: StatusEvent, u: User): string {
  switch (ev.kind) {
    case "signup":
      // Platforma yozilmagan bo'lsa `platformLabel` "Noma'lum" qaytaradi va
      // "Noma'lum orqali" degan g'aliz jumla chiqardi. Eski hisoblarda bu
      // maydon yo'q, shuning uchun oddiy jumlaga tushamiz.
      return u.signupPlatform
        ? `${platformLabel(u.signupPlatform, u.signupDevice)} orqali`
        : "Hisob yaratildi";
    case "verify":
      return ev.detail || "Telefon raqami tasdiqlandi";
    case "block": {
      const sabab = ev.detail || "Sabab ko'rsatilmagan";
      return ev.until ? `${sabab} — ${sana(ev.until)} gacha` : sabab;
    }
    case "unblock":
      return ev.detail || "Blok ochildi";
    case "warn":
      return STRIKE_KIND[ev.detail || ""] || "Nomaqbul kontent";
    case "delete":
      return ev.detail || "Hisob o'chirildi";
    default:
      return ev.detail || "";
  }
}

/** Yozuvni kim qildi — "Avtomatik", admin nomi, yoki noma'lum admin. */
function tarixKim(ev: StatusEvent): string {
  if (ev.actor) return ev.actor;
  // Avtomatik moderatsiya blokini oddiy "Avtomatik" dan ajratamiz: admin
  // uchun bu ikki xil voqea — biri tizimning qarori, biri shunchaki
  // vaqt o'tishi (muddat tugashi, ro'yxatdan o'tish).
  if (ev.kind === "block" || ev.kind === "warn") return "Avtomatik moderatsiya";
  if (ev.auto) return "Avtomatik";
  // Admin bazadan o'chirilgan — yozuv qoldi, muallifi noma'lum. Buni
  // "Avtomatik" deb ko'rsatish YOLG'ON bo'lardi: qarorni odam qilgan.
  return "Admin (o'chirilgan)";
}

/**
 * Qaysi yozuv hozirgi holatni tushuntiradi — Figma'dagi «hozirgi holat»
 * nishoni shunga qo'yiladi.
 *
 * Nega eng yangi yozuvning o'zi emas: tarixning tepasida ogohlantirish
 * yoki tasdiqlash turishi mumkin, ular esa hisobning ishlash holatini
 * o'zgartirmaydi. Nishon HOZIR nima bo'layotganini ko'rsatishi kerak,
 * "oxirgi nima yozildi" ni emas.
 */
function hozirgiIndeks(tarix: StatusEvent[], u: User): number {
  const izla = (kind: string) => tarix.findIndex((e) => e.kind === kind);
  if (u.isDeleted) return izla("delete");
  if (isUserBlocked(u)) return izla("block");
  const ochilgan = izla("unblock");
  return ochilgan >= 0 ? ochilgan : izla("signup");
}

/** Kartaning sarlavha ostidagi qisqa hisobi: "2 marta bloklangan · …". */
function tarixHisobi(tarix: StatusEvent[]): string {
  const n = (kind: string) => tarix.filter((e) => e.kind === kind).length;
  const qismlar: string[] = [];
  if (n("block")) qismlar.push(`${n("block")} marta bloklangan`);
  if (n("unblock")) qismlar.push(`${n("unblock")} marta blokdan chiqarilgan`);
  if (n("warn")) qismlar.push(`${n("warn")} ta ogohlantirish`);
  if (n("delete")) qismlar.push("hisob o'chirilgan");
  return qismlar.length ? qismlar.join(" · ") : "Hisob holati o'zgarmagan";
}

/* ── Sahifa ───────────────────────────────────────────────────────── */

export default function AdminUserDetail() {
  const params = useParams<{ id: string | string[] }>();
  // `useParams` massiv qaytarishi mumkin (catch-all yo'llar). Bitta qiymatga
  // keltiramiz: aks holda so'rov yo'liga "a,b" tushib qolardi.
  const xomId = params?.id;
  const id = (Array.isArray(xomId) ? xomId[0] : xomId) || "";

  const [d, setD] = useState<Detail | null>(null);
  const [yuklashXato, setYuklashXato] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [tarixOpen, setTarixOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * So'rov navbati — kechikib kelgan javob yangisini bosib ketmasin.
   *
   * Sahifa har amaldan keyin qayta yuklanadi (`load()`), amallar esa tez
   * ketma-ket bo'lishi mumkin. Raqamsiz: birinchi so'rov sekin qaytsa,
   * ekranda ESKI holat turib qolardi va admin "blok ochilmadi" deb
   * o'ylardi. Ro'yxat sahifasidagi qorovul bilan bir xil (3.3).
   */
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setYuklashXato("Foydalanuvchi manzili noto'g'ri");
      return;
    }
    const raqam = ++soravRaqami.current;
    try {
      // `encodeURIComponent` — id manzil bo'lagiga tushadi. Yo'l parametri
      // brauzer manzilidan keladi, ya'ni ixtiyoriy matn bo'lishi mumkin:
      // usiz "../" yoki "?" kabi belgilar so'rovni butunlay boshqa
      // endpoint'ga yo'naltirib yuborardi.
      const javob = await api.get<Detail>(
        `/api/admin/users/${encodeURIComponent(id)}`,
        { auth: "admin" } as any,
      );
      if (raqam !== soravRaqami.current) return;
      setD(javob);
      setYuklashXato("");
    } catch (e) {
      if (raqam !== soravRaqami.current) return;
      // Xom javob tanasi EMAS — faqat backendning tayyor xabari. Aks holda
      // texnik tafsilot (yo'l, stack) ekranga chiqib ketishi mumkin.
      setYuklashXato((e as APIError)?.message || "Ma'lumotni yuklab bo'lmadi");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  // Rol faqat ko'rinishni boshqaradi — ruxsat baribir serverda tekshiriladi
  // (httpx.RequireRole). Bu yerdagi tekshiruv "bosilib 403 olish" ni
  // oldini oladi, xavfsizlik qorovuli emas.
  useEffect(() => {
    setIsSuper(getAdminRole() === "superadmin");
  }, []);

  const yol = `/api/admin/users/${encodeURIComponent(id)}`;

  async function submitBlock() {
    const sabab = reason.trim();
    if (!sabab) return;
    setBusy(true);
    setErr("");
    try {
      await api.post(`${yol}/block`, { isBlocked: true, reason: sabab }, { auth: "admin" } as any);
      setBlockOpen(false);
      setReason("");
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Bloklab bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  async function submitUnblock() {
    setBusy(true);
    setErr("");
    try {
      // Bitta chaqiruv qo'lda qo'yilgan blokni ham, avtomatik blokni ham
      // ochadi — panelda blok bitta tushuncha.
      await api.post(`${yol}/block`, { isBlocked: false }, { auth: "admin" } as any);
      setUnblockOpen(false);
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Blokni ochib bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setErr("");
    try {
      await api.post(`${yol}/verify`, {}, { auth: "admin" } as any);
      load();
    } catch (e) {
      // Tasdiqlash oynasiz amal, shuning uchun xato sahifaning o'zida
      // ko'rinadi — jimgina yo'qolmasligi kerak.
      setErr((e as APIError)?.message || "Tasdiqlab bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  async function sendNotify() {
    const sarlavha = nTitle.trim();
    if (!sarlavha) return;
    setBusy(true);
    setErr("");
    try {
      await api.post(
        `${yol}/notify`,
        { title: sarlavha, body: nBody.trim() },
        { auth: "admin" } as any,
      );
      setNotifyOpen(false);
      setNTitle("");
      setNBody("");
      // Yuborilgan xabar darhol ro'yxatda ko'rinsin. Busiz admin sahifani
      // qo'lda yangilamaguncha xabar yo'qdek tuyulardi va u ikkinchi marta
      // yuborishi mumkin edi.
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Xabarni yuborib bo'lmadi");
    } finally {
      setBusy(false);
    }
  }

  const karta: React.CSSProperties = { boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` };

  /* Figma 3.4a · 4: ma'lumot kelmaguncha butun sahifa o'rniga BITTA karta
     turadi — bloklar bittalab paydo bo'lmaydi. Xato ham shu yerda: bo'sh
     sahifa "ma'lumot yo'q" deb o'qilmasligi kerak. */
  if (!d) {
    return (
      <div
        className="grid h-[90px] place-items-center rounded-[14px] bg-white px-5 text-center text-[13px] font-medium leading-[18px]"
        style={{ ...karta, color: yuklashXato ? QIZIL : XIRA }}
      >
        {yuklashXato || "Yuklanmoqda…"}
      </div>
    );
  }

  const u = d.user;
  const blockedNow = isUserBlocked(u);
  const banUntil = moderationBanUntil(u);
  // Avtomatik moderatsiya blokini faqat superadmin ocha oladi (bu jazoni
  // bekor qilish). Backend ham shuni tekshiradi — bu yerda tugma faqat
  // o'chiq turadi va sababi tooltip'da aytiladi.
  const canUnblock = isSuper || !banUntil;
  const strikes = d.moderationStrikes;
  const tarix = d.statusHistory ?? [];
  const hozirgi = hozirgiIndeks(tarix, u);
  const bildirishnomalar = d.adminNotifications ?? [];

  // Holat KPI'si — ro'yxat sahifasidagi ustun bilan AYNI uchta qiymat,
  // ayni ustuvorlik va AYNI ranglar (app/admin/users/page.tsx · holat()).
  // Sariq blok uchun: u qaytariladigan holat; qizil qaytarib bo'lmaydigan
  // o'chirishga qoldirilgan (Figma 4.4 qoidasi).
  const holatKor = u.isDeleted
    ? { matn: "O'chirilgan", rang: QIZIL }
    : blockedNow
      ? { matn: "Bloklangan", rang: ORANJ }
      : { matn: "Faol", rang: YASHIL };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/users"
        className="inline-flex w-fit items-center gap-[6px] text-[13px] leading-[18px] hover:underline"
        style={{ color: OCH_KUL }}
      >
        <ArrowLeft size={15} aria-hidden />
        Foydalanuvchilar
      </Link>

      {/* ── Profil + amallar ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-[14px] rounded-[14px] bg-white p-5" style={karta}>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-[16px] font-bold"
            style={{ background: KO_K_FON, color: KO_K }}
            aria-hidden
          >
            {safeImageSrc(u.avatarUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={safeImageSrc(u.avatarUrl)}
                alt=""
                className="h-full w-full object-cover"
                // Rasm tashqi manzilda bo'lishi mumkin — admin panelining
                // manzili (foydalanuvchi id'si bilan) begona serverga
                // Referer bo'lib ketmasligi kerak.
                referrerPolicy="no-referrer"
              />
            ) : (
              bosh(u)
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-bold leading-6" style={{ color: IK }}>
              {`${u.firstName || ""} ${u.lastName || ""}`.trim() || "Ismsiz hisob"}
            </h1>
            <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
              {/* O'chirilgan hisobda raqam `deletedPhone` ga ko'chadi —
                  aks holda joy bo'sh ko'rinardi (ro'yxat sahifasi ham
                  shunday qiladi). */}
              {telefon(u.phone || u.deletedPhone || "") || "Raqam bo'shatilgan"}
              {(u.region || u.district) && (
                <>
                  {" · "}
                  {[u.region, u.district].filter(Boolean).join(", ")}
                </>
              )}
            </p>
          </div>

          {/* Figma 3.4a · 6: bu yerda O'CHIRISH TUGMASI YO'Q — hisobni
              o'chirish faqat ro'yxat sahifasidan qilinadi, qaytarilmaydigan
              amal bitta joyda tursin. */}
          {/* O'chirilgan hisobda AMAL YO'Q — sahifa faqat o'qish uchun
              qoladi. Backend bu amallarni rad etmaydi, ya'ni ular
              "muvaffaqiyatli" bo'lardi-yu, hech qanday ta'siri bo'lmasdi:
              hisob allaqachon kira olmaydi, xabarni esa o'qiydigan odam
              yo'q. Tugmani ko'rsatib turib keyin hech narsa qilmaslik —
              adminni chalg'itish. */}
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {u.isDeleted ? (
              <p className="text-[12px] leading-[17px]" style={{ color: XIRA }}>
                Hisob o&apos;chirilgan — amallar mavjud emas
              </p>
            ) : (
              <>
                <button
                  onClick={() => {
                    setErr("");
                    setNotifyOpen(true);
                  }}
                  {...tugma("ikkilamchi")}
                >
                  <Bell size={15} aria-hidden />
                  Bildirishnoma
                </button>
                {/* Figma 3.4a · 2: telefon tasdiqlangan bo'lsa tugma UMUMAN
                    yo'q — bir marta bosilgach qaytmaydi, o'chiq tugma esa
                    "nimaga bosilmaydi?" degan savol tug'dirardi. */}
                {!u.isPhoneVerified && (
                  <button onClick={verify} disabled={busy} {...tugma("ikkilamchi", { ochiq: busy })}>
                    <Check size={15} aria-hidden />
                    Tasdiqlash
                  </button>
                )}
                {/* BITTA tugma — qo'lda qo'yilgan va avtomatik blok uchun bir xil. */}
                {blockedNow ? (
                  <button
                    onClick={() => {
                      setErr("");
                      setUnblockOpen(true);
                    }}
                    disabled={!canUnblock || busy}
                    title={
                      canUnblock ? "" : "Avtomatik moderatsiya blokini faqat superadmin ocha oladi"
                    }
                    {...tugma("asosiy", { ochiq: !canUnblock || busy })}
                  >
                    <Unlock size={15} aria-hidden />
                    Blokdan chiqarish
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setErr("");
                      setReason("");
                      setBlockOpen(true);
                    }}
                    disabled={busy}
                    {...tugma("xavf", { ochiq: busy })}
                  >
                    <Lock size={15} aria-hidden />
                    Bloklash
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi yorliq="Bajarilgan ish" qiymat={son(u.completedJobsCount)} />
          <Kpi yorliq="Holat" qiymat={holatKor.matn} rang={holatKor.rang} />
          {/* Ikkalasi ham ko'rsatiladi, teng bo'lganda ham: bu profil
              kartasi, ro'yxat emas — bu yerda savol "bu odam haqida nima
              bilamiz", va bo'sh qolgan katak javobning o'zi.

              Yorliq "Ro'yxat PLATFORMASI" — pastdagi "Ro'yxatdan o'tgan"
              sana bilan chalkashmasligi uchun. */}
          <Kpi yorliq="Ro'yxat platformasi" qiymat={platformLabel(u.signupPlatform, u.signupDevice)} />
          <Kpi yorliq="Oxirgi platforma" qiymat={platformLabel(u.lastPlatform, u.lastDevice)} />
        </div>

        {/* Hisob qachon yaratilgan — profildagi eng asosiy vaqt belgisi.
            ANIQ sana va soat, nisbiy vaqt ("3 oy oldin") emas: bu sahifaga
            admin murojaatga javob berish yoki e'tirozni tekshirish uchun
            kiradi, va u yerda "qachon aynan" degan savol muhim.

            # NEGA UCHOVI DOIM CHIZILADI
            Ilgari har bir qator o'z ma'lumoti bo'lmasa YASHIRINARDI. Natijada
            bir foydalanuvchida uch qator, boshqasida bittasi ko'rinardi va
            karta balandligi sakrab turardi. Bundan ham yomoni: yo'q qator
            "bu maydon yo'q" degan xabar bermaydi — admin uni shunchaki
            KO'RMAYDI va "sahifa buzuq" deb o'ylaydi.

            Shuning uchun qator doim turadi, qiymati esa rostini aytadi:
            "qayd etilmagan" / "yozilmagan". Bo'sh qiymat XIRA rangda — ko'z
            uni haqiqiy ma'lumotdan darhol ajratadi. */}
        <div className="flex flex-col gap-[2px]">
          <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            Ro&apos;yxatdan o&apos;tgan:{" "}
            {u.createdAt ? (
              <b className="font-semibold" style={{ color: IK }}>
                {sanaVaqt(u.createdAt)}
              </b>
            ) : (
              <span style={{ color: XIRA }}>qayd etilmagan</span>
            )}
          </p>
          <p className="text-[12px] leading-[17px]" style={{ color: XIRA }}>
            Oxirgi faollik:{" "}
            {u.lastSeenAt ? (
              sanaVaqt(u.lastSeenAt)
            ) : (
              // Ilova hisobni faollik vaqtini faqat kirgandan keyin yozadi.
              // "—" qo'yish mumkin edi, lekin u "ma'lumot yo'q" ni ham,
              // "hech qachon kirmagan" ni ham bildirardi — bu ikki xil
              // narsa va admin uchun farqi bor.
              <span>hali qayd etilmagan</span>
            )}
          </p>
        </div>

        {/* Bio — foydalanuvchining O'ZI yozgan matni, boshqa hech qayerdan
            olinmaydi. Bo'sh bo'lsa qator yo'qolib ketmasligi kerak: "bio
            yozilmagan" ham javob, va uni ko'rgan admin profil to'liq
            emasligini biladi. */}
        <p className="whitespace-pre-wrap text-[13px] leading-[19px]" style={{ color: KUL }}>
          <span style={{ color: OCH_KUL }}>Bio: </span>
          {u.bio?.trim() ? u.bio : <span style={{ color: XIRA }}>yozilmagan</span>}
        </p>

        {/* Oynasiz amallarning xatosi (Tasdiqlash) shu yerda ko'rinadi. */}
        {err && !blockOpen && !unblockOpen && !notifyOpen && (
          <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>
            {err}
          </p>
        )}
      </div>

      {/* ── Blok ma'lumotlari — sahifadagi eng muhim javob: NEGA bloklangan.
             Figma 3.4a · 1-2: faqat bloklangan foydalanuvchida chiziladi. ── */}
      {blockedNow && (
        <div
          className="flex flex-col gap-3 rounded-[14px] bg-white p-5"
          style={{ boxShadow: `inset 0 0 0 1px ${QIZIL}, ${SOYA}` }}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={17} aria-hidden style={{ color: QIZIL }} />
            <h2 className="text-[14px] font-bold leading-[19px]" style={{ color: QIZIL }}>
              Blok ma&apos;lumotlari
            </h2>
          </div>
          <div className="flex flex-col gap-[7px]">
            <Maydon yorliq="Sabab">
              {u.blockReason || (
                <span style={{ color: XIRA }}>Ko&apos;rsatilmagan (eski blok)</span>
              )}
            </Maydon>
            <Maydon yorliq="Kim qo'ygan">{blockSourceLabel(u) || "—"}</Maydon>
            {u.blockedAt && <Maydon yorliq="Qachon">{sanaVaqt(u.blockedAt)}</Maydon>}
            {banUntil ? (
              <Maydon yorliq="Qachongacha">
                {sana(banUntil.toISOString())} gacha
                <span style={{ color: XIRA }}>
                  {" · muddat tugagach o'z-o'zidan ochiladi"}
                </span>
              </Maydon>
            ) : (
              u.isBlocked && (
                <Maydon yorliq="Qachongacha">
                  <span style={{ color: XIRA }}>Qo&apos;lda ochilguncha</span>
                </Maydon>
              )
            )}
          </div>

          {/* Buzilishlar tarixi — sabab jumlasining dalili. */}
          {strikes && !!strikes.events?.length && (
            <div className="flex flex-col">
              <h3 className="mb-[2px] text-[13px] font-bold leading-[18px]" style={{ color: IK }}>
                Qoidabuzarliklar ({strikes.strikes})
              </h3>
              {strikes.events!.map((ev, i) => (
                <div
                  key={`${ev.at}-${i}`}
                  className="flex items-start justify-between gap-3 border-t py-[9px] first:border-t-0"
                  style={{ borderColor: HOSHIYA }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
                      {STRIKE_KIND[ev.kind] || ev.kind}
                    </p>
                    {ev.detail && (
                      <p className="break-all text-[11px] leading-[15px]" style={{ color: XIRA }}>
                        {ev.detail}
                      </p>
                    )}
                  </div>
                  <p
                    className="shrink-0 whitespace-nowrap text-[12px] leading-[17px]"
                    style={{ color: XIRA }}
                  >
                    {sanaVaqt(ev.at)}
                  </p>
                </div>
              ))}
              <p className="mt-[6px] text-[12px] leading-[17px]" style={{ color: XIRA }}>
                Tarix telefon raqami bo&apos;yicha saqlanadi — hisob o&apos;chirilib qayta ochilsa
                ham qoladi.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Holatlar tarixi ──────────────────────────────────────────── */}
      <div className="flex flex-col rounded-[14px] bg-white p-5" style={karta}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold leading-[19px]" style={{ color: IK }}>
              Holatlar tarixi ({tarix.length})
            </h2>
            <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
              {tarixHisobi(tarix)}
            </p>
          </div>
          {/* Figma 3.4a · 7: havola faqat 3 tadan ortiq yozuv bo'lganda
              ko'rinadi — aks holda oyna kartadagining o'zini ko'rsatardi. */}
          {tarix.length > TARIX_KORINADI && (
            <button
              onClick={() => setTarixOpen(true)}
              className="shrink-0 text-[12px] font-medium leading-[17px] hover:underline"
              style={{ color: KO_K }}
            >
              Barchasini ko&apos;rish
            </button>
          )}
        </div>

        {tarix.length ? (
          <div className="mt-[10px] flex flex-col">
            {tarix.slice(0, TARIX_KORINADI).map((ev, i) => (
              <TarixQatori
                key={`${ev.at}-${ev.kind}-${i}`}
                ev={ev}
                u={u}
                hozirgi={i === hozirgi}
              />
            ))}
            <p className="mt-[6px] text-[12px] leading-[17px]" style={{ color: XIRA }}>
              {tarix.length > TARIX_KORINADI
                ? `Oxirgi ${TARIX_KORINADI} ta o'zgarish ko'rsatildi. `
                : ""}
              Faqat hisob holati o&apos;zgaradi — profil tahrirlari va kirishlar Audit logda.
            </p>
          </div>
        ) : (
          <p className="mt-[10px] text-[13px] leading-[18px]" style={{ color: XIRA }}>
            Ma&apos;lumot yo&apos;q
          </p>
        )}
      </div>

      {/* ── Yuborilgan bildirishnomalar ──────────────────────────────────
             E'lonlardan YUQORIDA: bu sahifaga ko'pincha "men bunga nima
             yozgandim?" degan savol bilan kiriladi, javob pastda
             qidirilmasligi kerak.
             Figma 3.4a · 5: bo'sh bo'lsa butun blok ko'rinmaydi — xabar
             yozilmagani odatiy holat va bo'sh karta faqat joy egallaydi. ── */}
      {!!bildirishnomalar.length && (
        <div className="flex flex-col rounded-[14px] bg-white p-5" style={karta}>
          <h2 className="text-[14px] font-bold leading-[19px]" style={{ color: IK }}>
            Yuborilgan bildirishnomalar ({bildirishnomalar.length})
          </h2>
          <div className="mt-[10px] flex flex-col">
            {bildirishnomalar.map((n) => (
              <div
                key={n.id}
                className="flex flex-col gap-[3px] border-t py-[10px] first:border-t-0 first:pt-0"
                style={{ borderColor: HOSHIYA }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
                    {n.title}
                  </p>
                  {/* O'qilgan holati — admin xabari yetib borganini bilishi
                      kerak; "yuborildi" va "ko'rildi" bir xil narsa emas. */}
                  <Nishon
                    matn={n.isRead ? "O'qilgan" : "O'qilmagan"}
                    rang={n.isRead ? YASHIL : XIRA}
                  />
                </div>
                {n.body && (
                  <p
                    className="whitespace-pre-wrap text-[12px] leading-[17px]"
                    style={{ color: KUL }}
                  >
                    {n.body}
                  </p>
                )}
                <p className="text-[12px] leading-[17px]" style={{ color: XIRA }}>
                  {sanaVaqt(n.createdAt)}
                  {n.sentBy && ` · ${n.sentBy}`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-[6px] text-[12px] leading-[17px]" style={{ color: XIRA }}>
            Ommaviy tarqatmalar bu ro&apos;yxatga kirmaydi — faqat aynan shu odamga qo&apos;lda
            yozilgan xabarlar.
          </p>
        </div>
      )}

      {/* ── Bog'liq bloklar. Figma 3.4a · 5: uchovi bo'sh bo'lsa ham
             chiziladi — "e'loni yo'q" ham javob. ─────────────────────── */}
      <Bolim sarlavha={`E'lonlari (${d.elons.length})`}>
        {d.elons.map((e) => (
          <Qator
            key={e.id}
            chap={e.title}
            holat={elonHolatKor(e.status)}
            ong={elonNarxi(e)}
            href={elonHavolasi(e.id, id)}
          />
        ))}
      </Bolim>

      {/* Arizada sarlavha — ariza berilgan E'LONning sarlavhasi, shuning
          uchun havola ham shu e'longa boradi (`elonId`, `id` emas: `id`
          arizaning o'zi). */}
      <Bolim sarlavha={`Arizalari (${d.applications.length})`}>
        {d.applications.map((a) => (
          <Qator
            key={a.id}
            chap={a.elonTitle}
            holat={arizaHolatKor(a.status)}
            ong={a.isNegotiable ? "kelishuv" : `${son(a.amount)} so'm`}
            href={elonHavolasi(a.elonId, id)}
          />
        ))}
      </Bolim>

      <Bolim sarlavha={`Ustidan shikoyatlar (${d.reports.length})`}>
        {d.reports.map((rp) => (
          <Qator
            key={rp.id}
            chap={rp.reason}
            holat={SHIKOYAT_HOLAT[rp.status]}
            ong={sana(rp.createdAt)}
          />
        ))}
      </Bolim>

      {/* ── Bildirishnoma yuborish (Figma 3.4a · 3) ──────────────────── */}
      <AdminModal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        title="Bildirishnoma yuborish"
        footer={
          <>
            <button
              onClick={() => setNotifyOpen(false)}
              disabled={busy}
              {...tugma("ikkilamchi", { ochiq: busy })}
            >
              Bekor
            </button>
            {/* Sarlavha bo'sh bo'lsa tugma o'chiq: backend ham bo'sh
                sarlavhani rad etadi, foydalanuvchi esa "Sarlavha" yo'q
                xabarni ro'yxatda tanib olmasdi. */}
            <button
              onClick={sendNotify}
              disabled={busy || !nTitle.trim()}
              {...tugma("asosiy", { ochiq: busy || !nTitle.trim() })}
            >
              {busy ? "Yuborilmoqda…" : "Yuborish"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Xabar aynan shu foydalanuvchiga boradi va uning batafsil sahifasida saqlanadi.
          </p>
          <div className="flex flex-col gap-[5px]">
            <label
              htmlFor="xabar-sarlavha"
              className="text-[13px] font-semibold leading-[17px]"
              style={{ color: KUL }}
            >
              Sarlavha
            </label>
            <input
              id="xabar-sarlavha"
              className="h-[38px] w-full rounded-[10px] bg-white px-[13px] text-[13px] outline-none placeholder:text-[#a7acb9]"
              style={{ color: IK, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
              placeholder="Sarlavha"
              value={nTitle}
              maxLength={NOTIFY_SARLAVHA_MAX}
              onChange={(e) => setNTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label
              htmlFor="xabar-matn"
              className="text-[13px] font-semibold leading-[17px]"
              style={{ color: KUL }}
            >
              Matn
            </label>
            <textarea
              id="xabar-matn"
              className="h-[82px] w-full resize-none rounded-[10px] bg-white px-[13px] py-[9px] text-[13px] leading-[19px] outline-none placeholder:text-[#a7acb9]"
              style={{ color: IK, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
              placeholder="Matn"
              value={nBody}
              maxLength={NOTIFY_MATN_MAX}
              onChange={(e) => setNBody(e.target.value)}
            />
            <div className="text-right text-[12px] leading-4 tabular-nums" style={{ color: XIRA }}>
              {nBody.length} / {NOTIFY_MATN_MAX}
            </div>
          </div>
          {err && (
            <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>
              {err}
            </p>
          )}
        </div>
      </AdminModal>

      {/* ── Bloklash — sabab MAJBURIY. Oyna ro'yxat sahifasidagi bilan
             AYNI (Figma 3.3a · 1): admin bir xil amalni ikki joyda ikki
             xil ko'rinishda ko'rmasligi kerak. ─────────────────────── */}
      <AdminModal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Foydalanuvchini bloklash"
        footer={
          <>
            <button
              onClick={() => setBlockOpen(false)}
              disabled={busy}
              {...tugma("ikkilamchi", { ochiq: busy })}
            >
              Bekor
            </button>
            <button
              onClick={submitBlock}
              disabled={busy || !reason.trim()}
              {...tugma("xavf", { ochiq: busy || !reason.trim() })}
            >
              {busy ? "Bloklanmoqda…" : "Bloklash"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            {`${u.firstName || ""} ${u.lastName || ""}`.trim() || "Bu foydalanuvchi"} ilovadan
            foydalana olmay qoladi va uning e&apos;lonlari yashiriladi.
          </p>
          <div className="flex flex-col gap-[5px]">
            <label
              htmlFor="blok-sabab"
              className="text-[13px] font-semibold leading-[17px]"
              style={{ color: KUL }}
            >
              Bloklash sababi
            </label>
            <textarea
              id="blok-sabab"
              className="h-[82px] w-full resize-none rounded-[10px] bg-white px-[13px] py-[9px] text-[13px] leading-[19px] outline-none placeholder:text-[#a7acb9]"
              style={{ color: IK, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
              placeholder="Masalan: takroriy spam e'lonlar, boshqa foydalanuvchilarga tahdid…"
              value={reason}
              maxLength={SABAB_MAX}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="text-right text-[12px] leading-4 tabular-nums" style={{ color: XIRA }}>
              {reason.length} / {SABAB_MAX}
            </div>
          </div>
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Sabab shu sahifada saqlanadi — ertaga nega bloklangani shu yerdan bilinadi.
          </p>
          {err && (
            <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>
              {err}
            </p>
          )}
        </div>
      </AdminModal>

      {/* ── Blokni ochish — bitta amal, manbasidan qat'i nazar (3.3a · 2) ── */}
      <AdminModal
        open={unblockOpen}
        onClose={() => setUnblockOpen(false)}
        title="Blokdan chiqarasizmi?"
        footer={
          <>
            <button
              onClick={() => setUnblockOpen(false)}
              disabled={busy}
              {...tugma("ikkilamchi", { ochiq: busy })}
            >
              Yo&apos;q
            </button>
            <button onClick={submitUnblock} disabled={busy} {...tugma("asosiy", { ochiq: busy })}>
              {busy ? "Ochilmoqda…" : "Ha, ochish"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          {u.blockReason && (
            <p className="text-[13px] leading-[19px]">
              <span style={{ color: XIRA }}>Blok sababi: </span>
              <span style={{ color: IK }}>{u.blockReason}</span>
            </p>
          )}
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Foydalanuvchi ilovadan yana foydalana boshlaydi va e&apos;lonlari qaytadi.
          </p>
          {banUntil && (
            <div
              className="flex gap-[10px] rounded-[10px] px-[13px] py-[7px]"
              style={{ background: ORANJ_FON }}
            >
              <Info size={16} aria-hidden className="mt-[1px] shrink-0" style={{ color: ORANJ }} />
              <p className="text-[13px] leading-[17px]" style={{ color: ORANJ_MATN }}>
                Bu avtomatik blok ({sana(banUntil.toISOString())} gacha edi). Buzilishlar hisobi ham
                nolga tushadi — aks holda keyingi bitta buzilish uni darhol qayta bloklardi.
              </p>
            </div>
          )}
          {err && (
            <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>
              {err}
            </p>
          )}
        </div>
      </AdminModal>

      {/* ── «Barchasini ko'rish» — FAQAT o'qish uchun (Figma 3.4a · 7).
             Oynada hech qanday amal yo'q: bu tarix, boshqaruv emas. ── */}
      <AdminModal
        open={tarixOpen}
        onClose={() => setTarixOpen(false)}
        title="Holatlar tarixi"
        maxWidth="max-w-[520px]"
        footer={
          <button onClick={() => setTarixOpen(false)} {...tugma("asosiy")}>
            Yopish
          </button>
        }
      >
        <div className="flex flex-col">
          <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
            Jami {tarix.length} ta o&apos;zgarish
            {tarix.length > 0 && ` · ${sana(tarix[tarix.length - 1].at)} dan buyon`}
          </p>
          {/* Chegara: uzoq yashagan hisobda tarix uzun bo'ladi va oyna
              ekrandan chiqib ketmasligi kerak. */}
          <div className="mt-[10px] flex max-h-[420px] flex-col overflow-y-auto">
            {tarix.map((ev, i) => (
              <TarixQatori
                key={`${ev.at}-${ev.kind}-${i}`}
                ev={ev}
                u={u}
                hozirgi={i === hozirgi}
              />
            ))}
          </div>
        </div>
      </AdminModal>
    </div>
  );
}

/* ── Kichik komponentlar ──────────────────────────────────────────── */

/** E'lon narxi — kelishiladigan bo'lsa summa o'rniga so'z. */
function elonNarxi(e: Elon): string {
  return e.pricingType === "negotiable" ? "kelishiladi" : `${son(e.priceAmount)} so'm`;
}

/**
 * Profil kartasidagi ko'rsatkich katagi — Figma 3.4.
 *
 * `rang` faqat "Holat" uchun beriladi: qolgan uchtasi neytral ma'lumot,
 * ularni bo'yash rangning ma'nosini yo'qotardi (Figma 4.4 qoidasi:
 * "rang holat ma'nosini bildiradi").
 */
function Kpi({ yorliq, qiymat, rang }: { yorliq: string; qiymat: string; rang?: string }) {
  return (
    <div
      className="flex flex-col gap-[3px] rounded-[10px] px-[13px] py-[10px]"
      style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
    >
      <span className="text-[11px] leading-[15px]" style={{ color: OCH_KUL }}>
        {yorliq}
      </span>
      <span
        className="truncate text-[15px] font-bold leading-[20px]"
        style={{ color: rang || IK }}
        title={qiymat}
      >
        {qiymat}
      </span>
    </div>
  );
}

/** Blok kartasidagi "yorliq — qiymat" qatori. */
function Maydon({ yorliq, children }: { yorliq: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 sm:grid-cols-[140px_1fr]">
      <span className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
        {yorliq}
      </span>
      <span className="min-w-0 break-words text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Holat nishoni — Figma 4.4 qoidasi: matn va hoshiya bir rangda, fon
 * shaffof, chapda to'ldirilgan nuqta.
 *
 * `koz` — nuqta o'rniga ko'z-chizilgan ikonka (Figma 3.5a · 1). Faqat
 * "yashirilgan" holatida keladi: u "yakunlandi" bilan bir rangda (kulrang),
 * shuning uchun farq shaklda bo'lishi kerak, aks holda bu ikkitasini
 * ajratib bo'lmasdi.
 */
function Nishon({ matn, rang, koz }: HolatKor) {
  return (
    <span
      className="inline-flex h-[21px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] text-[11px] font-medium leading-[15px]"
      style={{ color: rang, boxShadow: `inset 0 0 0 1px ${rang}` }}
    >
      {koz ? (
        <EyeOff size={11} strokeWidth={2} aria-hidden />
      ) : (
        <span className="h-[5px] w-[5px] rounded-full" style={{ background: rang }} aria-hidden />
      )}
      {matn}
    </span>
  );
}

/** Holatlar tarixidagi bitta qator — kartada ham, oynada ham bir xil. */
function TarixQatori({ ev, u, hozirgi }: { ev: StatusEvent; u: User; hozirgi: boolean }) {
  const kor = HOLAT_TUR[ev.kind] || { matn: ev.kind, rang: OCH_KUL };
  return (
    <div
      className="flex flex-col gap-[3px] border-t py-[10px] first:border-t-0 first:pt-0"
      style={{ borderColor: HOSHIYA }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Nishon matn={kor.matn} rang={kor.rang} />
          {/* «hozirgi holat» — tarixning qaysi yozuvi hozir kuchda ekanini
              aytadi. Sana bilan javob berish mumkin emas: eng yangi yozuv
              ogohlantirish bo'lishi mumkin, u esa holatni o'zgartirmaydi. */}
          {hozirgi && <Nishon matn="hozirgi holat" rang={KO_K} />}
          <span className="min-w-0 text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
            {tarixSarlavha(ev, u)}
          </span>
        </div>
        <span
          className="shrink-0 whitespace-nowrap text-[12px] leading-[17px]"
          style={{ color: XIRA }}
        >
          {sanaVaqt(ev.at)}
        </span>
      </div>
      <span className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
        {tarixKim(ev)}
      </span>
    </div>
  );
}

/**
 * Bog'liq ma'lumot bloki (E'lonlari / Arizalari / Shikoyatlar).
 *
 * Bo'sh bo'lsa ham chiziladi — Figma 3.4a · 5. "Ma'lumot yo'q" ham
 * javob, va bloklarning soni sahifa bo'ylab o'zgarib turmasligi kerak.
 */
function Bolim({ sarlavha, children }: { sarlavha: string; children: React.ReactNode }) {
  const bor = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div
      className="flex flex-col rounded-[14px] bg-white p-5"
      style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` }}
    >
      <h2 className="text-[14px] font-bold leading-[19px]" style={{ color: IK }}>
        {sarlavha}
      </h2>
      {bor ? (
        <div className="mt-[10px] flex flex-col gap-[2px]">{children}</div>
      ) : (
        <p className="mt-[6px] text-[13px] leading-[18px]" style={{ color: XIRA }}>
          Ma&apos;lumot yo&apos;q
        </p>
      )}
    </div>
  );
}

/**
 * Bog'liq blokdagi bitta qator.
 *
 * # NEGA FAQAT SARLAVHA HAVOLA
 *
 * `href` berilganda bosiladigan joy — faqat CHAP tomondagi sarlavha.
 * Butun qatorni havola qilsak, o'ng tomondagi holat nishoni va summa ham
 * bosiladigan bo'lib qolardi; ular esa ma'lumot, harakat emas. Ro'yxat
 * sahifasida ham (`app/admin/elons/page.tsx`) aynan sarlavha havola.
 *
 * Ilgari bu qatorlar umuman bosilmasdi, chunki e'lonning batafsil
 * sahifasi yo'q edi va sarlavha `/admin/elons` ro'yxatiga olib borib,
 * bosilgan e'lonni ochmasdi. Endi `/admin/elons/{id}` bor, shuning uchun
 * havola aynan shu e'lonni ochadi.
 */
function Qator({
  chap,
  holat,
  ong,
  href,
}: {
  chap: string;
  holat?: HolatKor;
  ong: string;
  href?: string;
}) {
  const matn = chap || "—";
  return (
    <div className="flex items-center justify-between gap-3 py-[7px]">
      {href ? (
        <Link
          href={href}
          className="truncate text-[13px] font-medium leading-[18px] hover:underline"
          style={{ color: IK }}
          title={`${matn} — batafsil ochish`}
        >
          {matn}
        </Link>
      ) : (
        <span
          className="truncate text-[13px] font-medium leading-[18px]"
          style={{ color: IK }}
          title={matn}
        >
          {matn}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-[10px]">
        {holat && <Nishon {...holat} />}
        <span className="whitespace-nowrap text-[13px] font-medium leading-[18px]" style={{ color: IK }}>
          {ong}
        </span>
      </span>
    </div>
  );
}
