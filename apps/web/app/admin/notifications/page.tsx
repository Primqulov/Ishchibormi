"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CalendarClock,
  CalendarX,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  Loader2,
  Lock,
  Megaphone,
  Send,
  TriangleAlert,
} from "lucide-react";
import {
  APIError,
  Broadcast,
  BroadcastRegion,
  BroadcastRegions,
  Paged,
  api,
  getAdminRole,
} from "@/lib/api";
import { AdminOynaQobiq } from "@/components/admin/AdminModal";
import { Belgilash } from "@/components/admin/Filtr";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_OCH,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KO_K_FON,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_MATN,
  QIZIL,
  QIZIL_HOSHIYA,
  SOYA,
  XIRA_QUYUQ,
  YASHIL,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.8 · Tarqatma — ommaviy xabar (1440×1024)" va
          "3.8a · Tarqatma — tugma holatlari, natijalar va tarix".

   O'lchamlar Figma'dan aynan olingan: sarlavha kartasi 85, ustunlar
   420 + 732 (oraliq 16), forma kartasi 666, izoh kartasi 54, tarix
   kartasi 613, jadval sarlavhasi 42, qator 58, sahifalash 50 px.
   Ustunlar: Sarlavha 126 · Segment 168 · Yuborilgan 82 · Holat 128 ·
   Vaqt 141 · Amal 71 (jami 716).

   # KIM NIMA QILA OLADI

   Figma 3.8a sarlavhasi: «Butun ekran faqat superadminga ochiq».
   Paneldagi boshqa ekranlarda gate faqat tugmalarni yashiradi, bu
   yerda esa BUTUN ekran: superadmin bo'lmagan adminda forma ham,
   tarix ham chizilmaydi va tarix so'rovi umuman yuborilmaydi (u
   serverdan 403 olardi). Yuborish va bekor qilish funksiyalari
   `isSuper` ni QAYTA tekshiradi: ko'rinishni yashirish himoya emas —
   DOM'ni ochib tugma qo'shish mumkin. Haqiqiy chegara backendda
   (`httpx.RequireRole()` + `broadcastLimiter`).

   # NEGA BU EKRAN ALOHIDA EHTIYOT TALAB QILADI

   Bu — paneldagi eng qaytarib bo'lmaydigan amal: bitta bosish o'n
   minglab foydalanuvchining telefoniga bildirishnoma chiqaradi va uni
   ortga qaytarish yo'q. Shuning uchun:
     · «Yuborish» sarlavha bo'sh bo'lsa bosilmaydi va bosilgandan
       keyin darhol o'chadi (`sending`) — ikki marta bosilsa xabar
       ikki marta ketardi;
     · rejalashtirilgan vaqt o'tgan bo'lsa so'rov UMUMAN yuborilmaydi
       (server ham `bad_time` bilan rad etadi) — aks holda sanadagi
       bitta xato «hozir hammaga yubor» degan ma'noni berardi;
     · «Bekor qilish» tasdiqlash oynasidan o'tadi;
     · maydon uzunliklari server chegaralarining ko'zgusi.

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow.

   # NEGA JADVAL BANDI KARTA KENGLIGIDA

   Figma'da jadval bandi 716, karta esa 732 px: bu maketning qoldig'i —
   band chap chetdan boshlanib, o'ng chetda 16 px oq chiziq qoldiradi.
   Ustun kengliklari 716 ning FOIZI bo'lib beriladi, band esa kartani
   to'liq egallaydi: nisbatlar Figma'dagi bilan bir xil qoladi (birinchi
   ustunning 18 px chekinishi karta sarlavhasi bilan bir chizuqda),
   o'ngdagi yetim oq chiziq esa brauzerda xato bo'lib ko'rinmaydi.
   ───────────────────────────────────────────────────────────────────── */

/* Sahifaga xos ranglar.
 *
 * # NEGA SHU YERDA, ui.ts DA EMAS
 *
 * Bular tarqatma holatlarini bildiradi (`ArizaHolat.tsx` dagi kabi).
 * `ui.ts` — butun panel bo'ylab ishlatiladigan palitra; unga holatga
 * bog'liq ranglarni qo'shsak, keyingi ekranda kimdir ma'nosini bilmay
 * «yashil fon» deb olib ishlatardi.
 *
 * DIQQAT: `ui.ts` da ham `KO_K_FON` va `ORANJ_FON` bor, lekin ular
 * BOSHQA qiymatlar (#f2f6fc / #fcf3e6). Shu sababli bu yerdagilar
 * boshqa nom bilan yozilgan — bir nomni ikki qiymatga bog'lash keyin
 * import qilingan joyda jimgina noto'g'ri rang berardi. */
const IKON_FON = "#dce9ff"; // sarlavha ikonkasi + «yuborilmoqda» nishoni
const YASHIL_FON = "#e6f5ed"; // «yuborildi» nishoni + muvaffaqiyat bloki
const YASHIL_MATN = "#12784a"; // muvaffaqiyat matni (nishondagi #1fa463 emas)
const SARIQ_FON = "#fdf3e4"; // «rejalashtirilgan» nishoni + oyna ikonkasi
const XAVF_FON = "#fcebec"; // «Bekor» tugmasi + xato bloki
const KO_K_QUYUQ = "#003a9e"; // «Yuborilmoqda…» tugmasi (Figma 3.8a · B)

/* Segment ro'yxati (Figma 3.8b · B): maydon ostida ochiladigan quti.
 * Soyasi `SOYA` dan quyuqroq — u maydon ostidagi «Qabul qiluvchilar»
 * maydoni USTIGA tushadi, ya'ni chegarasi ko'rinib turishi kerak. */
const ROYXAT_SOYA = "0 10px 28px rgba(11, 28, 48, 0.14)";
/** Ko'rinadigan balandlik; ortig'i aylantiriladi (Figma 3.8b: 296 px). */
const ROYXAT_BALANDLIK = 296;

/** Figma 3.8a · «Tarixda 6 ta skelet qator; forma esa darhol ishlashga tayyor». */
const SKELET = 6;

/** Figma 3.8: «Sahifada 10 tadan». */
const LIMIT = 10;

/* Maydon chegaralari — server bilan AYNAN bir xil
 * (internal/admin/broadcast.go: bcTitleMax / bcBodyMax / bcRegionMax).
 * Klientdagi `maxLength` himoya emas, qulaylik: admin 161-belgini yozib
 * bo'lib, keyin serverdan rad javob olmasin. */
const SARLAVHA_MAX = 160;
const MATN_MAX = 4000;
const VILOYAT_MAX = 100;

/* Rejalashtirish chegaralari — serverdagi bcPastSlop / bcMaxAhead ning
 * ko'zgusi. Brauzer soati serverdan bir-ikki daqiqa farq qilishi normal
 * holat, shuning uchun yaqin o'tmish xato hisoblanmaydi. */
const ORQAGA_CHEKINISH = 5 * 60 * 1000;
const OLDINGA_CHEGARA = 365 * 24 * 60 * 60 * 1000;

/**
 * Ming ajratgichi — UZUQ BO'SHLIQ (nbsp), Figma: "48 210".
 *
 * Oddiy bo'shliq bo'lsa, 82 px'lik ustunda son ikki qatorga bo'linib
 * ketishi mumkin ("48" va "210") — nbsp buni butunlay imkonsiz qiladi.
 */
