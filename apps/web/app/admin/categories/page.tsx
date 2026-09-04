"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CircleAlert,
  Image as RasmIkonka,
  Info,
  LayoutGrid,
  Lock,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import {
  APIError,
  Category,
  adminBase,
  api,
  getAdminRole,
  getAdminToken,
} from "@/lib/api";
import { CategoryIcon } from "@/components/CategoryIcon";
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
   Figma: "3.7 · Turkumlar — ro'yxat (1440×1024)" va
          "3.7a · Turkumlar — oynalar, holatlar va qoidalar".

   O'lchamlar Figma'dan aynan olingan: sarlavha kartasi 83, jadval
   sarlavhasi 46, qator 64, jadval oyoqchasi 52 px. Ustunlar:
   Nomi 277 · Slug 173 · Faol e'lon 115 · Jami 115 · Tur 127 ·
   Holat 150 · Amallar 195 (jami 1152).

   # KIM NIMA QILA OLADI

   Figma 3.7a sarlavhasidagi qoida: «Ko'rish — barcha adminlarga.
   Qo'shish, tahrirlash, holatni almashtirish va o'chirish — faqat
   superadminga.» Panelda shu ikki daraja bor:

   1. Ko'rinish: superadmin bo'lmagan adminda «+ Yangi turkum», holat
      nishonining almashtirish ikonkasi va amal tugmalari CHIZILMAYDI —
      jadval ostida esa izoh chiqadi.
   2. Amal: har bir yozuv funksiyasi `isSuper` ni QAYTA tekshiradi.
      Ko'rinishni yashirish himoya emas — DOM'ni ochib tugma qo'shish
      mumkin. Haqiqiy chegara backendda (`httpx.RequireRole()`), bu
      yerdagi tekshiruv esa bekorga ketadigan 403 so'rovlarini
      to'xtatadi.

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow ishlatilgan.
   ───────────────────────────────────────────────────────────────────── */

/* Sahifaga xos ranglar.
 *
 * # NEGA SHU YERDA, ui.ts DA EMAS
 *
 * Bu beshta rang faqat turkum holatlarini bildiradi (`ArizaHolat.tsx`
 * dagi kabi). `ui.ts` — butun panel bo'ylab ishlatiladigan palitra;
 * unga holatga bog'liq ranglarni qo'shsak, keyingi ekranda kimdir
 * ma'nosini bilmay «yashil fon» deb olib ishlatardi. */
const IKON_FON = "#dce9ff"; // faol turkum ikonkasining qutisi
const FAOL_FON = "#e6f5ed";
const FAOL_HOSHIYA = "#bfe6d2";
const TIZIM_FON = "#fdf3e4"; // «admin» turi va tizim turkumi ogohlantirishi
const XAVF_FON = "#fcebec"; // «O'chirish» tugmasi va xato bloki

/** Figma 3.7a · «6 ta skelet qator ko'rsatiladi; sarlavha va tugma joyida qoladi». */
const SKELET = 6;

/* Maydon chegaralari — server bilan AYNAN bir xil
 * (internal/admin/categories.go: catNameMax / catSlugMax / catIconMax).
 * Klientdagi `maxLength` himoya emas, qulaylik: admin 61-belgini yozib
 * bo'lib, keyin serverdan rad javob olmasin. */
const NOM_MAX = 60;
const SLUG_MAX = 60;
const IKON_MAX = 512;

/**
 * Ming ajratgichi — UZUQ BO'SHLIQ (nbsp), Figma: "1 284".
 *
 * Oddiy bo'shliq bo'lsa, 115 px'lik ustunda son ikki qatorga bo'linib
 * ketishi mumkin ("1" va "284") — nbsp buni butunlay imkonsiz qiladi.
 */
