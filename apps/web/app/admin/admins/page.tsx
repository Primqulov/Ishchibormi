"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Info,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { APIError, Admin, AdminRole, api, getAdminRole } from "@/lib/api";
import { AdminOynaQobiq } from "@/components/admin/AdminModal";
import { Belgilash } from "@/components/admin/Filtr";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_MATN,
  QIZIL,
  SOYA,
  XIRA_QUYUQ,
  YASHIL,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.9 · Adminlar — ro'yxat (1440×1024)" va
          "3.9a · Adminlar — oynalar va qoidalar".

   O'lchamlar Figma'dan aynan olingan: sarlavha kartasi 83, jadval
   sarlavhasi 46, qator 68, jadval oyoqchasi 52 px. Ustunlar:
   Admin 260 · Rol 140 · Holat 140 · 2FA 118 · Yaratilgan 154 ·
   Amallar 340 (jami 1152).

   # KIM NIMA QILA OLADI

   3.9a sarlavhasi: «Butun ekran faqat superadminga ochiq. Sahifalash
   yo'q — barcha adminlar bitta ro'yxatda.» Panelda shu ikki daraja bor:

   1. Ko'rinish: superadmin bo'lmagan adminda jadval umuman
      CHIZILMAYDI va ro'yxat SO'RALMAYDI — o'rniga qulf izohi chiqadi.
      Yon menyuda ham bu havola yo'q (layout.tsx: roles: []), lekin
      manzilni qo'lda yozib kirish mumkin.
   2. Amal: haqiqiy chegara backendda — `httpx.RequireRole()` butun
      /admins guruhini superadminga qulflaydi. Bu yerdagi tekshiruv
      himoya emas, bekorga ketadigan 403 so'rovlarini to'xtatadi.

   # O'ZINI O'ZI QULFLAB QO'YISH

   Server uchta amalni O'Z hisobida rad etadi: rolni almashtirish
   (self_role), nofaol qilish (self_lockout) va o'chirish
   (self_delete). To'rtinchisi — o'z 2FA'sini kodsiz o'chirish
   (self_2fa): ikkinchi omilni jonli kodsiz yechish uni umuman
   yo'qqa chiqarardi, shuning uchun bu amal faqat xavfsizlik
   sahifasida, jonli kod bilan bajariladi.

   Figma bu tugmalarni o'z qatorida ham chizadi (dizayn birxilligi),
   shuning uchun ular joyida qoladi — bosilganda esa so'rov
   YUBORILMAYDI: javob oldindan ma'lum, admin uni jadval ustidagi
   qizil yo'lakda darrov ko'radi (3.9a idiomasi).

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow ishlatilgan.
   ───────────────────────────────────────────────────────────────────── */

/* Sahifaga xos ranglar.
 *
 * # NEGA SHU YERDA, ui.ts DA EMAS
 *
 * Bular rol va holat ma'nosini bildiradi, umumiy palitra emas.
 * Ayniqsa MODER_FON: `ui.ts` dagi ORANJ_FON (#fcf3e6) ga o'xshaydi,
 * lekin Figma 3.9 da moderator nishoni #fdf3e4 — bir pog'ona iliqroq.
 * Umumiy tokenni "yaqin" deb olib ishlatsak, ikkalasi bir-biriga
 * sudralib ketardi. */
const SUPER_FON = "#dce9ff"; // superadmin nishoni, avatari va «SIZ» chipi
const MODER_FON = "#fdf3e4"; // moderator nishoni va avatari
const FAOL_FON = "#e6f5ed";
const FAOL_HOSHIYA = "#bfe6d2";
/** Yashil xabar matni — nishondagi YASHIL emas, bir pog'ona quyuq
 *  (Figma 3.9a · F). Kichik matn ochroq yashilda o'qilmasdi. */
const FAOL_MATN = "#12784a";
const XAVF_FON = "#fcebec";
const ZEBRA = "#f8f9ff";

/** Figma 3.9a: yuklanish paytida 5 ta skelet qator. */
const SKELET = 5;

/* Maydon chegaralari — server bilan AYNAN bir xil
 * (internal/admin/admins.go: adminUserMin/Max, adminNameMax,
 * adminPassMin/Max). Klientdagi tekshiruv himoya emas, qulaylik. */
const USER_MIN = 3;
const USER_MAX = 32;
const ISM_MAX = 100;
const PAROL_MIN = 12;
const PAROL_MAX = 72;

/** Serverdagi `adminUsernameRe` ning aynan o'zi. */
const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

const ROLLAR: AdminRole[] = ["superadmin", "moderator", "support"];

/** Rol palitrasi va izohi (Figma 3.9 nishonlari + 3.9a rol jadvali). */
const ROL: Record<AdminRole, { fon: string; matn: string; izoh: string }> = {
  superadmin: {
    fon: SUPER_FON,
    matn: KO_K,
    izoh: "Hamma narsaga ruxsat: adminlar, turkumlar, tarqatma.",
  },
  moderator: {
    fon: MODER_FON,
    matn: ORANJ,
    izoh: "Foydalanuvchi va e'lonlarni boshqaradi.",
  },
  support: {
    fon: AVATAR_FON,
    matn: OCH_KUL,
    izoh: "Asosan ko'rish; cheklangan amallar.",
  },
};

/** Notanish rol serverdan kelsa ham qator chizilishi kerak. */
const rolUslub = (r: AdminRole) => ROL[r] || ROL.support;

/* Backend xato kodlari → adminga ko'rsatiladigan matn.
 *
 * # NEGA KOD BO'YICHA, `message` BO'YICHA EMAS
 *
 * Backend xabarlari inglizcha texnik matn ("cannot change your own
 * role") — ular jurnal uchun. Kod esa barqaror shartnoma. Ro'yxatda
 * yo'q kod uchun backend xabari ko'rsatiladi: notanish xatoni
 * yashirish uni tuzatishni qiyinlashtiradi. */
const XATO_MATN: Record<string, string> = {
  bad_username: `Username ${USER_MIN}–${USER_MAX} ta belgidan iborat bo'lishi va faqat lotin harflari, raqamlar, nuqta, pastki chiziq yoki tiredan tuzilishi kerak.`,
  weak_password: `Parol ${PAROL_MIN} ta belgidan qisqa va ${PAROL_MAX} baytdan uzun bo'lmasligi kerak.`,
  name_too_long: `Ism ${ISM_MAX} belgidan oshmasligi kerak.`,
  bad_role: "Bunday rol yo'q. Rolni ro'yxatdan tanlang.",
  duplicate: "Bunday username allaqachon band. Boshqasini tanlang.",
  self_lockout: "O'zingizning hisobingizni nofaol qila olmaysiz.",
  self_role: "O'zingizning rolingizni o'zgartira olmaysiz.",
  self_delete: "O'zingizning hisobingizni o'chira olmaysiz.",
  self_2fa:
    "O'z 2FA'ngizni bu yerdan o'chirib bo'lmaydi — xavfsizlik sahifasidan, jonli kod bilan o'chiring.",
  no_changes: "O'zgarish yo'q — hech narsa saqlanmadi.",
  not_found:
    "Admin topilmadi — u allaqachon o'chirilgan bo'lishi mumkin. Ro'yxatni yangilang.",
  bad_id: "Admin manzili noto'g'ri. Ro'yxatni yangilab, qaytadan urinib ko'ring.",
  forbidden: "Bu amal uchun ruxsat yo'q — adminlarni faqat superadmin boshqaradi.",
  rate_limited:
    "Juda ko'p so'rov yuborildi. Bir necha soniyadan so'ng qaytadan urinib ko'ring.",
};