function son(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Figma 3.8: «28.08.2026 · 09:00». Sana tushunarsiz bo'lsa — «—». */
function vaqt(iso?: string): string {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* Backend xato kodlari → adminga ko'rsatiladigan matn.
 *
 * # NEGA KOD BO'YICHA, `message` BO'YICHA EMAS
 *
 * Backend xabarlari inglizcha texnik matn ("scheduledAt must be
 * RFC3339", "only scheduled broadcasts can be cancelled") — ular jurnal
 * uchun yozilgan, admin uchun emas. Kod esa barqaror shartnoma, shuning
 * uchun matn shu yerda o'zbekcha yoziladi. Ro'yxatda yo'q kod uchun
 * backend xabari ko'rsatiladi: notanish xatoni yashirish uni tuzatishni
 * qiyinlashtiradi (Figma 3.8a · C: «Backend xatosi matni ko'rsatiladi»). */
const XATO_MATN: Record<string, string> = {
  bad_request: "Sarlavha bo'sh — xabarni yuborish uchun sarlavha kerak.",
  too_long: `Maydonlar juda uzun: sarlavha ${SARLAVHA_MAX}, matn ${MATN_MAX}, viloyat ${VILOYAT_MAX} belgidan oshmasligi kerak.`,
  bad_time:
    "Rejalashtirilgan vaqt qabul qilinmadi: u o'tmishda, bir yildan uzoqda yoki tushunarsiz formatda.",
  bad_id: "Tarqatma manzili noto'g'ri. Ro'yxatni yangilab, qaytadan urinib ko'ring.",
  empty_segment:
    "Bu segmentda birorta ham qabul qiluvchi qolmagan — xabar yuborilmadi. Viloyat ro'yxati yangilandi, boshqa segmentni tanlang.",
  not_scheduled:
    "Faqat rejalashtirilgan tarqatmani bekor qilish mumkin — bu xabar allaqachon yuborilgan yoki yuborilmoqda.",
  forbidden: "Bu amal uchun ruxsat yo'q — tarqatmani faqat superadmin yuboradi.",
  rate_limited:
    "Juda ko'p tarqatma yuborildi. Bir necha daqiqadan so'ng qaytadan urinib ko'ring.",
  unauthorized: "Sessiya tugagan. Qaytadan kiring.",
};

function xatoMatni(e: unknown): string {
  const x = e as APIError | null;
  const kod = typeof x?.code === "string" ? x.code : "";
  return XATO_MATN[kod] || x?.message || "Amalni bajarib bo'lmadi.";
}

/**
 * Javob shakli tekshiruvi.
 *
 * Qiymatlar `key` ga, `title` atributiga va URL'ga tushadi — buzilgan
 * yoki proksi qaytargan javob butun sahifani yiqitmasin.
 */
const xavfsizQator = (b: unknown): b is Broadcast => {
  const x = b as Broadcast | null;
  return !!x && typeof x.id === "string" && typeof x.title === "string";
};

type Holat = "scheduled" | "sending" | "done" | "noma'lum";

/** Notanish holat jimgina «yuborildi» bo'lib ko'rinmasligi kerak. */
const holati = (v: unknown): Holat =>
  v === "scheduled" || v === "sending" || v === "done" ? v : "noma'lum";

/** Figma 3.8: holat nishonlari (qatorda h24, 3.8a · D da h27). */
const NISHON: Record<Holat, { matn: string; fon: string; rang: string }> = {
  done: { matn: "yuborildi", fon: YASHIL_FON, rang: YASHIL },
  sending: { matn: "yuborilmoqda…", fon: IKON_FON, rang: KO_K },
  scheduled: { matn: "rejalashtirilgan", fon: SARIQ_FON, rang: ORANJ },
  "noma'lum": { matn: "noma'lum", fon: AVATAR_FON, rang: OCH_KUL },
};

/**
 * Sahifalash tugmalari ro'yxati — Figma: "‹ 1 2 3 4 5 … 268 ›".
 *
 * Barcha sahifalarni chizib bo'lmaydi, shuning uchun oyna: boshi, joriy
 * atrofi va oxiri. «…» tugma emas, faqat belgi. (Egizagi 3.6 ·
 * Arizalar sahifasida — u yerda tugmalar 36 px, bu yerda 32 px.)
 */
function sahifaRaqamlari(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "…", pages];
  if (page >= pages - 3) {
    return [1, "…", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  }
  return [1, "…", page - 1, page, page + 1, "…", pages];
}

const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

type Natija = { tur: "ok" | "xato"; matn: string } | null;

export default function AdminBroadcast() {
  /* Forma holati. Viloyat va katakcha yuborishdan keyin SAQLANADI:
     bir segmentga ketma-ket bir necha xabar yuborish odatiy ish
     (Figma 3.8a · C: «xabar yangi tarqatma boshlanganda yo'qoladi»,
     segment esa emas). */
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [region, setRegion] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [schedule, setSchedule] = useState(""); // datetime-local; bo'sh = hozir
  const [natija, setNatija] = useState<Natija>(null);
  const [sending, setSending] = useState(false);

  /* Segment ro'yxati — Figma 3.8b. Bazada HAQIQATAN uchraydigan viloyat
     qiymatlari va har birining qabul qiluvchilar soni.

     Sonlar `activeOnly` bilan hisoblanadi, shuning uchun katakcha
     almashganda ro'yxat qayta so'raladi: ro'yxatda ko'ringan son bilan
     haqiqatan xabar ketadigan son bir xil bo'lishi shart, aks holda
     ro'yxat adminni chalg'itardi. */
  const [viloyatlar, setViloyatlar] = useState<BroadcastRegion[] | null>(null);
  const [viloyatJami, setViloyatJami] = useState<number | null>(null);
  const [viloyatYuk, setViloyatYuk] = useState(true);
  const [viloyatXato, setViloyatXato] = useState("");
  const viloyatSoravi = useRef(0);

  const [tarix, setTarix] = useState<Paged<Broadcast> | null>(null);
  const [page, setPage] = useState(1);
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [xato, setXato] = useState("");

  /** Bekor qilish oynasi + uning ichidagi qizil blok. */
  const [bekor, setBekor] = useState<Broadcast | null>(null);
  const [oynaXato, setOynaXato] = useState("");
  const [bekorBand, setBekorBand] = useState(false);

  /* `null` — rol hali o'qilmagan (sessionStorage faqat brauzerda bor).
     Aniqlanmagan holat «ruxsat yo'q» bilan bir xil ko'rinmaydi: aks
     holda superadmin ham bir lahza «qulflangan» izohni ko'rardi. */
  const [isSuper, setIsSuper] = useState<boolean | null>(null);

  // Har so'rovga tartib raqami beriladi: sekin qaytgan ESKI javob yangi
  // ro'yxatni bosib ketmasin (sahifa tez almashtirilganda).
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    const men = ++soravRaqami.current;
    setYuklanmoqda(true);
    setXato("");
    try {
      const javob = await api.get<Paged<Broadcast>>(
        `/api/admin/broadcasts?page=${page}&limit=${LIMIT}`,
        { auth: "admin" } as any,
      );
      if (men !== soravRaqami.current) return;
      const qatorlar = Array.isArray(javob?.items)
        ? javob.items.filter(xavfsizQator)
        : [];
      setTarix({
        items: qatorlar,
        page,
        limit: LIMIT,
        // Jami son ishonchsiz bo'lsa, hech bo'lmasa ko'rinib turgan
        // qatorlar soni aytiladi — «NaN ta tarqatma» yozilmasin.
        total: Number.isFinite(javob?.total) ? javob.total : qatorlar.length,
      });
    } catch (e) {
      if (men !== soravRaqami.current) return;
      setTarix(null);
      setXato(xatoMatni(e));
    } finally {
      if (men === soravRaqami.current) setYuklanmoqda(false);
    }
  }, [page]);

  /* ── Segment ro'yxati ───────────────────────────────────────────────
     Alohida tartib raqami: bu so'rov «Faqat faol» katakchasi almashganda
     ham yuboriladi, ya'ni tarix so'rovi bilan poyga qilishi mumkin. */
  const viloyatlarniYukla = useCallback(async () => {
    const men = ++viloyatSoravi.current;
    setViloyatYuk(true);
    setViloyatXato("");
    try {
      const javob = await api.get<BroadcastRegions>(
        `/api/admin/broadcast/regions?activeOnly=${activeOnly ? 1 : 0}`,
        { auth: "admin" } as any,
      );
      if (men !== viloyatSoravi.current) return;
      /* Shakl tekshiruvi: qiymat `key` ga, `title` ga va yuboriladigan
         segmentga tushadi. Chetida bo'shliq bor qiymat ATAYLAB
         tashlanadi — server filtri chetni kesadi, ya'ni bunday segment
         ko'rsatilgan sondan kamroq odamga ketardi (server ham shunday
         qiymatni ro'yxatga qo'ymaydi; bu ikkinchi qatlam). */
      const qatorlar = Array.isArray(javob?.items)
        ? javob.items.filter(
            (v): v is BroadcastRegion =>
              !!v &&
              typeof v.region === "string" &&
              v.region !== "" &&
              v.region.trim() === v.region &&
              [...v.region].length <= VILOYAT_MAX &&
              typeof v.count === "number",
          )
        : [];
      setViloyatlar(qatorlar);
      setViloyatJami(Number.isFinite(javob?.total) ? javob.total : null);
    } catch (e) {
      if (men !== viloyatSoravi.current) return;
      setViloyatlar(null);
      setViloyatJami(null);
      /* `rate_limited` uchun umumiy matn yaramaydi: u «juda ko'p tarqatma
         yuborildi» deydi, bu yerda esa hech narsa yuborilmagan — faqat
         ro'yxat so'ralgan. Chegara ham boshqacha (20 ta, keyin 5 s'da
         bittadan), shuning uchun kutish vaqti ham boshqacha aytiladi. */
      setViloyatXato(
        (e as APIError | null)?.code === "rate_limited"
          ? "Ro'yxat juda tez-tez so'raldi — bir necha soniyadan keyin urinib ko'ring."
          : xatoMatni(e),
      );
    } finally {
      if (men === viloyatSoravi.current) setViloyatYuk(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    setIsSuper(getAdminRole() === "superadmin");
  }, []);

  useEffect(() => {
    // Tarix so'rovi FAQAT superadminda yuboriladi: boshqa adminda u
    // 403 qaytarardi va ekranda ma'nosiz xato bloki chiqardi.
    if (isSuper) load();
  }, [isSuper, load]);

  useEffect(() => {
    // Ro'yxat ham faqat superadminda so'raladi (endpoint superadmin
    // guruhida): viloyatlar bo'yicha sanoq — foydalanuvchi bazasi
    // haqidagi ma'lumot.
    if (isSuper) viloyatlarniYukla();
  }, [isSuper, viloyatlarniYukla]);

  /** Yangi tarqatma boshlanganda oldingi natija yo'qoladi (3.8a · C). */
  const tozala = () => {
    if (natija) setNatija(null);
  };

  /* ── Yuborish ───────────────────────────────────────────────────────
     Server tekshiruvining ko'zgusi: xato so'rovsiz, aynan Figma 3.8a
     dagi qizil blokda ko'rsatiladi. */
  async function send() {
    if (isSuper !== true || sending) return;

    const sarlavha = title.trim();
    if (!sarlavha) {
      setNatija({ tur: "xato", matn: "Sarlavhani kiriting." });
      return;
    }
    if ([...sarlavha].length > SARLAVHA_MAX) {
      setNatija({ tur: "xato", matn: XATO_MATN.too_long });
      return;
    }
    if ([...body].length > MATN_MAX || [...region].length > VILOYAT_MAX) {
      setNatija({ tur: "xato", matn: XATO_MATN.too_long });
      return;
    }

    let scheduledAt = "";
    if (schedule) {
      // `datetime-local` mahalliy vaqtni beradi; `Date.parse` uni
      // brauzer mintaqasida o'qiydi va ISO'ga o'tkazamiz — server
      // faqat RFC3339 qabul qiladi.
      const t = Date.parse(schedule);
      if (!Number.isFinite(t)) {
        setNatija({
          tur: "xato",
          matn: "Rejalashtirilgan vaqt tushunarsiz. Sana va vaqtni qaytadan tanlang.",
        });
        return;
      }
      const hozir = Date.now();
      if (t < hozir - ORQAGA_CHEKINISH) {
        setNatija({
          tur: "xato",
          matn: "Rejalashtirilgan vaqt o'tmishda. Kelajakdagi vaqtni tanlang yoki maydonni bo'shatib darhol yuboring.",
        });
        return;
      }
      if (t > hozir + OLDINGA_CHEGARA) {
        setNatija({
          tur: "xato",
          matn: "Rejalashtirilgan vaqt bir yildan uzoqda. Sanani tekshirib ko'ring.",
        });
        return;
      }
      scheduledAt = new Date(t).toISOString();
    }

    setNatija(null);
    setSending(true);
    try {
      const javob = await api.post<{ recipients?: number; status?: string }>(
        "/api/admin/broadcast",
        { title: sarlavha, body, region: region.trim(), activeOnly, scheduledAt },
        { auth: "admin" } as any,
      );
      // Qabul qiluvchilar soni ishonchsiz bo'lsa, uni O'YLAB
      // to'ldirmaymiz: «~undefined foydalanuvchiga» degan xabar
      // haqiqatdan ham yomonroq.
      const soni = Number.isFinite(javob?.recipients)
        ? `~${son(javob.recipients as number)} foydalanuvchiga`
        : "Foydalanuvchilarga";
      setNatija({
        tur: "ok",
        matn:
          javob?.status === "scheduled"
            ? `${soni} rejalashtirildi`
            : `${soni} yuborilmoqda (fon jarayonida)`,
      });
      // Segment va katakcha ataylab o'z joyida qoladi (yuqoridagi izoh).
      setTitle("");
      setBody("");
      setSchedule("");
      if (page === 1) await load();
      else setPage(1);
    } catch (e) {
      setNatija({ tur: "xato", matn: `Xabar yuborilmadi: ${xatoMatni(e)}` });
      // Bo'sh segment — ro'yxatdagi sonlar eskirganining dalili
      // (odam o'chirilgan yoki bloklangan). Ro'yxat darhol yangilanadi,
      // aks holda admin o'sha o'lik segmentni yana tanlardi.
      if ((e as APIError | null)?.code === "empty_segment") viloyatlarniYukla();
    } finally {
      setSending(false);
    }
  }

  /* ── Bekor qilish ───────────────────────────────────────────────────
     Faqat «rejalashtirilgan» tarqatmada va faqat tasdiqlash oynasidan
     keyin. `isSuper` qaytadan tekshiriladi. */
  async function bekorQil() {
    if (!bekor || isSuper !== true || bekorBand) return;
    setOynaXato("");
    setBekorBand(true);
    try {
      await api.delete(`/api/admin/broadcasts/${encodeURIComponent(bekor.id)}`, {
        auth: "admin",
      } as any);
      setBekor(null);
      await load();
    } catch (e) {
      // Oyna YOPILMAYDI: 409 («allaqachon yuborilmoqda») aynan shu
      // yerda o'qilishi kerak, aks holda admin bekor qilindi deb
      // o'ylab ketardi.
      setOynaXato(xatoMatni(e));
    } finally {
      setBekorBand(false);
    }
  }

  const qatorlar = tarix?.items ?? [];
  const jami = tarix?.total ?? 0;
  const pages = Math.max(1, Math.ceil(jami / LIMIT));
  const boshi = jami ? (page - 1) * LIMIT + 1 : 0;
  const oxiri = Math.min(page * LIMIT, jami);
  // Birinchi yuklanish — skelet qatorlar. Keyingi yuklanishlarda jadval
  // joyida qoladi: yuborishdan keyingi yangilanish ekranni sakratmasin.
  const birinchiYuklanish = yuklanmoqda && !tarix && !xato;

  const karta: React.CSSProperties = {
    boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}`,
  };
  const ustun = (px: number) => ({ width: `${(px / 716) * 100}%` });

  /* Tugmaning to'rtta holati — Figma 3.8a · B. */
  const tugmaOchiq = !title.trim() || sending;
  const tugmaFon = sending
    ? KO_K_QUYUQ
    : tugmaOchiq
      ? AVATAR_FON
      : schedule
        ? ORANJ
        : KO_K;
  const tugmaRang = tugmaOchiq && !sending ? XIRA_QUYUQ : "#ffffff";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha kartasi (Figma: 85 px, pad 16/20, oraliq 14) ────── */}
      <div
        className="flex min-h-[85px] items-center gap-[14px] rounded-2xl bg-white px-5 py-4"
        style={karta}
      >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
          style={{ background: IKON_FON }}
        >
          <Megaphone size={20} aria-hidden style={{ color: KO_K }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-8" style={{ color: IK }}>
            Tarqatma
          </h1>
          {/* Ikkinchi qator HAR DOIM chiziladi — yashirilsa sarlavha
              yuklanish paytida sakrab, keyin qayta paydo bo'lardi. */}
          <p className="mt-[2px] text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Foydalanuvchilarga ommaviy xabar yuborish
          </p>
        </div>
        {/* «Faqat superadmin» nishoni HAMMAGA ko'rinadi: superadmin
            bo'lmagan admin uchun bu ekran nega bo'sh ekanining javobi. */}
        <span
          className="ml-auto inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-lg px-[10px]"
          style={{ background: AVATAR_FON }}
        >
          <Lock size={13} aria-hidden style={{ color: OCH_KUL }} />
          <span
            className="whitespace-nowrap text-[11px] font-medium leading-4"
            style={{ color: OCH_KUL }}
          >
            Faqat superadmin
          </span>
        </span>
      </div>

      {isSuper === false ? (
        /* Butun ekran qulflangan (Figma 3.8a sarlavhasi). Forma ham,
           tarix ham chizilmaydi: ular faqat superadmin uchun. */
        <div
          className="flex items-start gap-[10px] rounded-xl px-4 py-4"
          style={{ background: SARIQ_FON }}
        >
          <Lock size={16} aria-hidden className="mt-[2px] shrink-0" style={{ color: ORANJ }} />
          <div>
            <p className="text-[13px] font-semibold leading-[19px]" style={{ color: ORANJ_MATN }}>
              Bu bo&apos;lim faqat superadminga ochiq
            </p>
            <p className="mt-[2px] text-[12px] leading-[17px]" style={{ color: ORANJ_MATN }}>
              Ommaviy xabar barcha foydalanuvchilarga bir vaqtda ketadi, shuning uchun
              uni yuborish va tarixini ko&apos;rish faqat superadmin huquqida.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* ══ Chap ustun — 420 px (Figma: V oraliq 12) ══════════════ */}
          <div className="flex flex-col gap-3 xl:w-[420px] xl:shrink-0">
            {/* ── Karta · Yangi tarqatma (pad 18/20, V oraliq 14) ──── */}
            <div className="flex flex-col gap-[14px] rounded-2xl bg-white px-5 py-[18px]" style={karta}>
              <h2 className="text-[17px] font-semibold leading-[25px]" style={{ color: IK }}>
                Yangi tarqatma
              </h2>

              <Maydon raqam={1} nomi="Sarlavha" majburiy>
                <Kirit
                  nomi="Tarqatma sarlavhasi"
                  qiymat={title}
                  ozgardi={(v) => {
                    setTitle(v);
                    tozala();
                  }}
                  placeholder="Masalan: Yangilik!"
                  maxLength={SARLAVHA_MAX}
                />
              </Maydon>

              <Maydon raqam={2} nomi="Matn">
                <textarea
                  aria-label="Tarqatma matni"
                  className={`h-[120px] w-full resize-none rounded-[10px] bg-white py-3 text-[14px] font-medium leading-5 outline-none placeholder:font-normal placeholder:text-[#9aa0b0] ${FOKUS}`}
                  style={{
                    paddingLeft: 14,
                    paddingRight: 14,
                    color: IK,
                    boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                  }}
                  value={body}
                  maxLength={MATN_MAX}
                  placeholder="Xabar matni…"
                  onChange={(e) => {
                    setBody(e.target.value);
                    tozala();
                  }}
                />
              </Maydon>

              <Maydon raqam={3} nomi="Segment: viloyat" ong="ixtiyoriy">
                <ViloyatTanla
                  qiymat={region}
                  ozgardi={(v) => {
                    setRegion(v);
                    tozala();
                  }}
                  royxat={viloyatlar ?? []}
                  jami={viloyatJami}
                  yuklanmoqda={viloyatYuk}
                  xato={viloyatXato}
                  qaytaUrin={viloyatlarniYukla}
                />
              </Maydon>

              <Maydon raqam={4} nomi="Qabul qiluvchilar">
                <Belgilash
                  nomi="Faqat faol (bloklanmagan)"
                  izoh="standart holatda yoqilgan"
                  ustunda
                  toliq
                  balandlik={46}
                  radius={10}
                  chap={14}
                  oraliq={10}
                  belgilangan={activeOnly}
                  ozgardi={(v) => {
                    setActiveOnly(v);
                    tozala();
                  }}
                />
              </Maydon>

              <Maydon
                raqam={5}
                nomi="Rejalashtirish"
                izoh="(bo'sh bo'lsa — hozir yuboriladi)"
              >
                {/* `min` ATAYLAB berilmagan: u har renderda yangilanib,
                    brauzerning o'zi maydonni «yaroqsiz» deb bo'yab
                    qo'yardi. O'tgan vaqt tekshiruvi `send()` da va
                    serverda — ikkalasi ham aniq xabar beradi. */}
                <div className="relative">
                  <Clock
                    size={16}
                    aria-hidden
                    className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2"
                    style={{ color: OCH_KUL }}
                  />
                  <input
                    aria-label="Yuborish vaqti"
                    type="datetime-local"
                    className={`h-11 w-full rounded-[10px] bg-white pl-[38px] pr-[12px] text-[14px] font-medium leading-5 outline-none ${FOKUS}`}
                    style={{
                      color: schedule ? IK : XIRA_QUYUQ,
                      boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                    }}
                    value={schedule}
                    onChange={(e) => {
                      setSchedule(e.target.value);
                      tozala();
                    }}
                  />
                </div>
              </Maydon>

              {/* ── Tugma — 4 holat (Figma 3.8a · B) ───────────────── */}
              <button
                type="button"
                onClick={send}
                disabled={tugmaOchiq}
                className={`inline-flex h-12 w-full select-none items-center justify-center gap-2 rounded-xl text-[15px] font-semibold leading-[22px] transition-[filter,background-color] ${FOKUS} ${
                  tugmaOchiq ? "cursor-not-allowed" : "hover:brightness-95"
                }`}
                style={{ background: tugmaFon, color: tugmaRang }}
              >
                {sending ? (
                  <Loader2 size={17} aria-hidden className="animate-spin" />
                ) : schedule ? (
                  <CalendarClock size={17} aria-hidden />
                ) : (
                  <Send size={17} aria-hidden />
                )}
                {sending ? "Yuborilmoqda…" : schedule ? "Rejalashtirish" : "Yuborish"}
              </button>

              {/* ── Natija xabari (Figma 3.8a · C) ─────────────────── */}
              {natija && (
                <div
                  role={natija.tur === "xato" ? "alert" : "status"}
                  className="flex items-start gap-[10px] rounded-[11px] px-[14px] py-3"
                  style={{ background: natija.tur === "xato" ? XAVF_FON : YASHIL_FON }}
                >
                  {natija.tur === "xato" ? (
                    <CircleAlert
                      size={17}
                      aria-hidden
                      className="mt-[1px] shrink-0"
                      style={{ color: QIZIL }}
                    />
                  ) : (
                    <CircleCheck
                      size={17}
                      aria-hidden
                      className="mt-[1px] shrink-0"
                      style={{ color: YASHIL }}
                    />
                  )}
                  <p
                    className="text-[12px] font-medium leading-[17px]"
                    style={{ color: natija.tur === "xato" ? QIZIL : YASHIL_MATN }}
                  >
                    {natija.matn}
                  </p>
                </div>
              )}
            </div>

            {/* ── Izoh · fon jarayoni (Figma: 54 px, r10, pad 10/12) ── */}
            <div
              className="flex items-start gap-[9px] rounded-[10px] px-3 py-[10px]"
              style={{ background: AVATAR_FON }}
            >
              <Info size={15} aria-hidden className="mt-[1px] shrink-0" style={{ color: OCH_KUL }} />
              <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                Yuborish fon jarayonida bajariladi — ko&apos;p foydalanuvchi bo&apos;lsa
                ham sahifa kutib qolmaydi.
              </p>
            </div>
          </div>

          {/* ══ O'ng ustun — Karta · Tarqatmalar tarixi (732) ═════════ */}
          <div
            className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-white"
            style={karta}
          >
            {/* Karta sarlavhasi — Figma: 57 px, pad 16/18. */}
            <div className="flex h-[57px] items-center gap-[10px] px-[18px]">
              <h2 className="text-[17px] font-semibold leading-[25px]" style={{ color: IK }}>
                Tarqatmalar tarixi
              </h2>
              <span
                className="ml-auto shrink-0 text-[12px] leading-[17px]"
                style={{ color: OCH_KUL }}
              >
                Sahifada {LIMIT} tadan
              </span>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[716px]">
                {/* Jadval sarlavhasi — Figma: 42 px, fon #eef1fb, 11 Semi Bold. */}
                <div className="flex h-[42px] items-center" style={{ background: AVATAR_FON }}>
                  <div
                    className="shrink-0 truncate pl-[18px] pr-[10px] text-[11px] font-semibold leading-4"
                    style={{ ...ustun(126), color: KUL }}
                  >
                    Sarlavha
                  </div>
                  {(
                    [
                      ["Segment", 168],
                      ["Yuborilgan", 82],
                      ["Holat", 128],
                      ["Vaqt", 141],
                      ["Amal", 71],
                    ] as [string, number][]
                  ).map(([nomi, px]) => (
                    <div
                      key={nomi}
                      className="shrink-0 truncate px-[10px] text-[11px] font-semibold leading-4"
                      style={{ ...ustun(px), color: KUL }}
                    >
                      {nomi}
                    </div>
                  ))}
                </div>

                {xato && !qatorlar.length ? (
                  /* Xato holati. Bo'sh jadval CHIZILMAYDI: admin uni
                     "tarqatma yo'q" deb o'qib, noto'g'ri xulosaga
                     kelardi. */
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
                      Tarixni yuklab bo&apos;lmadi
                    </p>
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
                  /* Figma 3.8a · «Tarixda 6 ta skelet qator». Balandlik
                     ham 58 px: javob kelganda jadval sakramaydi. */
                  <div role="status" aria-live="polite">
                    <span className="sr-only">Tarqatmalar tarixi yuklanmoqda…</span>
                    {Array.from({ length: SKELET }, (_, i) => (
                      <div
                        key={i}
                        aria-hidden
                        className={`flex h-[58px] items-center ${i % 2 === 1 ? "bg-[#f8f9ff]" : "bg-white"}`}
                        style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
                      >
                        <div className="shrink-0 pl-[18px] pr-[10px]" style={ustun(126)}>
                          <div
                            className="h-[14px] w-[80%] animate-pulse rounded"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-[10px]" style={ustun(168)}>
                          <div
                            className="h-6 w-[85%] animate-pulse rounded-md"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-[10px]" style={ustun(82)}>
                          <div
                            className="h-[14px] w-[60%] animate-pulse rounded"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-[10px]" style={ustun(128)}>
                          <div
                            className="h-6 w-[90%] animate-pulse rounded-[13px]"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-[10px]" style={ustun(141)}>
                          <div
                            className="h-[13px] w-[85%] animate-pulse rounded"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                        <div className="shrink-0 px-[10px]" style={ustun(71)}>
                          <div
                            className="h-[14px] w-[30%] animate-pulse rounded"
                            style={{ background: HOSHIYA }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !qatorlar.length ? (
                  /* Bo'sh holat — Figma 3.8a · 4-panel. */
                  <div className="flex flex-col items-center gap-[10px] px-5 py-[64px] text-center">
                    <Megaphone size={34} aria-hidden style={{ color: XIRA_QUYUQ }} />
                    <p className="text-[15px] font-semibold leading-[22px]" style={{ color: IK }}>
                      Hali tarqatma yo&apos;q
                    </p>
                    <p className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                      Tarix bo&apos;sh — chapdagi formadan birinchi tarqatmani yuboring.
                    </p>
                  </div>
                ) : (
                  qatorlar.map((b, i) => (
                    <TarqatmaQatori
                      key={b.id}
                      b={b}
                      juft={i % 2 === 1}
                      ustun={ustun}
                      onBekor={() => {
                        setOynaXato("");
                        setBekor(b);
                      }}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── Sahifalash — Figma: 50 px, pad 0/18, oraliq 8 ─────── */}
            {!!qatorlar.length && (
              <div className="flex h-[50px] items-center gap-2 px-[18px]">
                <div className="text-[12px] leading-[17px]" style={{ color: OCH_KUL }}>
                  {boshi}–{oxiri} / {son(jami)} ta tarqatma
                </div>
                {pages > 1 && (
                  <nav className="ml-auto flex items-center gap-2" aria-label="Sahifalar">
                    <Sahifa
                      nomi="Oldingi sahifa"
                      ochiq={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={15} aria-hidden />
                    </Sahifa>
                    {sahifaRaqamlari(page, pages).map((v, i) =>
                      v === "…" ? (
                        <span
                          key={`bosh-${i}`}
                          aria-hidden
                          className="flex h-8 w-[18px] items-center justify-center text-[12px] font-medium leading-[17px]"
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
                      <ChevronRight size={15} aria-hidden />
                    </Sahifa>
                  </nav>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bekor qilish oynasi (Figma 3.8a · 4-panel: 560, r18) ─────── */}
      <AdminOynaQobiq
        open={!!bekor}
        onClose={() => {
          setBekor(null);
          setOynaXato("");
        }}
        title={bekor ? `«${bekor.title}» bekor qilinsinmi?` : "Bekor qilish"}
        maxWidth="max-w-[560px]"
        radius="rounded-[18px]"
      >
        {bekor && (
          /* Yopish nishoni ATAYLAB yo'q: bekor qilish so'rovi ikkita
             ochiq javobga ega bo'lishi kerak — tasodifiy bosilgan «×»
             «yo'q» degani emas. Escape va qoplamaga bosish esa
             `AdminOynaQobiq` da ishlaydi. */
          <div className="flex flex-col gap-[14px] p-5">
            <div className="flex items-start gap-3">
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                style={{ background: SARIQ_FON }}
              >
                <CalendarX size={22} aria-hidden style={{ color: ORANJ }} />
              </div>
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold leading-[25px]" style={{ color: IK }}>
                  «{bekor.title}» bekor qilinsinmi?
                </h2>
                <p className="mt-[3px] text-[13px] leading-[19px]" style={{ color: KUL }}>
                  {/* Vaqt noma'lum bo'lsa, uni O'YLAB yozmaymiz. */}
                  {bekor.scheduledAt
                    ? `${vaqt(bekor.scheduledAt)} ga rejalashtirilgan tarqatma yuborilmaydi.`
                    : "Rejalashtirilgan tarqatma yuborilmaydi."}{" "}
                  Qayta rejalashtirish uchun yangi tarqatma yaratish kerak.
                </p>
              </div>
            </div>

            {oynaXato && (
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
                  {oynaXato}
                </p>
              </div>
            )}

            <div className="flex h-10 items-center justify-end gap-[10px]">
              <OynaTugma
                kor="ikkilamchi"
                onClick={() => {
                  setBekor(null);
                  setOynaXato("");
                }}
              >
                Yo&apos;q
              </OynaTugma>
              <OynaTugma kor="xavf" onClick={bekorQil} ochiq={bekorBand}>
                {bekorBand ? "Bekor qilinmoqda…" : "Ha, bekor qilish"}
              </OynaTugma>
            </div>
          </div>
        )}
      </AdminOynaQobiq>
    </div>
  );
}

/* ── Forma bo'laklari ───────────────────────────────────────────────── */

/**
 * Raqamlangan maydon — Figma 3.8: 18×18 raqam nishoni + yorliq, ostida
 * maydonning o'zi (V oraliq 6).
 */
function Maydon({
  raqam,
  nomi,
  majburiy,
  izoh,
  ong,
  children,
}: {
  raqam: number;
  nomi: string;
  majburiy?: boolean;
  /** Yorliqdan keyingi qavsli qo'shimcha (Figma: «(bo'sh bo'lsa — hozir yuboriladi)»). */
  izoh?: string;
  /** O'ngga tekislangan qo'shimcha (Figma: «ixtiyoriy»). */
  ong?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-center gap-[6px]">
        <span
          aria-hidden
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-bold leading-[15px]"
          style={{ background: AVATAR_FON, color: OCH_KUL }}
        >
          {raqam}
        </span>
        <span className="text-[12px] font-semibold leading-[17px]" style={{ color: KUL }}>
          {nomi}
        </span>
        {majburiy && (
          <span aria-hidden className="text-[12px] font-bold leading-[17px]" style={{ color: QIZIL }}>
            *
          </span>
        )}
        {izoh && (
          <span className="text-[11px] leading-4" style={{ color: XIRA_QUYUQ }}>
            {izoh}
          </span>
        )}
        {ong && (
          <span className="ml-auto text-[11px] leading-4" style={{ color: XIRA_QUYUQ }}>
            {ong}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Forma maydoni — Figma 3.8: 44 px, radius 10, pad 12/14, 14 px matn.
 *
 * `maxLength` MAJBURIY: chegara serverda ham bor, lekin admin 4 000
 * belgidan oshib yozib bo'lib, keyin rad javob olishi kerak emas.
 */
function Kirit({
  nomi,
  qiymat,
  ozgardi,
  placeholder,
  maxLength,
}: {
  nomi: string;
  qiymat: string;
  ozgardi: (v: string) => void;
  placeholder: string;
  maxLength: number;
}) {
  return (
    <input
      aria-label={nomi}
      type="text"
      className={`h-11 w-full rounded-[10px] bg-white px-[14px] text-[14px] font-medium leading-5 outline-none placeholder:font-normal placeholder:text-[#9aa0b0] ${FOKUS}`}
      style={{ color: IK, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
      value={qiymat}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => ozgardi(e.target.value)}
    />
  );
}

/**
 * Segment tanlagichi — Figma 3.8b · «Viloyat tanlash (ro'yxatdan)».
 *
 * # NEGA YOZISH IMKONI YO'Q
 *
 * Ilgari bu maydon oddiy matn kiritish edi: admin viloyat nomini QO'LDA
 * yozardi. Yuborish filtri esa AYNAN mos qiymat bo'yicha ishlaydi, ya'ni
 * bitta harf xatosi («Samarqnd») hech qanday xatolik bermasdi — xabar
 * shunchaki hech kimga ketmasdi, tarixda esa «yuborildi · 0» bo'lib
 * qolardi. Endi tanlash faqat ro'yxatdan: xato yozish imkoni yo'q.
 *
 * # NEGA RO'YXAT SERVERDAN KELADI
 *
 * `users.region` — profil orqali kelgan erkin matn, unda bir hudud ikki
 * xil yozilgan bo'lishi mumkin («Toshkent shahri» va «Toshkent»). Kodda
 * saqlangan ro'yxat bazadagi haqiqat bilan mos kelishiga kafolat
 * bermaydi, ya'ni «ro'yxatdan tanladim, lekin segment bo'sh» holatini
 * qaytarardi. Server esa faqat mavjud qiymatlarni va har birining
 * QABUL QILUVCHILAR SONINI beradi — admin bosishdan oldin ko'radi.
 *
 * # KLAVIATURA
 *
 * Enter/Bo'shliq ochadi va tanlaydi, ↑ ↓ yuradi, Esc tanlovni
 * o'zgartirmasdan yopadi, Tab yopib keyingi maydonga o'tadi, harf esa
 * shu harf bilan boshlanadigan variantga sakraydi. Fokus HAR DOIM
 * maydonda qoladi (`aria-activedescendant`), shuning uchun ro'yxat
 * ichida sichqonchasiz ham yurish mumkin.
 */
function ViloyatTanla({
  qiymat,
  ozgardi,
  royxat,
  jami,
  yuklanmoqda,
  xato,
  qaytaUrin,
}: {
  qiymat: string;
  ozgardi: (v: string) => void;
  royxat: BroadcastRegion[];
  /** «Barcha viloyatlar» soni; `null` — noma'lum. */
  jami: number | null;
  yuklanmoqda: boolean;
  xato: string;
  qaytaUrin: () => void;
}) {
  const [ochiq, setOchiq] = useState(false);
  const [faol, setFaol] = useState(0);
  const qobiq = useRef<HTMLDivElement | null>(null);
  const royxatRef = useRef<HTMLUListElement | null>(null);
  const idAsos = useId();
  const royxatId = `${idAsos}-viloyatlar`;

  /* Variantlar: 0-o'rinda HAR DOIM «Barcha viloyatlar».
     Tanlangan qiymat ro'yxatda bo'lmasa (katakcha almashib, o'sha
     viloyatda faol odam qolmasa yoki ro'yxat yuklanmasa) u oxiriga
     qo'shiladi: aks holda admin o'z tanlovini ko'rmasdi va uni bekor
     ham qila olmasdi — ya'ni ekranda bir segment, serverga boshqasi
     ketardi. Soni noma'lum bo'lsa O'YLAB to'ldirilmaydi: `son(NaN)`
     «—» beradi. */
  const variantlar: BroadcastRegion[] = [
    { region: "", count: jami ?? NaN },
    ...royxat,
    ...(qiymat && !royxat.some((v) => v.region === qiymat)
      ? [{ region: qiymat, count: NaN }]
      : []),
  ];
  const tanlangan = variantlar.findIndex((v) => v.region === qiymat);
  const joriy = variantlar[tanlangan >= 0 ? tanlangan : 0];

  /* Ro'yxat butunlay yo'q (yuklanmadi yoki bazada viloyat yo'q) va
     tanlangan qiymat ham yo'q — maydon o'chiq: tanlashga narsa yo'q.
     Tanlangan qiymat bo'lsa maydon HAR DOIM ochiladi: «barcha
     viloyatlar» ga qaytish yo'li yopilib qolmasligi kerak. */
  const bosilmas = yuklanmoqda || (!royxat.length && !qiymat);
  /** Figma 3.8b · A4: qizil hoshiya + «Qayta urinish». */
  const xatoKor = !!xato && !royxat.length && !yuklanmoqda && !qiymat;

  const och = () => {
    if (bosilmas) return;
    setFaol(tanlangan >= 0 ? tanlangan : 0);
    setOchiq(true);
  };

  const tanla = (i: number) => {
    const v = variantlar[i];
    if (v) ozgardi(v.region);
    setOchiq(false);
  };

  function klaviatura(e: React.KeyboardEvent<HTMLButtonElement>) {
    const k = e.key;
    if (!ochiq) {
      if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        och();
      }
      return;
    }
    if (k === "Escape") {
      // Tanlov O'ZGARMAYDI: Esc — «hech narsa qilmadim» degani.
      e.preventDefault();
      setOchiq(false);
      return;
    }
    if (k === "Tab") {
      // `preventDefault` YO'Q: fokus keyingi maydonga o'tishi kerak.
      setOchiq(false);
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      tanla(faol);
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      setFaol((i) => Math.min(variantlar.length - 1, i + 1));
      return;
    }
    if (k === "ArrowUp") {
      e.preventDefault();
      setFaol((i) => Math.max(0, i - 1));
      return;
    }
    if (k === "Home") {
      e.preventDefault();
      setFaol(0);
      return;
    }
    if (k === "End") {
      e.preventDefault();
      setFaol(variantlar.length - 1);
      return;
    }
    /* Harf bilan sakrash — qidiruv maydoni o'rniga. Joriy o'rindan
       KEYIN izlanadi va aylanib chiqiladi: bir harf bilan boshlanadigan
       bir necha viloyat bo'lsa (Samarqand, Surxondaryo, Sirdaryo) ketma-ket
       bosish ular orasida yuradi. */
    if (k.length === 1 && k.trim()) {
      const harf = k.toLowerCase();
      for (let n = 1; n <= variantlar.length; n++) {
        const i = (faol + n) % variantlar.length;
        const nomi = variantlar[i].region || "Barcha viloyatlar";
        if (nomi.toLowerCase().startsWith(harf)) {
          e.preventDefault();
          setFaol(i);
          return;
        }
      }
    }
  }

  /* Maydon o'chib qolsa (masalan sonlar qayta so'ralganda) ro'yxat
     ochiq qolmasligi kerak: u bosilmaydigan maydon ustida turardi. */
  useEffect(() => {
    if (bosilmas) setOchiq(false);
  }, [bosilmas]);

  /** Klaviatura bilan yurilganda faol qator ko'rinish maydoniga tortiladi. */
  useEffect(() => {
    if (!ochiq) return;
    const el = royxatRef.current?.children[faol] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [ochiq, faol]);

  /* Yopilish qoidalari (Figma 3.8b · C): tashqariga bosilsa va sahifa
     aylantirilsa. Ro'yxat ichini aylantirish sahifani surmaydi
     (`overscroll-contain`), shuning uchun u ro'yxatni yopmaydi. */
  useEffect(() => {
    if (!ochiq) return;
    const tashqari = (e: PointerEvent) => {
      if (!qobiq.current?.contains(e.target as Node)) setOchiq(false);
    };
    const yop = () => setOchiq(false);
    document.addEventListener("pointerdown", tashqari);
    window.addEventListener("scroll", yop);
    return () => {
      document.removeEventListener("pointerdown", tashqari);
      window.removeEventListener("scroll", yop);
    };
  }, [ochiq]);

  /* Maydon ostidagi ogohlantirish. HAR DOIM rost gapiradi: segment
     tanlanmaganini yashirish adminni «viloyatga yubordim» deb
     o'ylashga majbur qilardi. */
  const izoh = xatoKor
    ? `${xato} Segment tanlanmadi — xabar barcha viloyatlarga ketadi.`
    : xato
      ? `${xato} Sonlar eskirgan bo'lishi mumkin.`
      : !yuklanmoqda && !royxat.length
        ? "Bazada viloyat ma'lumoti yo'q — xabar barcha foydalanuvchilarga ketadi."
        : "";

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="relative" ref={qobiq}>
        {xatoKor ? (
          /* Figma 3.8b · A4. Tugma maydon ICHIDA emas, yonida: tugma
             ichida tugma — yaroqsiz HTML va klaviatura uchun tuzoq. */
          <div
            className="flex h-11 w-full items-center gap-2 rounded-[10px] bg-white px-[14px]"
            style={{ boxShadow: `inset 0 0 0 1px ${QIZIL_HOSHIYA}` }}
          >
            <span
              className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5"
              style={{ color: QIZIL }}
            >
              Ro&apos;yxat yuklanmadi
            </span>
            <button
              type="button"
              onClick={qaytaUrin}
              className={`shrink-0 rounded text-[12px] font-semibold leading-[17px] ${FOKUS}`}
              style={{ color: KO_K }}
            >
              Qayta urinish
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="combobox"
            aria-label="Segment: viloyat"
            aria-haspopup="listbox"
            aria-expanded={ochiq}
            aria-controls={royxatId}
            aria-activedescendant={ochiq ? `${royxatId}-${faol}` : undefined}
            disabled={bosilmas}
            onClick={() => (ochiq ? setOchiq(false) : och())}
            onKeyDown={klaviatura}
            /* Fokus konturi faqat YOPIQ holatda. Ochiq holatda maydonda
               allaqachon 2 px ko'k hoshiya bor va ostida ro'yxat turadi —
               ustiga yana kontur qo'shilsa ikkita ko'k halqa bo'lib
               ko'rinardi (Figma A3 da bitta hoshiya chizilgan). Fokus
               ko'rinishi yo'qolmaydi: Tab bilan yurganda maydon yopiq. */
            className={`flex h-11 w-full items-center gap-2 rounded-[10px] px-[14px] text-left outline-none ${
              ochiq ? "" : FOKUS
            } ${bosilmas ? "cursor-not-allowed" : ""}`}
            style={{
              background: bosilmas ? AVATAR_FON : "#ffffff",
              boxShadow: `inset 0 0 0 ${ochiq ? 2 : 1}px ${
                ochiq ? KO_K : bosilmas ? HOSHIYA : HOSHIYA_QUYUQ
              }`,
            }}
          >
            {yuklanmoqda ? (
              <>
                <Loader2
                  size={15}
                  aria-hidden
                  className="shrink-0 animate-spin"
                  style={{ color: XIRA_QUYUQ }}
                />
                <span className="text-[14px] leading-5" style={{ color: XIRA_QUYUQ }}>
                  Viloyatlar yuklanmoqda…
                </span>
              </>
            ) : (
              <>
                <span
                  className={`min-w-0 flex-1 truncate text-[14px] leading-5 ${
                    qiymat ? "font-medium" : ""
                  }`}
                  style={{ color: qiymat ? IK : XIRA_QUYUQ }}
                  title={qiymat || "Barcha viloyatlar"}
                >
                  {qiymat || "Barcha viloyatlar"}
                </span>
                {/* Sanoq nishoni — faqat tanlangan viloyatda va faqat
                    soni ma'lum bo'lsa (Figma 3.8b · A2). */}
                {!!qiymat && Number.isFinite(joriy?.count) && (
                  <span
                    className="inline-flex h-[22px] shrink-0 items-center rounded-md px-2"
                    style={{ background: AVATAR_FON }}
                    title="Shu segmentdagi qabul qiluvchilar soni"
                  >
                    <span
                      className="text-[11px] font-medium leading-4 tabular-nums"
                      style={{ color: KUL }}
                    >
                      {son(joriy.count)}
                    </span>
                  </span>
                )}
                <ChevronDown size={16} aria-hidden className="shrink-0" style={{ color: OCH_KUL }} />
              </>
            )}
          </button>
        )}

        {ochiq && (
          <ul
            id={royxatId}
            ref={royxatRef}
            role="listbox"
            aria-label="Viloyatlar"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-y-auto overscroll-contain rounded-xl bg-white py-[6px]"
            style={{
              maxHeight: ROYXAT_BALANDLIK,
              boxShadow: `inset 0 0 0 1px ${HOSHIYA_OCH}, ${ROYXAT_SOYA}`,
            }}
          >
            {variantlar.map((v, i) => {
              const belgilangan = v.region === qiymat;
              /* Birinchi qatordan keyin ajratgich: «Barcha viloyatlar»
                 alohida ma'noli variant, viloyatlar ro'yxatining bir
                 qatori emas. */
              const soyalar: string[] = [];
              if (i === 0) soyalar.push(`inset 0 -1px 0 ${HOSHIYA}`);
              if (i === faol) soyalar.push(`inset 0 0 0 2px ${KO_K}`);
              const nomi = v.region || "Barcha viloyatlar";
              return (
                <li
                  key={v.region || "__barcha"}
                  id={`${royxatId}-${i}`}
                  role="option"
                  aria-selected={belgilangan}
                  // Fokus tugmada qolishi kerak: `aria-activedescendant`
                  // shunda ishlaydi va Esc/↑↓ bosilaverishi mumkin.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setFaol(i)}
                  onClick={() => tanla(i)}
                  className={`flex h-10 cursor-pointer items-center gap-2 pl-[14px] pr-3 ${
                    belgilangan ? "" : "hover:bg-[#f8f9ff]"
                  }`}
                  style={{
                    background: belgilangan ? KO_K_FON : undefined,
                    boxShadow: soyalar.length ? soyalar.join(", ") : undefined,
                  }}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] leading-[19px] ${
                      belgilangan ? "font-semibold" : "font-medium"
                    }`}
                    style={{ color: belgilangan ? KO_K : IK }}
                    title={nomi}
                  >
                    {nomi}
                  </span>
                  <span
                    className="shrink-0 text-[11px] leading-4 tabular-nums"
                    style={{ color: belgilangan ? KO_K : OCH_KUL }}
                  >
                    {son(v.count)}
                  </span>
                  {belgilangan && (
                    <Check size={14} aria-hidden className="shrink-0" style={{ color: KO_K }} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!!izoh && (
        <p className="flex items-center gap-2 text-[11px] leading-4" style={{ color: OCH_KUL }}>
          <span className="min-w-0">{izoh}</span>
          {!!xato && !xatoKor && (
            <button
              type="button"
              onClick={qaytaUrin}
              className={`shrink-0 rounded text-[11px] font-semibold leading-4 ${FOKUS}`}
              style={{ color: KO_K }}
            >
              Qayta urinish
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/* ── Jadval bo'laklari ──────────────────────────────────────────────── */

/**
 * Tarix qatori — Figma 3.8: 58 px, toq qator oq, juft qator #f8f9ff,
 * ostida 1 px hoshiya.
 *
 * # NEGA QATOR BOSILMAYDI
 *
 * 3.6 (Arizalar) va 3.7 (Turkumlar) da qator bosiladigan havola, bu
 * yerda esa yo'q: tarqatmaning «batafsil» sahifasi Figma'da chizilmagan
 * va backendda ham bitta tarqatmani beradigan yo'l yo'q. Bosiladigan
 * ko'rinish yasab, hech qayerga olib bormaslik — yolg'on funksiya.
 */
function TarqatmaQatori({
  b,
  juft,
  ustun,
  onBekor,
}: {
  b: Broadcast;
  juft: boolean;
  ustun: (px: number) => { width: string };
  onBekor: () => void;
}) {
  const holat = holati(b.status);
  const nishon = NISHON[holat];
  const yuborilgan = holat === "done" && Number.isFinite(b.sentCount);
  // Figma: rejalashtirilgan qatorda yuborish vaqti, qolganlarida
  // yaratilgan vaqt ko'rsatiladi.
  const reja = holat === "scheduled" && !!b.scheduledAt;
  const segment = `${(b.region || "").trim() || "barcha viloyat"} · ${
    b.activeOnly ? "faol" : "hammasi"
  }`;

  return (
    <div
      className={`flex h-[58px] items-center ${juft ? "bg-[#f8f9ff]" : "bg-white"}`}
      style={{ boxShadow: `inset 0 -1px 0 ${HOSHIYA}` }}
    >
      {/* Sarlavha — 126 px ga sig'masligi mumkin, shuning uchun to'liq
          matn `title` da qoladi. */}
      <div
        className="shrink-0 truncate pl-[18px] pr-[10px] text-[13px] font-medium leading-[19px]"
        style={{ ...ustun(126), color: IK }}
        title={b.title}
      >
        {b.title}
      </div>

      {/* Segment nishoni — Figma: h24, r6, pad 4/8 */}
      <div className="flex min-w-0 shrink-0 px-[10px]" style={ustun(168)}>
        <span
          className="inline-flex h-6 max-w-full items-center rounded-md px-2"
          style={{ background: AVATAR_FON }}
        >
          <span className="truncate text-[11px] leading-4" style={{ color: KUL }} title={segment}>
            {segment}
          </span>
        </span>
      </div>

      {/* Yuborilgan — faqat yakunlangan tarqatmada real son bo'ladi */}
      <div
        className="shrink-0 truncate px-[10px]"
        style={ustun(82)}
        title={yuborilgan ? "Bildirishnoma ketgan foydalanuvchilar soni" : "Hali yuborilmagan"}
      >
        {yuborilgan ? (
          <span className="text-[13px] font-semibold leading-[19px]" style={{ color: IK }}>
            {son(b.sentCount)}
          </span>
        ) : (
          <span className="text-[13px] leading-[19px]" style={{ color: XIRA_QUYUQ }}>
            —
          </span>
        )}
      </div>

      {/* Holat nishoni — Figma: h24, r13, gap 5, pad 4/9, nuqta 6 px */}
      <div className="flex shrink-0 px-[10px]" style={ustun(128)}>
        <span
          className="inline-flex h-6 shrink-0 items-center gap-[5px] rounded-[13px] px-[9px]"
          style={{ background: nishon.fon }}
        >
          <span
            aria-hidden
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: nishon.rang }}
          />
          <span
            className="whitespace-nowrap text-[11px] font-medium leading-4"
            style={{ color: nishon.rang }}
          >
            {nishon.matn}
          </span>
        </span>
      </div>

      {/* Vaqt */}
      <div
        className="shrink-0 truncate px-[10px] text-[12px] leading-[17px]"
        style={{ ...ustun(141), color: KUL }}
        title={reja ? "Rejalashtirilgan vaqt" : "Yaratilgan vaqt"}
      >
        {vaqt(reja ? b.scheduledAt : b.createdAt)}
      </div>

      {/* Amal — «Bekor» faqat rejalashtirilgan tarqatmada (Figma 3.8a · D) */}
      <div className="flex shrink-0 items-center px-[10px]" style={ustun(71)}>
        {holat === "scheduled" ? (
          <button
            type="button"
            onClick={onBekor}
            aria-label={`«${b.title}» tarqatmasini bekor qilish`}
            className={`inline-flex h-[29px] shrink-0 select-none items-center rounded-lg bg-[#fcebec] px-[10px] text-[12px] font-semibold leading-[17px] transition-colors hover:bg-[#f9dcde] ${FOKUS}`}
            style={{ color: QIZIL }}
          >
            Bekor
          </button>
        ) : (
          /* «—» ataylab chiziladi: bo'sh katak «tugma yuklanmadi» degan
             shubhani qoldirardi. */
          <span className="text-[13px] leading-[19px]" style={{ color: XIRA_QUYUQ }}>
            —
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Sahifalash tugmasi — Figma 3.8: 32×32, radius 8. Joriy sahifa ko'k
 * fonda (12 Semi Bold), qolganlari oq fonda 1 px hoshiya bilan
 * (12 Medium).
 *
 * Kengligi `min-w-8`: uch xonali raqam 32 px ga sig'masdi.
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
      className={`inline-flex h-8 min-w-8 select-none items-center justify-center rounded-lg px-[6px] text-[12px] leading-[17px] tabular-nums transition-colors ${FOKUS} ${
        joriy ? "font-semibold text-white" : "font-medium"
      } ${ochiq ? "cursor-not-allowed" : joriy ? "hover:brightness-95" : "bg-white hover:bg-[#f4f6fc]"}`}
      style={
        joriy
          ? { background: KO_K }
          : {
              color: ochiq ? XIRA_QUYUQ : KUL,
              boxShadow: `inset 0 0 0 1px ${ochiq ? HOSHIYA : HOSHIYA_QUYUQ}`,
            }
      }
    >
      {children}
    </button>
  );
}

/**
 * Oyna oyoqchasidagi tugma — Figma 3.8a · 4-panel: 40 px, radius 10,
 * pad 10/16, 13 Semi Bold.
 *
 * `ui.ts` dagi `tugma()` EMAS: u 36 px va o'chiq holatda xira qizil
 * (#f3acaf), 3.8a esa 40 px va o'chiq tugmani kulrang (#eef1fb /
 * #9aa0b0) qilib chizadi.
 */
function OynaTugma({
  kor,
  onClick,
  ochiq,
  children,
}: {
  kor: "ikkilamchi" | "xavf";
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ochiq}
      className={`${asos} ${ochiq ? "cursor-not-allowed" : "hover:brightness-95"}`}
      style={{
        background: ochiq ? AVATAR_FON : QIZIL,
        color: ochiq ? XIRA_QUYUQ : "#ffffff",
      }}
    >
      {children}
    </button>
  );
}