function son(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/* Backend xato kodlari → adminga ko'rsatiladigan matn.
 *
 * # NEGA KOD BO'YICHA, `message` BO'YICHA EMAS
 *
 * Backend xabarlarining bir qismi inglizcha texnik matn ("slug already
 * exists", "nothing to update") — ular jurnal uchun yozilgan, admin
 * uchun emas. Kod esa barqaror shartnoma, shuning uchun matn shu yerda
 * o'zbekcha yoziladi. Ro'yxatda yo'q kod uchun backend xabari
 * ko'rsatiladi: notanish xatoni yashirish uni tuzatishni qiyinlashtiradi. */
const XATO_MATN: Record<string, string> = {
  duplicate: "Bunday slug allaqachon mavjud. Boshqa slug tanlang.",
  bad_request: "Maydonlar to'liq emas — nomni tekshirib, qaytadan urinib ko'ring.",
  name_too_long: `Turkum nomi ${NOM_MAX} belgidan oshmasligi kerak.`,
  bad_slug:
    "Slug lotin harflari va raqamlardan tuzilishi kerak (masalan «yuk-tashish»).",
  slug_too_long: `Slug ${SLUG_MAX} belgidan oshmasligi kerak.`,
  icon_required: "Kategoriya ikonkasi majburiy.",
  icon_too_long: `Ikonka havolasi ${IKON_MAX} belgidan oshmasligi kerak.`,
  bad_icon_url: "Ikonka havolasi http:// yoki https:// bilan boshlanishi kerak.",
  bad_id: "Turkum manzili noto'g'ri. Ro'yxatni yangilab, qaytadan urinib ko'ring.",
  not_found:
    "Turkum topilmadi — u allaqachon o'chirilgan bo'lishi mumkin. Ro'yxatni yangilang.",
  protected:
    "Bu tizim turkumi: uni o'chirib ham, slug'ini o'zgartirib ham bo'lmaydi. Faqat nofaol qilish mumkin.",
  in_use: "Turkum e'lonlarda ishlatilgan — o'chirib bo'lmaydi. Uni nofaol qiling.",
  forbidden: "Bu amal uchun ruxsat yo'q — turkumlarni faqat superadmin o'zgartiradi.",
  rate_limited:
    "Juda ko'p so'rov yuborildi. Bir necha soniyadan so'ng qaytadan urinib ko'ring.",
  no_file: "Ikonka fayli tanlanmadi.",
  too_large: "Ikonka hajmi 2 MB dan oshmasligi kerak.",
  bad_type: "Faqat PNG, JPG yoki WebP ikonka qabul qilinadi.",
  invalid_image: "Ikonka fayli buzilgan yoki o'lchami juda katta.",
  storage_disabled: "Fayl yuklash sozlanmagan — ikonka havolasini qo'lda kiriting.",
  upload_failed: "Ikonkani yuklab bo'lmadi. Qaytadan urinib ko'ring.",
};

function xatoMatni(e: unknown): string {
  const x = e as APIError | null;
  const kod = typeof x?.code === "string" ? x.code : "";
  return XATO_MATN[kod] || x?.message || "Amalni bajarib bo'lmadi.";
}

/**
 * Ikonka havolasi — faqat http(s).
 *
 * Bu qiymat `<img src>` ga tushadi, ya'ni `javascript:` yoki `data:`
 * havolasi panelda bajariladigan kontentga aylanardi. Yakuniy qorovul
 * serverda (`httpx.IsSafeHTTPURL`), bu tekshiruv esa xatoni so'rov
 * ketishidan oldin, aynan Figma 3.7a dagi qizil blokda ko'rsatadi.
 */
const xavfsizIkonka = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());

/** Serverdagi `slugify` ning aynan o'zi (internal/admin/handler.go). */
const slugla = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

type Draft = {
  id?: string;
  name: string;
  slug: string;
  icon: string;
  isActive: boolean;
  /** Tahrir oynasi uchun: tizim turkumining slug'i qulflangan. */
  tizim: boolean;
  /** Ochilgandagi slug — o'zgarganini bilish uchun. */
  asliSlug: string;
};

const BOSH: Draft = {
  name: "",
  slug: "",
  icon: "",
  isActive: true,
  tizim: false,
  asliSlug: "",
};

const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