function xatoMatni(e: unknown): string {
  const x = e as APIError | null;
  const kod = typeof x?.code === "string" ? x.code : "";
  return XATO_MATN[kod] || x?.message || "Amalni bajarib bo'lmadi.";
}

/** Figma 3.9: «Yaratilgan» ustuni — `dd.mm.yyyy`. */
function sana(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Avatardagi bosh harflar — ism bo'lsa ismdan, bo'lmasa username'dan.
 *
 * Kesish `[...s]` orqali: `s[0]` surrogat juftlikni yarmidan bo'lib,
 * ekranga buzuq belgi chiqarardi.
 */
function bosh(a: Admin): string {
  const manba = (a.name || "").trim() || a.username || "";
  const bolaklar = manba.split(/\s+/).filter(Boolean).slice(0, 2);
  const harflar = bolaklar.map((s) => [...s][0] || "").join("");
  return (harflar || "?").toUpperCase();
}

/** Parol bcrypt'da BAYT bilan o'lchanadi — 72 dan keyingisi jimgina tashlanadi. */
const bayt = (v: string) =>
  typeof TextEncoder === "undefined" ? v.length : new TextEncoder().encode(v).length;

const usernameJoiz = (v: string) => {
  const u = v.trim().toLowerCase();
  return u.length >= USER_MIN && u.length <= USER_MAX && USERNAME_RE.test(u);
};

const parolJoiz = (v: string) => bayt(v) >= PAROL_MIN && bayt(v) <= PAROL_MAX;

type Draft = {
  /** Bo'sh — yangi admin oynasi (Figma 3.9a · C). */
  id?: string;
  username: string;
  name: string;
  password: string;
  role: AdminRole;
  isActive: boolean;
  /** Ochilgandagi qiymatlar — faqat haqiqatan o'zgargani yuboriladi. */
  asliName: string;
  asliRole: AdminRole;
  asliActive: boolean;
  ozim: boolean;
};

const BOSH_DRAFT: Draft = {
  username: "",
  name: "",
  password: "",
  role: "moderator",
  isActive: true,
  asliName: "",
  asliRole: "moderator",
  asliActive: true,
  ozim: false,
};

const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

export default function AdminAdmins() {
  const [royxat, setRoyxat] = useState<Admin[] | null>(null);
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [xato, setXato] = useState("");
  const [isSuper, setIsSuper] = useState<boolean | null>(null);
  const [meId, setMeId] = useState("");

  const [oyna, setOyna] = useState<Draft | null>(null);
  const [ochirish, setOchirish] = useState<Admin | null>(null);
  const [oynaXato, setOynaXato] = useState("");
  const [saqlanmoqda, setSaqlanmoqda] = useState(false);
  const [parolKor, setParolKor] = useState(false);
  /** Amal ketayotgan qator — takroriy bosishni to'xtatadi. */
  const [bandId, setBandId] = useState("");
  /** Jadval ustidagi qizil yo'lak (Figma 3.9a · qoidalar). */
  const [yolakXato, setYolakXato] = useState("");
  /** Jadval ustidagi yashil yo'lak (Figma 3.9a · F). */
  const [yolakXabar, setYolakXabar] = useState("");
  /** «Faol» nishonining maslahati — sahifa koordinatalarida. */
  const [maslahat, setMaslahat] = useState<{ x: number; y: number } | null>(null);

  // Har so'rovga tartib raqami: sekin qaytgan ESKI javob yangi ro'yxatni
  // bosib ketmasin (ketma-ket ikki amaldan keyin).
  const soravRaqami = useRef(0);

  const yukla = useCallback(async () => {
    const men = ++soravRaqami.current;
    setYuklanmoqda(true);
    setXato("");
    try {
      const javob = await api.get<Admin[]>("/api/admin/admins", {
        auth: "admin",
      } as any);
      if (men !== soravRaqami.current) return;
      // Javob shakli tekshiriladi: buzilgan javob `.map` da butun
      // sahifani yiqitmasin.
      setRoyxat(Array.isArray(javob) ? javob : []);
    } catch (e) {
      if (men !== soravRaqami.current) return;
      setRoyxat(null);
      setXato(xatoMatni(e));
    } finally {
      if (men === soravRaqami.current) setYuklanmoqda(false);
    }
  }, []);

  useEffect(() => {
    // Rol tokendan o'qiladi, shuning uchun effekt ichida: SSR paytida
    // sessionStorage yo'q va server bilan mijoz mos kelmay qolardi.
    const super_ = getAdminRole() === "superadmin";
    setIsSuper(super_);
    if (!super_) {
      setYuklanmoqda(false);
      return;
    }
    yukla();
    // «SIZ» chipi va o'zini qulflash qoidalari uchun o'z id kerak.
    // Ro'yxat bundan qat'i nazar chiziladi: /me javob bermasa, faqat
    // chip yo'qoladi, jadval emas.
    api
      .get<Admin>("/api/admin/me", { auth: "admin" } as any)
      .then((m) => setMeId(m?.id || ""))
      .catch(() => {});
  }, [yukla]);

  // Maslahat `position: fixed` bilan chiziladi (jadval kartasi
  // `overflow-hidden`, absolyut joylashtirilgani kesilib ketardi).
  // Sahifa surilganda u joyida qotib qolmasin.
  useEffect(() => {
    if (!maslahat) return;
    const yop = () => setMaslahat(null);
    window.addEventListener("scroll", yop, true);
    window.addEventListener("resize", yop);
    return () => {
      window.removeEventListener("scroll", yop, true);
      window.removeEventListener("resize", yop);
    };
  }, [maslahat]);

  /* ── Amallar ────────────────────────────────────────────────────────
     Har biri `isSuper` ni qaytadan tekshiradi: tugmalarni yashirish
     himoya emas, funksiya esa hozir ham chaqirilishi mumkin. */

  function yolakTozala() {
    setYolakXato("");
    setYolakXabar("");
  }

  async function holatAlmash(a: Admin) {
    if (!isSuper || bandId) return;
    yolakTozala();
    // Server buni rad etadi (self_lockout) — so'rovni yubormaymiz.
    if (a.id === meId) {
      setYolakXato(XATO_MATN.self_lockout);
      return;
    }
    setBandId(a.id);
    try {
      await api.patch(
        `/api/admin/admins/${a.id}`,
        { isActive: !a.isActive },
        { auth: "admin" } as any,
      );
      await yukla();
    } catch (e) {
      setYolakXato(xatoMatni(e));
    } finally {
      setBandId("");
    }
  }

  /** Figma 3.9a · F: bir bosishda, tasdiq oynasisiz. */
  async function reset2fa(a: Admin) {
    if (!isSuper || bandId) return;
    yolakTozala();
    if (a.id === meId) {
      setYolakXato(XATO_MATN.self_2fa);
      return;
    }
    setBandId(a.id);
    try {
      await api.patch(
        `/api/admin/admins/${a.id}`,
        { disableTwoFactor: true },
        { auth: "admin" } as any,
      );
      await yukla();
      setYolakXabar(
        `@${a.username} uchun 2FA tiklandi — keyingi kirishda kod so'ralmaydi.`,
      );
    } catch (e) {
      setYolakXato(xatoMatni(e));
    } finally {
      setBandId("");
    }
  }

  function yangiOchish() {
    if (!isSuper) return;
    yolakTozala();
    setOynaXato("");
    setParolKor(false);
    setOyna({ ...BOSH_DRAFT });
  }

  function tahrirOchish(a: Admin) {
    if (!isSuper) return;
    yolakTozala();
    setOynaXato("");
    setParolKor(false);
    setOyna({
      id: a.id,
      username: a.username,
      name: a.name || "",
      password: "",
      role: a.role,
      isActive: a.isActive,
      asliName: a.name || "",
      asliRole: a.role,
      asliActive: a.isActive,
      ozim: a.id === meId,
    });
  }

  function ochirishOchish(a: Admin) {
    if (!isSuper) return;
    yolakTozala();
    // Server buni rad etadi (self_delete) — oyna ham ochilmaydi.
    if (a.id === meId) {
      setYolakXato(XATO_MATN.self_delete);
      return;
    }
    setOynaXato("");
    setOchirish(a);
  }

  async function saqla() {
    if (!oyna || !isSuper || saqlanmoqda) return;

    const ism = oyna.name.trim();
    if ([...ism].length > ISM_MAX) {
      setOynaXato(XATO_MATN.name_too_long);
      return;
    }

    if (!oyna.id) {
      // ── Yangi admin (Figma 3.9a · C) ──
      if (!usernameJoiz(oyna.username)) {
        setOynaXato(XATO_MATN.bad_username);
        return;
      }
      if (!parolJoiz(oyna.password)) {
        setOynaXato(XATO_MATN.weak_password);
        return;
      }
      setOynaXato("");
      setSaqlanmoqda(true);
      try {
        await api.post(
          "/api/admin/admins",
          {
            username: oyna.username.trim().toLowerCase(),
            name: ism,
            password: oyna.password,
            role: oyna.role,
          },
          { auth: "admin" } as any,
        );
        setOyna(null);
        yolakTozala();
        await yukla();
      } catch (e) {
        // Figma 3.9a: server xatosi oyna ICHIDA chiqadi, oyna
        // yopilmaydi — yozilgan ma'lumot yo'qolmasin.
        setOynaXato(xatoMatni(e));
      } finally {
        setSaqlanmoqda(false);
      }
      return;
    }

    // ── Mavjud admin (Figma 3.9a · D) ──
    // O'zini qulflab qo'yadigan o'zgarishlar serverda rad etiladi;
    // ularni shu yerda tutamiz — so'rov bekorga ketmasin.
    if (oyna.ozim && oyna.role !== oyna.asliRole) {
      setOynaXato(XATO_MATN.self_role);
      return;
    }
    if (oyna.ozim && !oyna.isActive && oyna.asliActive) {
      setOynaXato(XATO_MATN.self_lockout);
      return;
    }
    if (oyna.password && !parolJoiz(oyna.password)) {
      setOynaXato(XATO_MATN.weak_password);
      return;
    }

    // Faqat HAQIQATAN o'zgargan maydon yuboriladi: server rol, holat va
    // parol o'zgarganda o'sha adminning barcha seanslarini bekor qiladi,
    // ya'ni ortiqcha yuborilgan maydon uni ish ustida tizimdan
    // chiqarib yuborardi.
    const tana: Record<string, unknown> = {};
    if (ism !== oyna.asliName) tana.name = ism;
    if (oyna.role !== oyna.asliRole) tana.role = oyna.role;
    if (oyna.isActive !== oyna.asliActive) tana.isActive = oyna.isActive;
    if (oyna.password) tana.password = oyna.password;

    if (!Object.keys(tana).length) {
      setOynaXato(XATO_MATN.no_changes);
      return;
    }

    setOynaXato("");
    setSaqlanmoqda(true);
    try {
      await api.patch(`/api/admin/admins/${oyna.id}`, tana, {
        auth: "admin",
      } as any);
      setOyna(null);
      yolakTozala();
      await yukla();
    } catch (e) {
      setOynaXato(xatoMatni(e));
    } finally {
      setSaqlanmoqda(false);
    }
  }

  async function ochir() {
    if (!ochirish || !isSuper || saqlanmoqda) return;
    setOynaXato("");
    setSaqlanmoqda(true);
    try {
      await api.delete(`/api/admin/admins/${ochirish.id}`, {
        auth: "admin",
      } as any);
      setOchirish(null);
      yolakTozala();
      await yukla();
    } catch (e) {
      setOynaXato(xatoMatni(e));
    } finally {
      setSaqlanmoqda(false);
    }
  }

  const qatorlar = royxat ?? [];
  const faolSoni = qatorlar.filter((a) => a.isActive).length;
  // Birinchi yuklanish — skelet qatorlar. Keyingi yuklanishlarda jadval
  // joyida qoladi: amaldan keyingi yangilanish ekranni sakratmasin.
  const birinchiYuklanish = yuklanmoqda && !royxat && !xato;

  const karta: React.CSSProperties = {
    boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}`,
  };
  const ustun = (px: number) => ({ width: `${(px / 1152) * 100}%` });

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha kartasi (Figma: 83 px, pad 16/20, oraliq 14) ────── */}
      <div
        className="flex h-[83px] items-center gap-[14px] rounded-2xl bg-white px-5"
        style={karta}
      >
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-[31px]" style={{ color: IK }}>
            Adminlar
          </h1>
          {/* Ikkinchi qator HAR DOIM chiziladi. Yashirilsa, sarlavha
              yuklanish paytida sakrab, keyin qayta paydo bo'lardi —
              soni yo'q bo'lsa ham buni ochiq aytamiz. */}
          <p className="mt-[2px] text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            {isSuper === false
              ? "Bu ro'yxat faqat superadminga ochiq"
              : royxat
                ? `Jami ${qatorlar.length} ta admin · ${faolSoni} tasi faol`
                : yuklanmoqda
                  ? "Yuklanmoqda…"
                  : "Jami soni aniqlanmadi"}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-[14px]">
          {/* Nishon HAMMAGA ko'rinadi: superadmin bo'lmagan admin uchun
              bu ekran nega bo'shligining javobi. */}
          <span
            className="inline-flex h-[25px] shrink-0 items-center gap-[6px] rounded-lg px-[10px] py-[5px]"
            style={{ background: AVATAR_FON }}
          >
            <Shield size={13} aria-hidden style={{ color: OCH_KUL }} />
            <span
              className="whitespace-nowrap text-[11px] font-medium leading-[15px]"
              style={{ color: OCH_KUL }}
            >
              Faqat superadmin
            </span>
          </span>
          {isSuper && (
            <button
              type="button"
              onClick={yangiOchish}
              className={`inline-flex h-10 shrink-0 select-none items-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold leading-5 text-white transition-[filter] hover:brightness-95 ${FOKUS}`}
              style={{ background: KO_K }}
            >
              <Plus size={16} aria-hidden />
              Yangi admin
            </button>
          )}
        </div>
      </div>

      {/* Superadmin bo'lmasa: jadval umuman chizilmaydi va ro'yxat
          so'ralmaydi. Bo'sh jadval "adminlar yo'q" bo'lib o'qilardi. */}
      {isSuper === false ? (
        <div
          className="flex items-start gap-[10px] rounded-xl px-4 py-3"
          style={{ background: MODER_FON }}
        >
          <Lock size={16} aria-hidden className="mt-[2px] shrink-0" style={{ color: ORANJ }} />
          <p className="text-[13px] leading-[18px]" style={{ color: ORANJ_MATN }}>
            Bu ekran faqat superadminga ochiq. Boshqaruv hisoblarini ko&apos;rish va
            o&apos;zgartirish uchun superadminga murojaat qiling.
          </p>
        </div>
      ) : (
        <>
          {/* Qizil yo'lak — Figma 3.9a: «O'zingizning hisobingizni nofaol
              qila olmaysiz.» va shu oiladagi boshqa rad javoblari. */}
          {yolakXato && (
            <div
              role="alert"
              className="flex items-center gap-[10px] rounded-[11px] px-[14px] py-3"
              style={{ background: XAVF_FON }}
            >
              <CircleAlert size={17} aria-hidden className="shrink-0" style={{ color: QIZIL }} />
              <p className="text-[13px] font-medium leading-[19px]" style={{ color: QIZIL }}>
                {yolakXato}
              </p>
            </div>
          )}

          {/* Yashil yo'lak — Figma 3.9a · F. Qizil yo'lak bilan BIR XIL
              qutida: ikkalasi ham jadval ustidagi o'sha yagona joyni
              egallaydi, faqat rangi va ikonkasi boshqa. */}
          {yolakXabar && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-[10px] rounded-[11px] px-[14px] py-3"
              style={{ background: FAOL_FON }}
            >
              <CircleCheck
                size={17}
                aria-hidden
                className="shrink-0"
                style={{ color: FAOL_MATN }}
              />
              <p
                className="text-[13px] font-medium leading-[19px]"
                style={{ color: FAOL_MATN }}
              >
                {yolakXabar}
              </p>
            </div>
          )}

          {/* ── Jadval kartasi (Figma: 1168, radius 16) ──────────────── */}
          <div className="overflow-hidden rounded-2xl bg-white" style={karta}>
            <div className="overflow-x-auto">
              <div className="min-w-[1040px]">
                {/* Jadval sarlavhasi — 46 px, fon #eef1fb, 12 Semi Bold. */}
                <div
                  className="flex h-[46px] items-center"
                  style={{ background: AVATAR_FON }}
                >
                  <div
                    className="shrink-0 truncate pl-5 pr-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(260), color: KUL }}
                  >
                    Admin
                  </div>
                  <div
                    className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(140), color: KUL }}
                  >
                    Rol
                  </div>
                  <div
                    className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(140), color: KUL }}
                  >
                    Holat
                  </div>
                  <div
                    className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(118), color: KUL }}
                    title="Ikki bosqichli tasdiqlash"
                  >
                    2FA
                  </div>
                  <div
                    className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(154), color: KUL }}
                  >
                    Yaratilgan
                  </div>
                  <div
                    className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                    style={{ ...ustun(340), color: KUL }}
                  >
                    Amallar
                  </div>
                </div>

                {xato && !qatorlar.length ? (
                  /* Xato holati. Bo'sh jadval CHIZILMAYDI: admin uni
                     "admin yo'q" deb o'qib, noto'g'ri xulosaga kelardi. */
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-col items-center gap-[10px] px-5 py-[64px] text-center"
                  >
                    <TriangleAlert size={34} aria-hidden style={{ color: QIZIL }} />
                    <p
                      className="text-[15px] font-semibold leading-[22px]"
                      style={{ color: QIZIL }}
                    >
                      Ro&apos;yxatni yuklab bo&apos;lmadi
                    </p>
                    {/* Xatoning o'zi ham ko'rsatiladi: "server javob
                        bermadi" bilan "sessiya tugadi" butunlay boshqa
                        harakat talab qiladi. */}
                    <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                      {xato}
                    </p>
                    <button
                      type="button"
                      onClick={yukla}
                      className={`mt-1 inline-flex h-10 select-none items-center rounded-[10px] px-4 text-[13px] font-semibold leading-[19px] text-white transition-[filter] hover:brightness-95 ${FOKUS}`}
                      style={{ background: KO_K }}
                    >
                      Qayta urinish
                    </button>
                  </div>
                ) : birinchiYuklanish ? (
                  /* Yuklanmoqda — Figma 3.9a: 5 ta skelet qator, balandligi
                     ham 68 px: javob kelganda jadval sakrab ketmaydi. */
                  <div role="status" aria-live="polite">
                    <span className="sr-only">Adminlar yuklanmoqda…</span>
                    {Array.from({ length: SKELET }, (_, i) => (
                      <div
                        key={i}
                        aria-hidden
                        className="flex h-[68px] items-center"
                        style={{
                          background: i % 2 === 1 ? ZEBRA : "#ffffff",
                          boxShadow: `inset 0 -1px 0 ${HOSHIYA}`,
                        }}
                      >
                        <div
                          className="flex shrink-0 items-center gap-[11px] pl-5 pr-3"
                          style={ustun(260)}
                        >
                          <div
                            className="h-9 w-9 shrink-0 animate-pulse rounded-full"
                            style={{ background: HOSHIYA }}
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
                            <div
                              className="h-[14px] w-[70%] animate-pulse rounded"
                              style={{ background: HOSHIYA }}
                            />
                            <div
                              className="h-[11px] w-[50%] animate-pulse rounded"
                              style={{ background: HOSHIYA }}
                            />
                          </div>
                        </div>
                        <div className="shrink-0 px-3" style={ustun(140)}>
                          <div
                            className="h-[25px] w-[92px] animate-pulse rounded-[13px]"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-3" style={ustun(140)}>
                          <div
                            className="h-[27px] w-[76px] animate-pulse rounded-[14px]"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-3" style={ustun(118)}>
                          <div
                            className="h-[25px] w-[60px] animate-pulse rounded-[7px]"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-3" style={ustun(154)}>
                          <div
                            className="h-[13px] w-[70px] animate-pulse rounded"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-2 px-3"
                          style={ustun(340)}
                        >
                          <div
                            className="h-[31px] w-[72px] animate-pulse rounded-lg"
                            style={{ background: HOSHIYA }}
                          />
                          <div
                            className="h-[31px] w-[90px] animate-pulse rounded-lg"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !qatorlar.length ? (
                  /* Bo'sh holat — Figma 3.9a: tugmasiz. Sarlavhadagi
                     «+ Yangi admin» allaqachon ekranda turibdi. */
                  <div className="flex flex-col items-center gap-[10px] px-5 py-[64px] text-center">
                    <UserRound size={34} aria-hidden style={{ color: XIRA_QUYUQ }} />
                    <p
                      className="text-[15px] font-semibold leading-[22px]"
                      style={{ color: IK }}
                    >
                      Adminlar yo&apos;q
                    </p>
                    <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                      Ro&apos;yxat bo&apos;sh — «+ Yangi admin» orqali birinchisini
                      qo&apos;shing.
                    </p>
                  </div>
                ) : (
                  qatorlar.map((a, i) => (
                    <AdminQatori
                      key={a.id}
                      a={a}
                      ozim={!!meId && a.id === meId}
                      juft={i % 2 === 1}
                      ustun={ustun}
                      band={bandId === a.id}
                      qulf={!!bandId}
                      onToggle={() => holatAlmash(a)}
                      onReset2fa={() => reset2fa(a)}
                      onEdit={() => tahrirOchish(a)}
                      onDelete={() => ochirishOchish(a)}
                      onMaslahat={setMaslahat}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Jadval oyoqchasi — Figma: 52 px, «sahifalash yo'q» izohi. */}
            {!!qatorlar.length && (
              <div className="flex h-[52px] items-center gap-[10px] px-5">
                <Info size={15} aria-hidden className="shrink-0" style={{ color: OCH_KUL }} />
                <p className="text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
                  Bu ekranda sahifalash yo&apos;q — barcha adminlar bitta
                  ro&apos;yxatda.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Maslahat — Figma 3.9a: o'z qatoridagi «Faol» nishoni ustida.
          `fixed`, chunki jadval kartasi `overflow-hidden`: ichkarida
          absolyut joylashtirilgan maslahat kesilib ketardi. */}
      {maslahat && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 flex-col items-center"
          style={{ left: maslahat.x, top: maslahat.y }}
        >
          <span
            style={{
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderBottom: `8px solid ${IK}`,
            }}
          />
          <span
            className="flex h-[33px] items-center gap-[7px] whitespace-nowrap rounded-[9px] px-3"
            style={{ background: IK }}
          >
            <Lock size={14} className="shrink-0 text-white" />
            <span className="text-[12px] font-medium leading-[17px] text-white">
              O&apos;z hisobingizni nofaol qila olmaysiz
            </span>
          </span>
        </div>
      )}

      {/* ── C / D. Yaratish va tahrirlash oynasi (Figma 3.9a) ────────── */}
      <AdminOynaQobiq
        open={!!oyna}
        onClose={() => setOyna(null)}
        title={oyna?.id ? `Admin: @${oyna.username}` : "Yangi admin"}
        maxWidth="max-w-[545px]"
        radius="rounded-[18px]"
      >
        {oyna && (
          <>
            <div
              className="flex items-center gap-[10px] py-[18px] pl-5 pr-[18px]"
              style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
            >
              <div className="min-w-0 flex-1">
                <h2
                  className="truncate text-[17px] font-semibold leading-[25px]"
                  style={{ color: IK }}
                >
                  {oyna.id ? `Admin: @${oyna.username}` : "Yangi admin"}
                </h2>
                <p
                  className="mt-[2px] truncate text-[12px] leading-[17px]"
                  style={{ color: OCH_KUL }}
                >
                  {oyna.id
                    ? "Mavjud admin hisobini tahrirlash"
                    : "Yangi boshqaruv hisobi ochish"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOyna(null)}
                aria-label="Yopish"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-[filter] hover:brightness-95 ${FOKUS}`}
                style={{ background: AVATAR_FON, color: OCH_KUL }}
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-[14px] px-5 py-[18px]">
              <Maydon nomi="Ism (to'liq ism)">
                <Kirit
                  nomi="Ism"
                  qiymat={oyna.name}
                  ozgardi={(v) => setOyna({ ...oyna, name: v })}
                  placeholder="Masalan: Diyorbek Primqulov"
                  maxLength={ISM_MAX}
                  ozi
                />
              </Maydon>

              {/* Maydonlar tartibi Figma'dan AYNAN olingan va ikki
                  oynada boshqacha: C — Ism · Username · Parol · Rol;
                  D — Ism · Rol · Faol · Yangi parol. Tartibni birlashtirib
                  yuborish ikkala maketdan ham chetga chiqarardi. */}
              {oyna.id ? (
                <>
                  <RolMaydoni
                    tahrir
                    qiymat={oyna.role}
                    ozgardi={(v) => setOyna({ ...oyna, role: v })}
                  />
                  <Belgilash
                    nomi="Faol"
                    toliq
                    balandlik={46}
                    radius={10}
                    chap={14}
                    oraliq={10}
                    belgilangan={oyna.isActive}
                    ozgardi={(v) => setOyna({ ...oyna, isActive: v })}
                  />
                  <ParolMaydoni
                    tahrir
                    qiymat={oyna.password}
                    ozgardi={(v) => setOyna({ ...oyna, password: v })}
                    kor={parolKor}
                    korOzgardi={() => setParolKor((v) => !v)}
                  />
                </>
              ) : (
                <>
                  <Maydon nomi="Username" majburiy>
                    <Kirit
                      nomi="Username"
                      qiymat={oyna.username}
                      // Username serverda ham kichik harfga keltiriladi;
                      // shu yerda ham darrov keltiramiz, aks holda admin
                      // «Aziza» yozib, keyin ro'yxatda «aziza» ni ko'rib
                      // hayron bo'lardi.
                      ozgardi={(v) => setOyna({ ...oyna, username: v.toLowerCase() })}
                      placeholder="diyorbek"
                      maxLength={USER_MAX}
                      autoComplete="off"
                    />
                  </Maydon>
                  <ParolMaydoni
                    qiymat={oyna.password}
                    ozgardi={(v) => setOyna({ ...oyna, password: v })}
                    kor={parolKor}
                    korOzgardi={() => setParolKor((v) => !v)}
                  />
                  <RolMaydoni
                    qiymat={oyna.role}
                    ozgardi={(v) => setOyna({ ...oyna, role: v })}
                  />
                </>
              )}

              {/* Izoh — Figma 3.9a · C da BOR, D da YO'Q. Shuning uchun u
                  faqat yaratish oynasida chiziladi; tahrirlash oynasidagi
                  ogohlantirish maydonlarning o'z tavsifiga ko'chirildi
                  (`RolMaydoni` / `ParolMaydoni`), aks holda oyna Figma
                  maketidan 46 px balandroq chiqardi.

                  Chegara serverning haqiqiy chegarasi bilan bir xil
                  yoziladi: oynada «6 belgi» deb turib, serverdan rad javob
                  olish eng yomon variant. */}
              {!oyna.id && (
                <p className="text-[11px] leading-4" style={{ color: OCH_KUL }}>
                  Username bo&apos;sh yoki parol {PAROL_MIN} belgidan qisqa
                  bo&apos;lsa — «Yaratish» o&apos;chiq turadi.
                </p>
              )}

              {oyna.ozim && (
                <p className="text-[11px] leading-4" style={{ color: OCH_KUL }}>
                  Bu — sizning hisobingiz: o&apos;z rolingizni o&apos;zgartirib ham,
                  o&apos;zingizni nofaol qilib ham bo&apos;lmaydi.
                </p>
              )}

              {oynaXato && <OynaXato matn={oynaXato} />}

              <div className="flex h-10 items-center justify-end gap-[10px]">
                <OynaTugma kor="ikkilamchi" onClick={() => setOyna(null)}>
                  Bekor
                </OynaTugma>
                <OynaTugma
                  kor="asosiy"
                  onClick={saqla}
                  ochiq={
                    saqlanmoqda ||
                    (!oyna.id &&
                      (!usernameJoiz(oyna.username) || !parolJoiz(oyna.password)))
                  }
                >
                  {saqlanmoqda
                    ? "Saqlanmoqda…"
                    : oyna.id
                      ? "Saqlash"
                      : "Yaratish"}
                </OynaTugma>
              </div>
            </div>
          </>
        )}
      </AdminOynaQobiq>

      {/* ── E. O'chirish oynasi (Figma 3.9a · E) ─────────────────────── */}
      <AdminOynaQobiq
        open={!!ochirish}
        onClose={() => {
          setOchirish(null);
          setOynaXato("");
        }}
        title={`@${ochirish?.username} o'chiriladi`}
        maxWidth="max-w-[545px]"
        radius="rounded-[18px]"
      >
        {ochirish && (
          /* Bu oynada yopish nishoni ATAYLAB yo'q (Figma 3.9a · E):
             o'chirish so'rovi ikkita ochiq javobga ega bo'lishi kerak —
             tasodifan bosilgan «×» «yo'q» degani emas. Escape va
             qoplamaga bosish esa `AdminOynaQobiq` da ishlaydi. */
          <div className="flex flex-col gap-[14px] p-5">
            <div className="flex items-start gap-3">
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                style={{ background: XAVF_FON }}
              >
                <Trash2 size={22} aria-hidden style={{ color: QIZIL }} />
              </div>
              <div className="min-w-0">
                <h2
                  className="text-[17px] font-semibold leading-[25px]"
                  style={{ color: IK }}
                >
                  Adminni o&apos;chirasizmi?
                </h2>
                <p className="mt-[3px] text-[13px] leading-[19px]" style={{ color: KUL }}>
                  «@{ochirish.username}» admin hisobi o&apos;chiriladi. Amalni ortga
                  qaytarib bo&apos;lmaydi.
                </p>
              </div>
            </div>

            {oynaXato && <OynaXato matn={oynaXato} />}

            <div className="flex h-10 items-center justify-end gap-[10px]">
              <OynaTugma
                kor="ikkilamchi"
                onClick={() => {
                  setOchirish(null);
                  setOynaXato("");
                }}
              >
                Yo&apos;q
              </OynaTugma>
              <OynaTugma kor="xavf" onClick={ochir} ochiq={saqlanmoqda}>
                {saqlanmoqda ? "O'chirilmoqda…" : "Ha, o'chirish"}
              </OynaTugma>
            </div>
          </div>
        )}
      </AdminOynaQobiq>
    </div>
  );
}