export default function AdminCategories() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [xato, setXato] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  const [edit, setEdit] = useState<Draft | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  /** Oyna ichidagi qizil blok (Figma 3.7a · C va D). */
  const [oynaXato, setOynaXato] = useState("");
  const [saqlanmoqda, setSaqlanmoqda] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  /** Holat nishoni bosilgan qator — takroriy bosishni to'xtatadi. */
  const [bandId, setBandId] = useState("");
  /** Nishonni almashtirish xatosi: oyna ochilmagani uchun yo'lakda chiqadi. */
  const [yolakXato, setYolakXato] = useState("");

  // Har so'rovga tartib raqami beriladi: sekin qaytgan ESKI javob yangi
  // ro'yxatni bosib ketmasin (ikki marta «Qayta urinish» bosilganda).
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    const men = ++soravRaqami.current;
    setYuklanmoqda(true);
    setXato("");
    try {
      const javob = await api.get<Category[]>("/api/admin/categories", {
        auth: "admin",
      } as any);
      if (men !== soravRaqami.current) return;
      // Javob shakli tekshiriladi: buzilgan yoki proksi qaytargan javob
      // `.map` da butun sahifani yiqitmasin.
      setCats(Array.isArray(javob) ? javob : []);
    } catch (e) {
      if (men !== soravRaqami.current) return;
      setCats(null);
      setXato(xatoMatni(e));
    } finally {
      if (men === soravRaqami.current) setYuklanmoqda(false);
    }
  }, []);

  useEffect(() => {
    load();
    setIsSuper(getAdminRole() === "superadmin");
  }, [load]);

  /* ── Amallar ────────────────────────────────────────────────────────
     Har biri `isSuper` ni qaytadan tekshiradi: tugmalarni yashirish
     himoya emas, funksiya esa hozir ham chaqirilishi mumkin. */

  async function toggle(c: Category) {
    if (!isSuper || bandId) return;
    setYolakXato("");
    setBandId(c.id);
    try {
      await api.patch(
        `/api/admin/categories/${c.id}/active`,
        { isActive: !c.isActive },
        { auth: "admin" } as any,
      );
      await load();
    } catch (e) {
      setYolakXato(xatoMatni(e));
    } finally {
      setBandId("");
    }
  }

  async function save() {
    if (!edit || !isSuper || saqlanmoqda || iconUploading) return;
    // Server tekshiruvining ko'zgusi — xato so'rovsiz ko'rsatiladi.
    const nom = edit.name.trim();
    if (!nom) {
      setOynaXato("Turkum nomini kiriting.");
      return;
    }
    if ([...nom].length > NOM_MAX) {
      setOynaXato(XATO_MATN.name_too_long);
      return;
    }
    const ikonka = edit.icon.trim();
    if (!ikonka) {
      setOynaXato(XATO_MATN.icon_required);
      return;
    }
    if (!xavfsizIkonka(ikonka)) {
      setOynaXato(XATO_MATN.bad_icon_url);
      return;
    }
    if (edit.tizim && slugla(edit.slug) && slugla(edit.slug) !== edit.asliSlug) {
      setOynaXato("Tizim turkumining slug'ini o'zgartirib bo'lmaydi.");
      return;
    }
    setOynaXato("");
    setSaqlanmoqda(true);
    try {
      const tana = {
        name: nom,
        slug: edit.slug.trim(),
        icon: ikonka,
        isActive: edit.isActive,
      };
      if (edit.id) {
        await api.put(`/api/admin/categories/${edit.id}`, tana, {
          auth: "admin",
        } as any);
      } else {
        await api.post("/api/admin/categories", tana, { auth: "admin" } as any);
      }
      setEdit(null);
      await load();
    } catch (e) {
      // Figma 3.7a · «Server xatosi oyna ichida qizil matn bilan
      // ko'rsatiladi, oyna yopilmaydi» — kiritilgan ma'lumot yo'qolmasin.
      setOynaXato(xatoMatni(e));
    } finally {
      setSaqlanmoqda(false);
    }
  }

  async function uploadIcon(file: File) {
    if (!isSuper || iconUploading) return;
    // Serverdagi chegara — 2 MB. Uni bu yerda ham tekshiramiz: 20 MB'lik
    // rasmni yuborib, keyin 413 olishning ma'nosi yo'q.
    if (file.size > 2 * 1024 * 1024) {
      setOynaXato(XATO_MATN.too_large);
      return;
    }
    setOynaXato("");
    setIconUploading(true);
    try {
      const tana = new FormData();
      tana.append("file", file, file.name);
      // adminBase(), API_BASE emas: admin API endi faqat boshqaruv
      // subdomenida javob beradi — ommaviy domenda bu yo'l 404.
      // Bu chaqiruv FormData yuborgani uchun api.post'dan o'tmaydi (u
      // JSON qo'yadi), shuning uchun manzil bu yerda alohida tanlanadi.
      const res = await fetch(`${adminBase()}/api/admin/categories/icon`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() || ""}` },
        credentials: "include",
        body: tana,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw data?.error || { code: "upload_failed", message: "" };
      // Javob o'z serverimizdan keladi, lekin qiymat to'g'ridan-to'g'ri
      // `<img src>` ga tushadi — shakli tekshirilmasa buzilgan javob
      // panelga havola bo'lib kirardi.
      const url = typeof data?.url === "string" ? data.url.trim() : "";
      if (!xavfsizIkonka(url)) throw { code: "upload_failed", message: "" };
      setEdit((joriy) => (joriy ? { ...joriy, icon: url } : joriy));
    } catch (e) {
      setOynaXato(xatoMatni(e));
    } finally {
      setIconUploading(false);
    }
  }

  async function del() {
    if (!delCat || !isSuper || saqlanmoqda) return;
    setOynaXato("");
    setSaqlanmoqda(true);
    try {
      await api.delete(`/api/admin/categories/${delCat.id}`, {
        auth: "admin",
      } as any);
      setDelCat(null);
      await load();
    } catch (e) {
      setOynaXato(xatoMatni(e));
    } finally {
      setSaqlanmoqda(false);
    }
  }

  async function deactivateFromModal() {
    if (!delCat || !isSuper || saqlanmoqda) return;
    setOynaXato("");
    setSaqlanmoqda(true);
    try {
      await api.patch(
        `/api/admin/categories/${delCat.id}/active`,
        { isActive: false },
        { auth: "admin" } as any,
      );
      setDelCat(null);
      await load();
    } catch (e) {
      setOynaXato(xatoMatni(e));
    } finally {
      setSaqlanmoqda(false);
    }
  }

  function yangiOchish() {
    if (!isSuper) return;
    setOynaXato("");
    setEdit({ ...BOSH });
  }

  function tahrirOchish(c: Category) {
    if (!isSuper) return;
    setOynaXato("");
    setEdit({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon || "",
      isActive: c.isActive,
      tizim: !!c.isSystemDefault,
      asliSlug: c.slug,
    });
  }

  function ochirishOchish(c: Category) {
    if (!isSuper) return;
    setOynaXato("");
    setDelCat(c);
  }

  const qatorlar = cats ?? [];
  const faolSoni = qatorlar.filter((c) => c.isActive).length;
  // Birinchi yuklanish — skelet qatorlar. Keyingi yuklanishlarda jadval
  // joyida qoladi: amaldan keyingi yangilanish ekranni sakratmasin.
  const birinchiYuklanish = yuklanmoqda && !cats && !xato;

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
            Turkumlar
          </h1>
          {/* Ikkinchi qator HAR DOIM chiziladi. Yashirilsa, sarlavha
              yuklanish paytida bir piksel sakrab, keyin qayta paydo
              bo'lardi — soni yo'q bo'lsa ham buni ochiq aytamiz. */}
          <p className="mt-[2px] text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            {cats
              ? `Jami ${son(qatorlar.length)} ta turkum · ${son(faolSoni)} ta faol`
              : yuklanmoqda
                ? "Yuklanmoqda…"
                : "Jami soni aniqlanmadi"}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-[14px]">
          {/* «Faqat superadmin» nishoni HAMMAGA ko'rinadi: superadmin
              bo'lmagan admin uchun bu tugmalar nega yo'qligining
              javobi. */}
          <span
            className="inline-flex h-[25px] shrink-0 items-center gap-[6px] rounded-lg px-[10px]"
            style={{ background: AVATAR_FON }}
          >
            <Lock size={13} aria-hidden style={{ color: OCH_KUL }} />
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
              Yangi turkum
            </button>
          )}
        </div>
      </div>

      {/* Nishonni almashtirish oyna ochmaydi, shuning uchun uning xatosi
          ham yo'lakda ko'rsatiladi: jimgina yutilsa, admin turkumni
          o'chirilgan deb o'ylab ketardi. */}
      {yolakXato && (
        <div
          role="alert"
          className="flex items-center gap-[10px] rounded-xl px-4 py-3"
          style={{ background: XAVF_FON }}
        >
          <CircleAlert size={16} aria-hidden className="shrink-0" style={{ color: QIZIL }} />
          <p className="text-[13px] leading-[18px]" style={{ color: QIZIL }}>
            {yolakXato}
          </p>
        </div>
      )}

      {/* ── Jadval kartasi (Figma: 1168, radius 16) ──────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white" style={karta}>
        <div className="overflow-x-auto">
          <div className="min-w-[1040px]">
            {/* Jadval sarlavhasi — Figma: 46 px, fon #eef1fb, 12 Semi Bold. */}
            <div className="flex h-[46px] items-center" style={{ background: AVATAR_FON }}>
              <div
                className="shrink-0 truncate pl-5 pr-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(277), color: KUL }}
              >
                Nomi
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(173), color: KUL }}
              >
                Slug
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(115), color: KUL }}
                title="Hozir feedda ko'rinib turgan e'lonlar"
              >
                Faol e&apos;lon
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(115), color: KUL }}
                title="Turkumda tarixan joylangan barcha e'lonlar"
              >
                Jami
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(127), color: KUL }}
              >
                Tur
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(150), color: KUL }}
              >
                Holat
              </div>
              <div
                className="shrink-0 truncate px-3 text-[12px] font-semibold leading-[17px]"
                style={{ ...ustun(195), color: KUL }}
              >
                Amallar
              </div>
            </div>

            {xato && !qatorlar.length ? (
              /* Xato holati — Figma 3.7a · «Saqlab bo'lmadi». Bo'sh jadval
                 CHIZILMAYDI: admin uni "turkum yo'q" deb o'qib, noto'g'ri
                 xulosaga kelardi. */
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-[10px] px-5 py-[64px] text-center"
              >
                <TriangleAlert size={34} aria-hidden style={{ color: QIZIL }} />
                <p className="text-[15px] font-semibold leading-[22px]" style={{ color: QIZIL }}>
                  Ro&apos;yxatni yuklab bo&apos;lmadi
                </p>
                {/* Xatoning o'zi ham ko'rsatiladi: "server javob bermadi"
                    bilan "sessiya tugadi" butunlay boshqa harakat talab
                    qiladi. */}
                <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                  {xato}
                </p>
                <button
                  type="button"
                  onClick={load}
                  className={`mt-1 inline-flex h-10 select-none items-center rounded-[10px] px-4 text-[13px] font-semibold leading-[19px] text-white transition-[filter] hover:brightness-95 ${FOKUS}`}
                  style={{ background: KO_K }}
                >
                  Qayta urinish
                </button>
              </div>
            ) : birinchiYuklanish ? (
              /* Yuklanmoqda — Figma 3.7a: 6 ta skelet qator. Balandlik ham
                 64 px: javob kelganda jadval sakrab ketmaydi. */
              <div role="status" aria-live="polite">
                <span className="sr-only">Turkumlar yuklanmoqda…</span>
                {Array.from({ length: SKELET }, (_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className={`flex h-16 items-center ${i % 2 === 1 ? "bg-[#f8f9ff]" : "bg-white"}`}
                    style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
                  >
                    <div
                      className="flex shrink-0 items-center gap-3 pl-5 pr-3"
                      style={ustun(277)}
                    >
                      <div
                        className="h-9 w-9 shrink-0 animate-pulse rounded-[10px]"
                        style={{ background: HOSHIYA }}
                      />
                      <div
                        className="h-[14px] w-[60%] animate-pulse rounded"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(173)}>
                      <div
                        className="h-[25px] w-[70%] animate-pulse rounded-md"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(115)}>
                      <div
                        className="h-[14px] w-[55%] animate-pulse rounded"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(115)}>
                      <div
                        className="h-[13px] w-[55%] animate-pulse rounded"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(127)}>
                      <div
                        className="h-[25px] w-[46px] animate-pulse rounded-[7px]"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="shrink-0 px-3" style={ustun(150)}>
                      <div
                        className="h-[27px] w-[76px] animate-pulse rounded-[14px]"
                        style={{ background: HOSHIYA }}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2 px-3" style={ustun(195)}>
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
              /* Bo'sh holat — Figma 3.7a · «Turkumlar yo'q». Tugma faqat
                 superadminda: boshqa admin uni bosib 403 olardi. */
              <div className="flex flex-col items-center gap-[10px] px-5 py-[64px] text-center">
                <LayoutGrid size={34} aria-hidden style={{ color: XIRA_QUYUQ }} />
                <p className="text-[15px] font-semibold leading-[22px]" style={{ color: IK }}>
                  Turkumlar yo&apos;q
                </p>
                <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                  {isSuper
                    ? "Hali birorta turkum qo'shilmagan. Birinchisini qo'shing."
                    : "Hali birorta turkum qo'shilmagan."}
                </p>
                {isSuper && (
                  <button
                    type="button"
                    onClick={yangiOchish}
                    className={`mt-1 inline-flex h-10 select-none items-center rounded-[10px] px-4 text-[13px] font-semibold leading-[19px] text-white transition-[filter] hover:brightness-95 ${FOKUS}`}
                    style={{ background: KO_K }}
                  >
                    + Yangi turkum
                  </button>
                )}
              </div>
            ) : (
              qatorlar.map((c, i) => (
                <TurkumQatori
                  key={c.id}
                  c={c}
                  juft={i % 2 === 1}
                  ustun={ustun}
                  isSuper={isSuper}
                  band={bandId === c.id}
                  qulf={!!bandId}
                  onToggle={() => toggle(c)}
                  onEdit={() => tahrirOchish(c)}
                  onDelete={() => ochirishOchish(c)}
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
              Bu ekranda sahifalash yo&apos;q — barcha turkumlar bitta ro&apos;yxatda
              ko&apos;rsatiladi.
            </p>
          </div>
        )}
      </div>

      {/* Figma 3.7 · «Izoh · superadmin»: jadval ostidagi izoh — faqat
          superadmin bo'lmagan adminda. */}
      {!isSuper && (
        <div
          className="flex items-center gap-[10px] rounded-xl px-4 py-3"
          style={{ background: TIZIM_FON }}
        >
          <Lock size={16} aria-hidden className="shrink-0" style={{ color: ORANJ }} />
          <p className="text-[13px] leading-[18px]" style={{ color: ORANJ_MATN }}>
            Turkumlarni faqat superadmin tahrirlashi mumkin.
          </p>
        </div>
      )}

      {/* ── C. Qo'shish / tahrirlash oynasi (Figma 3.7a · C) ─────────── */}
      <AdminOynaQobiq
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Turkumni tahrirlash" : "Yangi turkum"}
        maxWidth="max-w-[545px]"
        radius="rounded-[18px]"
      >
        {edit && (
          <>
            <div
              className="flex items-center gap-[10px] py-[18px] pl-5 pr-[18px]"
              style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
            >
              <div className="min-w-0 flex-1">
                <h2
                  className="text-[17px] font-semibold leading-[25px]"
                  style={{ color: IK }}
                >
                  {edit.id ? "Turkumni tahrirlash" : "Yangi turkum"}
                </h2>
                <p
                  className="mt-[2px] truncate text-[12px] leading-[17px]"
                  style={{ color: OCH_KUL }}
                >
                  {edit.id
                    ? `${edit.name || "Turkum"} · ${edit.tizim ? "tizim turkumi" : "admin turkumi"}`
                    : "Yangi turkum qo'shish"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEdit(null)}
                aria-label="Yopish"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-[filter] hover:brightness-95 ${FOKUS}`}
                style={{ background: AVATAR_FON, color: OCH_KUL }}
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-5 py-[18px]">
              <Maydon nomi="Nomi" majburiy>
                <Kirit
                  nomi="Turkum nomi"
                  qiymat={edit.name}
                  ozgardi={(v) => setEdit({ ...edit, name: v })}
                  placeholder="Masalan: Quruvchi"
                  maxLength={NOM_MAX}
                  ozi
                />
              </Maydon>

              <Maydon nomi="Slug (ixtiyoriy — nomdan avtomatik)">
                <Kirit
                  nomi="Slug"
                  qiymat={edit.slug}
                  ozgardi={(v) => setEdit({ ...edit, slug: v })}
                  placeholder={slugla(edit.name) || "quruvchi"}
                  maxLength={SLUG_MAX}
                />
              </Maydon>

              <Maydon
                nomi="Kategoriya ikonkasi"
                majburiy
                izoh="Internetdagi SVG/PNG/WebP/JPG manzilini kiriting yoki kompyuterdan rasm yuklang."
              >
                <div
                  className="flex items-center gap-[14px] rounded-xl p-[14px]"
                  style={{ background: "#f8f9ff", boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
                >
                  {/* Oldindan ko'rish 64×64. Bo'sh bo'lsa uzuq chizmali quti
                      (Figma: dash 4/4) — shuning uchun bu yerda `border`,
                      `box-shadow` uzuq chiziq qila olmaydi. */}
                  <div
                    className={`grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[14px] ${
                      edit.icon.trim() ? "" : "border border-dashed"
                    }`}
                    style={{
                      background: edit.icon.trim() ? IKON_FON : AVATAR_FON,
                      borderColor: HOSHIYA_QUYUQ,
                    }}
                  >
                    {edit.icon.trim() ? (
                      <CategoryIcon
                        icon={edit.icon}
                        name={edit.name || "Turkum"}
                        className="h-8 w-8"
                      />
                    ) : (
                      <RasmIkonka size={26} aria-hidden style={{ color: XIRA_QUYUQ }} />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
                    <Kirit
                      nomi="Ikonka havolasi"
                      tur="url"
                      qiymat={edit.icon}
                      ozgardi={(v) => setEdit({ ...edit, icon: v })}
                      placeholder="https://.../icon.svg"
                      maxLength={IKON_MAX}
                      balandlik={42}
                      matn={13}
                      qator={19}
                      chekin={12}
                    />
                    {/* Fayl maydoni `hidden` EMAS, shaffof: yashirilgan
                        maydonni Tab bilan topib bo'lmasdi va klaviatura
                        bilan ishlagan admin ikonkani yuklay olmasdi. */}
                    <label
                      className={`relative inline-flex h-[39px] w-fit select-none items-center gap-[7px] rounded-[10px] px-[14px] ${
                        iconUploading ? "cursor-wait" : "cursor-pointer hover:brightness-95"
                      }`}
                      style={{
                        background: iconUploading ? AVATAR_FON : "#ffffff",
                        boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                      }}
                    >
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait"
                        disabled={iconUploading}
                        onChange={(e) => {
                          const fayl = e.target.files?.[0];
                          if (fayl) uploadIcon(fayl);
                          // Bir xil faylni qayta tanlash ham `change`
                          // hodisasini bersin.
                          e.target.value = "";
                        }}
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[10px] peer-focus-visible:shadow-[inset_0_0_0_2px_#004ac6]"
                      />
                      <Upload
                        size={15}
                        aria-hidden
                        className="shrink-0"
                        style={{ color: iconUploading ? XIRA_QUYUQ : KUL }}
                      />
                      <span
                        className="whitespace-nowrap text-[13px] font-semibold leading-[19px]"
                        style={{ color: iconUploading ? XIRA_QUYUQ : KUL }}
                      >
                        {iconUploading ? "Yuklanmoqda…" : "PNG/JPG/WebP yuklash"}
                      </span>
                    </label>
                  </div>
                </div>
              </Maydon>

              <Belgilash
                nomi="Faol"
                toliq
                balandlik={44}
                radius={10}
                chap={14}
                oraliq={10}
                belgilangan={edit.isActive}
                ozgardi={(v) => setEdit({ ...edit, isActive: v })}
              />

              {oynaXato && <OynaXato matn={oynaXato} />}

              <div className="flex h-10 items-center justify-end gap-[10px]">
                <OynaTugma kor="ikkilamchi" onClick={() => setEdit(null)}>
                  Bekor
                </OynaTugma>
                <OynaTugma
                  kor="asosiy"
                  onClick={save}
                  ochiq={
                    !edit.name.trim() || !edit.icon.trim() || iconUploading || saqlanmoqda
                  }
                >
                  {saqlanmoqda ? "Saqlanmoqda…" : "Saqlash"}
                </OynaTugma>
              </div>
            </div>
          </>
        )}
      </AdminOynaQobiq>

      {/* ── D. O'chirish oynasi — ikki xil (Figma 3.7a · D) ──────────── */}
      <AdminOynaQobiq
        open={!!delCat}
        onClose={() => {
          setDelCat(null);
          setOynaXato("");
        }}
        title={
          delCat?.isSystemDefault
            ? `${delCat?.name} — tizim turkumi`
            : `${delCat?.name} o'chiriladi`
        }
        maxWidth="max-w-[545px]"
        radius="rounded-[18px]"
      >
        {delCat && (
          /* Bu oynada yopish nishoni ATAYLAB yo'q (Figma 3.7a · D):
             o'chirish so'rovi ikkita ochiq javobga ega bo'lishi kerak —
             tasodifiy bosilgan «×» «yo'q» degani emas. Escape va
             qoplamaga bosish esa `AdminOynaQobiq` da ishlaydi. */
          <div className="flex flex-col gap-[14px] p-5">
            <div className="flex items-start gap-3">
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                style={{ background: delCat.isSystemDefault ? TIZIM_FON : XAVF_FON }}
              >
                {delCat.isSystemDefault ? (
                  <ShieldAlert size={22} aria-hidden style={{ color: ORANJ }} />
                ) : (
                  <Trash2 size={22} aria-hidden style={{ color: QIZIL }} />
                )}
              </div>
              <div className="min-w-0">
                <h2
                  className="text-[17px] font-semibold leading-[25px]"
                  style={{ color: IK }}
                >
                  {delCat.isSystemDefault
                    ? `«${delCat.name}» — tizim turkumi`
                    : `«${delCat.name}» o'chiriladi`}
                </h2>
                <p className="mt-[3px] text-[13px] leading-[19px]" style={{ color: KUL }}>
                  {delCat.isSystemDefault
                    ? "Tizim turkumi butunlay o'chirilmaydi. Uni faqat nofaol qilish mumkin."
                    : "Bu turkum butunlay o'chadi. Amalni ortga qaytarib bo'lmaydi."}
                </p>
              </div>
            </div>

            <div
              className="flex items-start gap-2 rounded-[10px] px-3 py-[10px]"
              style={{ background: AVATAR_FON }}
            >
              <Info
                size={15}
                aria-hidden
                className="mt-[1px] shrink-0"
                style={{ color: OCH_KUL }}
              />
              <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                {delCat.isSystemDefault
                  ? "«Nofaol qilish» tugmasi faqat turkum hozir faol bo'lganda ko'rinadi. Nofaol turkum e'lonlar feedidan yashiriladi."
                  : "Agar turkum e'lonlarda ishlatilgan bo'lsa, o'chirish rad etiladi — server xato qaytaradi."}
              </p>
            </div>

            {oynaXato && <OynaXato matn={oynaXato} />}

            <div className="flex h-10 items-center justify-end gap-[10px]">
              <OynaTugma
                kor="ikkilamchi"
                onClick={() => {
                  setDelCat(null);
                  setOynaXato("");
                }}
              >
                {delCat.isSystemDefault ? "Yopish" : "Yo'q"}
              </OynaTugma>
              {delCat.isSystemDefault ? (
                // Faqat hozir faol turkumda — nofaol turkumni yana nofaol
                // qilishning ma'nosi yo'q (Figma 3.7a · D izohi).
                delCat.isActive && (
                  <OynaTugma kor="xavf" onClick={deactivateFromModal} ochiq={saqlanmoqda}>
                    {saqlanmoqda ? "Bajarilmoqda…" : "Nofaol qilish"}
                  </OynaTugma>
                )
              ) : (
                <OynaTugma kor="xavf" onClick={del} ochiq={saqlanmoqda}>
                  {saqlanmoqda ? "O'chirilmoqda…" : "Ha, o'chirish"}
                </OynaTugma>
              )}
            </div>
          </div>
        )}
      </AdminOynaQobiq>
    </div>
  );
}

/* ── Jadval qatori ──────────────────────────────────────────────────── */

/**
 * Turkum qatori — Figma 3.7: 64 px, toq qator oq, juft qator #f8f9ff,
 * ostida 1 px hoshiya.
 */
function TurkumQatori({
  c,
  juft,
  ustun,
  isSuper,
  band,
  qulf,
  onToggle,
  onEdit,
  onDelete,
}: {
  c: Category;
  juft: boolean;
  ustun: (px: number) => { width: string };
  isSuper: boolean;
  /** Aynan shu qatorning holati almashtirilmoqda. */
  band: boolean;
  /** Boshqa qatorda so'rov ketmoqda — takroriy bosishni to'xtatamiz. */
  qulf: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const faol = c.isActive;
  const faolSoni = Number.isFinite(c.activeCount) ? c.activeCount : 0;
  const jami = Number.isFinite(c.usageCount) ? c.usageCount : 0;
  // Figma 3.7: nofaol turkumning va nol qiymatning soni xira yoziladi —
  // «0» ni quyuq siyohda ko'rsatish uni bor narsa deb o'qitardi.
  const soniXira = !faol || faolSoni === 0;

  return (
    <div
      className={`flex h-16 items-center ${juft ? "bg-[#f8f9ff]" : "bg-white"}`}
      style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
    >
      {/* Nomi — 36×36 ikonka qutisi + nom */}
      <div className="flex min-w-0 shrink-0 items-center gap-3 pl-5 pr-3" style={ustun(277)}>
        <div
          className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px]"
          style={{
            background: faol ? IKON_FON : AVATAR_FON,
            boxShadow: faol ? undefined : `inset 0 0 0 1px ${HOSHIYA}`,
          }}
        >
          {/* Rang `CategoryIcon` ning zaxira ikonkasiga (Briefcase)
              tegishli; haqiqiy ikonka rasm bo'lgani uchun nofaol turkumda
              u shaffoflik bilan xiralashadi. */}
          <span
            className="grid h-5 w-5 place-items-center"
            style={{ color: faol ? KO_K : XIRA_QUYUQ, opacity: faol ? 1 : 0.6 }}
          >
            <CategoryIcon icon={c.icon} name={c.name} className="h-5 w-5" />
          </span>
        </div>
        <span
          className="truncate text-[14px] font-medium leading-5"
          style={{ color: faol ? IK : OCH_KUL }}
          title={c.name}
        >
          {c.name}
        </span>
      </div>

      {/* Slug — kod nishoni */}
      <div className="flex min-w-0 shrink-0 px-3" style={ustun(173)}>
        <span
          className="inline-flex h-[25px] max-w-full items-center rounded-md px-2"
          style={{ background: AVATAR_FON }}
        >
          <span
            className="truncate text-[12px] leading-[17px]"
            style={{ color: KUL }}
            title={c.slug}
          >
            {c.slug}
          </span>
        </span>
      </div>

      {/* Faol e'lon */}
      <div
        className="shrink-0 truncate px-3 text-[14px] font-semibold leading-5"
        style={{ ...ustun(115), color: soniXira ? XIRA_QUYUQ : IK }}
      >
        {son(faolSoni)}
      </div>

      {/* Jami */}
      <div
        className="shrink-0 truncate px-3 text-[13px] leading-[18px]"
        style={{ ...ustun(115), color: OCH_KUL }}
      >
        {son(jami)}
      </div>

      {/* Tur */}
      <div className="flex shrink-0 px-3" style={ustun(127)}>
        <span
          className="inline-flex h-[25px] shrink-0 items-center rounded-[7px] px-[9px] text-[12px] font-medium leading-[17px]"
          style={
            c.isSystemDefault
              ? { background: AVATAR_FON, color: KUL }
              : { background: TIZIM_FON, color: ORANJ }
          }
        >
          {c.isSystemDefault ? "tizim" : "admin"}
        </span>
      </div>

      {/* Holat — superadminda bosiladigan almashtirgich */}
      <div className="flex shrink-0 px-3" style={ustun(150)}>
        <Nishon
          faol={faol}
          bosiladi={isSuper}
          band={band}
          ochiq={qulf && !band}
          onClick={onToggle}
        />
      </div>

      {/* Amallar — faqat superadminda */}
      <div className="flex shrink-0 items-center gap-2 px-3" style={ustun(195)}>
        {isSuper && (
          <>
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
              className={`inline-flex h-[31px] shrink-0 select-none items-center gap-[5px] rounded-lg bg-[#fcebec] px-[10px] text-[12px] font-semibold leading-[17px] transition-colors hover:bg-[#f9dcde] ${FOKUS}`}
              style={{ color: QIZIL }}
            >
              <Trash2 size={13} aria-hidden />
              O&apos;chirish
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Holat nishoni — Figma 3.7 va 3.7a · «Holat nishoni — bosiladigan
 * almashtirgich».
 *
 * # NEGA FON `style` DA EMAS, SINFDA
 *
 * Hover rangi Figma'da aniq berilgan (#e6f5ed → #d6f0e2) va u fonning
 * "xiralashgani" emas, boshqa rang. Inline `style` esa Tailwind'ning
 * `hover:` sinfini bosib ketardi, shuning uchun ikkala rang ham sinf
 * bo'lib yoziladi.
 *
 * # NEGA SUPERADMIN BO'LMASA `<span>`
 *
 * Figma 3.7a · «Superadmin emas»: almashtirish ikonkasi yo'q, nishon
 * bosilmaydi. `<button disabled>` emas: o'chirilgan tugma klaviatura
 * bilan yuriladigan yo'lda "bor, lekin ishlamaydi" bo'lib qolardi —
 * bu adminda umuman yo'q amal.
 */
function Nishon({
  faol,
  bosiladi,
  band,
  ochiq,
  onClick,
}: {
  faol: boolean;
  bosiladi: boolean;
  band: boolean;
  ochiq: boolean;
  onClick: () => void;
}) {
  const asos =
    "inline-flex h-[27px] shrink-0 items-center gap-[6px] rounded-[14px] px-[10px]";
  const hoshiya = `inset 0 0 0 1px ${faol ? FAOL_HOSHIYA : HOSHIYA}`;
  const matn = faol ? YASHIL : OCH_KUL;
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
        style={{ color: matn }}
      >
        {faol ? "Faol" : "O'chirilgan"}
      </span>
      {bosiladi && (
        <ArrowLeftRight size={12} aria-hidden className="shrink-0" style={{ color: nuqta }} />
      )}
    </>
  );

  if (!bosiladi) {
    return (
      <span className={`${asos} ${faol ? "bg-[#e6f5ed]" : "bg-[#eef1fb]"}`} style={{ boxShadow: hoshiya }}>
        {ich}
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
      aria-label={faol ? "Turkumni nofaol qilish" : "Turkumni faol qilish"}
      title={faol ? "Nofaol qilish" : "Faol qilish"}
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

/** Figma 3.7a · C: maydon = yorliq (12 Semi Bold) + ixtiyoriy izoh + tana. */
function Maydon({
  nomi,
  majburiy,
  izoh,
  children,
}: {
  nomi: string;
  majburiy?: boolean;
  izoh?: string;
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
      {izoh && (
        <p className="text-[11px] leading-4" style={{ color: OCH_KUL }}>
          {izoh}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * Oyna maydoni — Figma 3.7a: 44 px (nom, slug) va 42 px (ikonka havolasi).
 *
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
  balandlik = 44,
  matn = 14,
  qator = 20,
  chekin = 14,
  ozi,
}: {
  nomi: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  placeholder: string;
  maxLength: number;
  tur?: "text" | "url";
  balandlik?: number;
  matn?: number;
  qator?: number;
  chekin?: number;
  /** Oyna ochilganda kursor shu maydonda bo'ladi. */
  ozi?: boolean;
}) {
  return (
    <input
      aria-label={nomi}
      type={tur}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={ozi}
      className={`w-full rounded-[10px] bg-white font-medium outline-none placeholder:font-normal placeholder:text-[#9aa0b0] ${FOKUS}`}
      style={{
        height: balandlik,
        paddingLeft: chekin,
        paddingRight: chekin,
        fontSize: matn,
        lineHeight: `${qator}px`,
        color: IK,
        boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
      }}
      value={qiymat}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => ozgardi(e.target.value)}
    />
  );
}

/** Figma 3.7a · C: oyna ichidagi qizil xato bloki (505×37, radius 10). */
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
 * Oyna oyoqchasidagi tugma — Figma 3.7a: 40 px, radius 10, pad 10/16,
 * 13 Semi Bold.
 *
 * `ui.ts` dagi `tugma()` EMAS: u 36 px va o'chiq asosiy tugmasi xira
 * ko'k (#a1b6e8), 3.7a esa 40 px va o'chiq «Saqlash» ni kulrang
 * (#eef1fb / #9aa0b0) qilib chizadi.
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