/* ── Jadval qatori ──────────────────────────────────────────────────── */

/**
 * Admin qatori — Figma 3.9: 68 px, toq qator oq, juft qator #f8f9ff,
 * O'Z qatori esa har doim bo'yalgan; ostida 1 px hoshiya.
 */
function AdminQatori({
  a,
  ozim,
  juft,
  ustun,
  band,
  qulf,
  onToggle,
  onReset2fa,
  onEdit,
  onDelete,
  onMaslahat,
}: {
  a: Admin;
  ozim: boolean;
  juft: boolean;
  ustun: (px: number) => { width: string };
  /** Aynan shu qatorda so'rov ketmoqda. */
  band: boolean;
  /** Boshqa qatorda so'rov ketmoqda — takroriy bosishni to'xtatamiz. */
  qulf: boolean;
  onToggle: () => void;
  onReset2fa: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMaslahat: (v: { x: number; y: number } | null) => void;
}) {
  const rol = rolUslub(a.role);
  const faol = a.isActive;
  // Figma 3.9a: «Nofaol admin qatori xiralashadi». 3.9 ning statik
  // maketida 5-qator oddiy rangda chizilgan, lekin qoida 3.9a da —
  // shuning uchun qoida ustun.
  const ismRang = faol ? IK : OCH_KUL;

  return (
    <div
      className="flex h-[68px] items-center"
      style={{
        background: ozim || juft ? ZEBRA : "#ffffff",
        boxShadow: `inset 0 -1px 0 ${HOSHIYA}`,
      }}
    >
      {/* Admin — 36×36 avatar + ism/username */}
      <div
        className="flex min-w-0 shrink-0 items-center gap-[11px] pl-5 pr-3"
        style={ustun(260)}
      >
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold"
          style={{ background: rol.fon, color: rol.matn, opacity: faol ? 1 : 0.7 }}
        >
          {bosh(a)}
        </span>
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex min-w-0 items-center gap-[6px]">
            <span
              className="truncate text-[14px] font-semibold leading-5"
              style={{ color: ismRang }}
              title={a.name || a.username}
            >
              {a.name || a.username}
            </span>
            {ozim && (
              <span
                className="shrink-0 rounded-[5px] px-[7px] py-[2px] text-[10px] font-bold leading-[14px]"
                style={{ background: SUPER_FON, color: KO_K }}
              >
                SIZ
              </span>
            )}
          </span>
          <span
            className="truncate text-[12px] leading-[17px]"
            style={{ color: OCH_KUL }}
            title={`@${a.username}`}
          >
            @{a.username}
          </span>
        </span>
      </div>

      {/* Rol */}
      <div className="flex min-w-0 shrink-0 px-3" style={ustun(140)}>
        <span
          className="inline-flex h-[25px] max-w-full shrink-0 items-center gap-[6px] rounded-[13px] px-[10px]"
          style={{ background: rol.fon }}
          title={rol.izoh}
        >
          <span
            aria-hidden
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: rol.matn }}
          />
          <span
            className="truncate text-[12px] font-medium leading-[17px]"
            style={{ color: rol.matn }}
          >
            {a.role}
          </span>
        </span>
      </div>

      {/* Holat — o'z qatorida qulflangan, boshqalarida almashtirgich */}
      <div className="flex shrink-0 px-3" style={ustun(140)}>
        <HolatNishon
          faol={faol}
          ozim={ozim}
          band={band}
          ochiq={qulf && !band}
          onClick={onToggle}
          onMaslahat={onMaslahat}
        />
      </div>

      {/* 2FA */}
      <div className="flex shrink-0 px-3" style={ustun(118)}>
        {a.totpEnabled ? (
          <span
            className="inline-flex h-[25px] shrink-0 items-center gap-[5px] rounded-[7px] px-[9px]"
            style={{ background: FAOL_FON }}
          >
            <Check size={12} strokeWidth={3} aria-hidden style={{ color: YASHIL }} />
            <span
              className="whitespace-nowrap text-[12px] font-medium leading-[17px]"
              style={{ color: YASHIL }}
            >
              yoqilgan
            </span>
          </span>
        ) : (
          <span className="text-[14px] leading-5" style={{ color: XIRA_QUYUQ }}>
            —
            <span className="sr-only">2FA yoqilmagan</span>
          </span>
        )}
      </div>

      {/* Yaratilgan */}
      <div
        className="shrink-0 truncate px-3 text-[13px] leading-[18px]"
        style={{ ...ustun(154), color: KUL }}
      >
        {sana(a.createdAt)}
      </div>

      {/* Amallar — Figma 3.9: «2FA reset» faqat 2FA yoqilgan adminda.
          «Tahrir» va «O'chirish» har doim joyida (dizayn birxilligi);
          o'z qatorida bosilgani so'rov yubormay, jadval ustidagi qizil
          yo'lakka aylanadi. */}
      <div className="flex shrink-0 items-center gap-2 px-3" style={ustun(340)}>
        {a.totpEnabled && (
          <button
            type="button"
            onClick={onReset2fa}
            disabled={band || qulf}
            title="Ikki bosqichli tasdiqlashni tiklash"
            className={`inline-flex h-[31px] shrink-0 select-none items-center gap-[5px] rounded-lg px-[10px] text-[12px] font-semibold leading-[17px] transition-colors ${FOKUS} ${
              band || qulf
                ? "cursor-not-allowed bg-[#fdf3e4] opacity-70"
                : "bg-[#fdf3e4] hover:bg-[#fae7cd]"
            }`}
            style={{ color: ORANJ }}
          >
            <RotateCcw size={13} aria-hidden />
            2FA reset
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className={`inline-flex h-[31px] shrink-0 select-none items-center gap-[5px] rounded-lg bg-[#eef1fb] px-[10px] text-[12px] font-semibold leading-[17px] transition-colors hover:bg-[#e4e9f8] ${FOKUS}`}
          style={{ color: KUL }}
        >
          <Pencil size={13} aria-hidden />
          Tahrir
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={band || qulf}
          className={`inline-flex h-[31px] shrink-0 select-none items-center gap-[5px] rounded-lg px-[10px] text-[12px] font-semibold leading-[17px] transition-colors ${FOKUS} ${
            band || qulf
              ? "cursor-not-allowed bg-[#fcebec] opacity-70"
              : "bg-[#fcebec] hover:bg-[#f9dcde]"
          }`}
          style={{ color: QIZIL }}
        >
          <Trash2 size={13} aria-hidden />
          O&apos;chirish
        </button>
      </div>
    </div>
  );
}

/**
 * Holat nishoni — Figma 3.9: «Faol» yashil, «Nofaol» kulrang,
 * ikkalasi ham bosiladigan almashtirgich.
 *
 * # NEGA O'Z QATORIDA `<span>`
 *
 * Server o'z hisobini nofaol qilishni rad etadi (self_lockout). Figma
 * uni qulf ikonkasi va 70% shaffoflik bilan chizadi — ya'ni "bor,
 * lekin bosilmaydi". `<button disabled>` emas: o'chirilgan tugma
 * klaviatura bilan yuriladigan yo'lda "nega ishlamadi?" savolini
 * tug'dirardi. Sabab esa `sr-only` matn bo'lib yonida turadi va
 * sichqoncha bilan maslahat oynasida chiqadi.
 *
 * # NEGA FON `style` DA EMAS, SINFDA
 *
 * Hover rangi Figma'da alohida berilgan, inline `style` esa
 * Tailwind'ning `hover:` sinfini bosib ketardi.
 */
function HolatNishon({
  faol,
  ozim,
  band,
  ochiq,
  onClick,
  onMaslahat,
}: {
  faol: boolean;
  ozim: boolean;
  band: boolean;
  ochiq: boolean;
  onClick: () => void;
  onMaslahat: (v: { x: number; y: number } | null) => void;
}) {
  const asos =
    "inline-flex h-[27px] shrink-0 items-center gap-[6px] rounded-[14px] px-[10px]";
  const hoshiya = `inset 0 0 0 1px ${faol ? FAOL_HOSHIYA : HOSHIYA}`;
  const rang = faol ? YASHIL : OCH_KUL;
  const nuqta = faol ? YASHIL : XIRA_QUYUQ;
  const ich = (
    <>
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: nuqta }}
      />
      <span
        className="whitespace-nowrap text-[12px] font-medium leading-[17px]"
        style={{ color: rang }}
      >
        {faol ? "Faol" : "Nofaol"}
      </span>
      {ozim ? (
        <Lock size={12} aria-hidden className="shrink-0" style={{ color: nuqta }} />
      ) : (
        <ArrowLeftRight
          size={12}
          aria-hidden
          className="shrink-0"
          style={{ color: nuqta }}
        />
      )}
    </>
  );

  if (ozim) {
    return (
      <span
        className={`${asos} ${faol ? "bg-[#e6f5ed]" : "bg-[#eef1fb]"} opacity-70`}
        style={{ boxShadow: hoshiya }}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMaslahat({ x: r.left + r.width / 2, y: r.bottom + 6 });
        }}
        onMouseLeave={() => onMaslahat(null)}
      >
        {ich}
        <span className="sr-only">— o&apos;z hisobingizni nofaol qila olmaysiz</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={band || ochiq}
      // Nishon holatni ALMASHTIRADI, shuning uchun `aria-label` keyingi
      // natijani aytadi: ekran o'qigichida "Faol" tugmasi nima qilishi
      // noma'lum bo'lib qolardi.
      aria-label={faol ? "Adminni nofaol qilish" : "Adminni faollashtirish"}
      title={faol ? "Nofaol qilish" : "Faollashtirish"}
      className={`${asos} select-none transition-colors ${FOKUS} ${
        band || ochiq
          ? `cursor-not-allowed ${faol ? "bg-[#e6f5ed]" : "bg-[#eef1fb]"} opacity-70`
          : faol
            ? "bg-[#e6f5ed] hover:bg-[#d6f0e2]"
            : "bg-[#eef1fb] hover:bg-[#e4e9f8]"
      }`}
      style={{ boxShadow: hoshiya }}
    >
      {ich}
    </button>
  );
}

/* ── Oyna bo'laklari ────────────────────────────────────────────────── */

/** Figma 3.9a: maydon = yorliq (12 Semi Bold) + tana, oraliq 6. */
function Maydon({
  nomi,
  majburiy,
  children,
}: {
  nomi: string;
  majburiy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-center gap-1">
        <span className="text-[12px] font-semibold leading-[17px]" style={{ color: KUL }}>
          {nomi}
        </span>
        {majburiy && (
          <span
            className="text-[12px] font-bold leading-[17px]"
            aria-hidden
            style={{ color: QIZIL }}
          >
            *
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Parol maydoni — Figma 3.9a · C («Parol *») va D («Yangi parol
 * (ixtiyoriy)»). Ikki oynada bir xil chizilgan, faqat yorlig'i va
 * placeholder'i boshqa, shuning uchun bitta komponent.
 *
 * Modul darajasida yozilgan: oyna ichida `const` bo'lib qolsa, har
 * bosishda YANGI komponent turi yaralib, React maydonni qaytadan
 * ulardi — kursor har harfda yo'qolardi.
 */
function ParolMaydoni({
  tahrir,
  qiymat,
  ozgardi,
  kor,
  korOzgardi,
}: {
  /** Mavjud adminni tahrirlash — parol ixtiyoriy. */
  tahrir?: boolean;
  qiymat: string;
  ozgardi: (v: string) => void;
  kor: boolean;
  korOzgardi: () => void;
}) {
  // Tahrirlash oynasida (Figma D) pastda izoh qatori yo'q, shuning uchun
  // seans ogohlantirishi maydonning o'z tavsifida turadi — balandlik
  // o'zgarmaydi, ma'lumot esa yo'qolmaydi.
  const tavsif = tahrir
    ? `Bo'sh qoldirsangiz parol o'zgarmaydi. Parolni o'zgartirsangiz, o'sha adminning barcha seanslari bekor qilinadi. Parol — kamida ${PAROL_MIN} belgi.`
    : undefined;
  return (
    <Maydon nomi={tahrir ? "Yangi parol (ixtiyoriy)" : "Parol"} majburiy={!tahrir}>
      <Kirit
        nomi={tahrir ? "Yangi parol" : "Parol"}
        tur={kor ? "text" : "password"}
        qiymat={qiymat}
        ozgardi={ozgardi}
        placeholder={
          tahrir ? "bo'sh qoldirsangiz o'zgarmaydi" : `kamida ${PAROL_MIN} belgi`
        }
        maxLength={PAROL_MAX}
        autoComplete="new-password"
        maslahat={tavsif}
        tavsifId={tahrir ? "parol-tavsifi" : undefined}
        oxir={
          <button
            type="button"
            onClick={korOzgardi}
            aria-label={kor ? "Parolni yashirish" : "Parolni ko'rsatish"}
            className={`grid h-6 w-6 place-items-center rounded ${FOKUS}`}
            style={{ color: OCH_KUL }}
          >
            {kor ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        }
      />
      {tavsif && (
        <span id="parol-tavsifi" className="sr-only">
          {tavsif}
        </span>
      )}
    </Maydon>
  );
}

/**
 * Rol maydoni — Figma 3.9a · C va D dagi «Rol» tanlovi.
 *
 * # NEGA izoh ko'rinmas
 * Rol tavsifi 3.9a ning rol jadvalidan olingan — «support» ni tanlagan
 * admin uning nimaga ruxsat berishini shu yerdan bilishi kerak. Lekin
 * maketda tanlov ostida matn qatori YO'Q: uni chizsak, oyna 22 px
 * balandroq bo'lib, C ham, D ham Figma o'lchamidan chetga chiqardi.
 * Shuning uchun matn `title` (sichqoncha) va `aria-describedby` +
 * `sr-only` (ekran o'quvchisi) orqali beriladi — ikkalasi ham
 * joylashuvga bir piksel ham qo'shmaydi.
 *
 * # NIMA ATAYLAB YO'Q
 * Tahrirlash oynasida rol o'zgarishi seanslarni bekor qilishi haqidagi
 * ogohlantirish ham shu yerga qo'shiladi — pastdagi alohida qator emas
 * (Figma D da unday qator yo'q).
 */
function RolMaydoni({
  tahrir,
  qiymat,
  ozgardi,
}: {
  /** Mavjud adminni tahrirlash — seans ogohlantirishi qo'shiladi. */
  tahrir?: boolean;
  qiymat: AdminRole;
  ozgardi: (v: AdminRole) => void;
}) {
  const tavsif = tahrir
    ? `${rolUslub(qiymat).izoh} Rolni o'zgartirsangiz, o'sha adminning barcha seanslari bekor qilinadi.`
    : rolUslub(qiymat).izoh;
  return (
    <Maydon nomi="Rol">
      <Tanla
        nomi="Rol"
        qiymat={qiymat}
        ozgardi={(v) => ozgardi(v as AdminRole)}
        maslahat={tavsif}
        tavsifId="rol-tavsifi"
      >
        {ROLLAR.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Tanla>
      <span id="rol-tavsifi" className="sr-only">
        {tavsif}
      </span>
    </Maydon>
  );
}

/**
 * Oyna maydoni — Figma 3.9a: 505×44, radius 10, hoshiya #c3c6d7,
 * matn 14/20 (placeholder Regular #9aa0b0, to'ldirilgani Medium).
 *
 * `oxir` — maydon ichidagi o'ng nishon (parolni ko'rsatish ko'zi).
 * `maxLength` MAJBURIY: chegara serverda ham bor, lekin admin 300 belgi
 * yozib bo'lib, keyin rad javob olishi kerak emas.
 */
function Kirit({
  nomi,
  qiymat,
  ozgardi,
  placeholder,
  maxLength,
  tur = "text",
  autoComplete,
  maslahat,
  tavsifId,
  ozi,
  oxir,
}: {
  nomi: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  placeholder: string;
  maxLength: number;
  tur?: "text" | "password";
  autoComplete?: string;
  /** Sichqoncha ostidagi izoh — maketga balandlik qo'shmaydi. */
  maslahat?: string;
  /** Ekran o'quvchisi uchun `sr-only` tavsif bloki id'si. */
  tavsifId?: string;
  /** Oyna ochilganda kursor shu maydonda bo'ladi. */
  ozi?: boolean;
  oxir?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <input
        aria-label={nomi}
        title={maslahat}
        aria-describedby={tavsifId}
        type={tur}
        autoComplete={autoComplete}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={ozi}
        className={`w-full rounded-[10px] bg-white font-medium outline-none placeholder:font-normal placeholder:text-[#9aa0b0] ${FOKUS}`}
        style={{
          height: 44,
          paddingLeft: 14,
          paddingRight: oxir ? 42 : 14,
          fontSize: 14,
          lineHeight: "20px",
          color: IK,
          boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
        }}
        value={qiymat}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => ozgardi(e.target.value)}
      />
      {oxir && (
        <span className="absolute right-[12px] top-1/2 -translate-y-1/2">{oxir}</span>
      )}
    </div>
  );
}

/**
 * Oyna tanlovi — Figma 3.9a: 505×44, o'ngda 15 px strelka.
 *
 * `components/admin/Filtr.tsx` dagi `Tanlov` EMAS: u filtr yo'lagi
 * uchun 38 px va 9 px radiusda chizilgan, bu yerdagisi esa oyna
 * maydonlari bilan bir o'lchamda (44 / 10) turishi kerak.
 */
function Tanla({
  nomi,
  qiymat,
  ozgardi,
  maslahat,
  tavsifId,
  children,
}: {
  nomi: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  /** Sichqoncha ostidagi izoh — maketga balandlik qo'shmaydi. */
  maslahat?: string;
  /** Ekran o'quvchisi uchun `sr-only` tavsif bloki id'si. */
  tavsifId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={nomi}
        title={maslahat}
        aria-describedby={tavsifId}
        className={`w-full cursor-pointer appearance-none rounded-[10px] bg-white pl-[14px] pr-[36px] font-medium outline-none ${FOKUS}`}
        style={{
          height: 44,
          fontSize: 14,
          lineHeight: "20px",
          color: IK,
          boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
        }}
        value={qiymat}
        onChange={(e) => ozgardi(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2"
        style={{ color: OCH_KUL }}
      />
    </div>
  );
}

/** Figma 3.9a: oyna ichidagi qizil xato bloki (505×37, radius 10). */
function OynaXato({ matn }: { matn: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[10px] px-3 py-[10px]"
      style={{ background: XAVF_FON }}
    >
      <CircleAlert
        size={15}
        aria-hidden
        className="mt-[1px] shrink-0"
        style={{ color: QIZIL }}
      />
      <p className="text-[12px] font-medium leading-[17px]" style={{ color: QIZIL }}>
        {matn}
      </p>
    </div>
  );
}

/**
 * Oyna oyoqchasidagi tugma — Figma 3.9a: 40 px, radius 10, pad 10/16,
 * 13 Semi Bold. O'chiq asosiy tugma kulrang (#eef1fb / #9aa0b0).
 */
function OynaTugma({
  kor,
  onClick,
  ochiq,
  children,
}: {
  kor: "ikkilamchi" | "asosiy" | "xavf";
  onClick: () => void;
  ochiq?: boolean;
  children: React.ReactNode;
}) {
  const asos = `inline-flex h-10 shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[10px] px-4 text-[13px] font-semibold leading-[19px] transition-[filter,background-color] ${FOKUS}`;
  if (kor === "ikkilamchi") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={ochiq}
        className={`${asos} bg-white ${ochiq ? "cursor-not-allowed" : "hover:bg-[#f4f6fc]"}`}
        style={{
          color: ochiq ? XIRA_QUYUQ : KUL,
          boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
        }}
      >
        {children}
      </button>
    );
  }
  const rang = kor === "asosiy" ? KO_K : QIZIL;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ochiq}
      className={`${asos} ${ochiq ? "cursor-not-allowed" : "hover:brightness-95"}`}
      style={{
        background: ochiq ? AVATAR_FON : rang,
        color: ochiq ? XIRA_QUYUQ : "#ffffff",
      }}
    >
      {children}
    </button>
  );
}
