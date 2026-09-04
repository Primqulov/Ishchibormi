"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  KeyRound,
  Loader2,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { APIError, Admin, api, setAdminToken } from "@/lib/api";
import { AdminOynaQobiq } from "@/components/admin/AdminModal";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_OCH,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KO_K_XIRA,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_FON,
  QIZIL,
  QIZIL_XIRA,
  SOYA,
  XIRA,
  XIRA_QUYUQ,
  YASHIL,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.10 · Xavfsizlik (2FA) — 1-holat: yoqilmagan (1440×1024)",
          "3.10a · Xavfsizlik — sozlash oqimi va holatlar",
          "3.10c · 2FA'ni o'chirish oqimi (o'z profilidan)".

   O'lchamlar Figma'dan: kontent ustuni 672, sarlavha kartasi 83, QR
   qutisi 208 (ichida 176 QR), kalit yo'lagi 56, kod maydoni 170×58,
   qadam nishoni 26, h48 tugmalar, tasdiq oynasi h38 tugmalar.

   # UCH HOLAT

   1-holat  yoqilmagan     → tavsif + «2FA yoqish»
   2-holat  sozlash oqimi  → QR + maxfiy kalit + kodni tasdiqlash
   3-holat  yoqilgan       → joriy kod bilan «2FA o'chirish»

   Holat SERVERDAN keladi (`me.totpEnabled`), lokal bayroqdan emas: 2FA
   boshqa qurilmada o'chirilgan bo'lsa, bu tab uni "yoqilgan" deb
   ko'rsatib turmasligi kerak.

   # XAVFSIZLIK

   · Amal faqat O'Z hisobiga tegishli — boshqa adminning 2FA'si bu
     yerdan boshqarilmaydi (backend `currentAdmin`ni oladi, id so'rovdan
     kelmaydi).
   · Ikkala amal ham joriy 6 xonali kod talab qiladi. Tasdiq oynasi —
     qo'shimcha to'siq, kodning O'RNINI bosmaydi (Figma 3.10c
     «Kodsiz o'chmaydi»).
   · Yuborilayotganda maydon ham, tugma ham o'chadi (`band`): ikki marta
     bosilsa ikkita so'rov ketardi va ikkinchisi "kod ishlatilgan" bo'lib
     qaytardi.
   · Maxfiy kalit faqat sozlash oqimi ochiq turganda ko'rinadi; «Bekor»
     bosilganda darhol holatdan chiqariladi.
   · Server yangi access token qaytaradi (2FA o'zgarishi qolgan
     sessiyalarni bekor qiladi) — uni saqlamasak shu tabning o'zi
     keyingi so'rovdayoq 401 olardi.
   ───────────────────────────────────────────────────────────────────── */

const FOKUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#004ac6]";

/** Figma 3.10a · F — xabar bloklari va holat nishonlari. */
const YASHIL_FON = "#e6f5ed";
const YASHIL_MATN = "#12784a";
const XAVF_FON = "#fcebec";
/** Xato holatidagi kod maydoni foni (Figma 3.10a · «Xato kod»). */
const XATO_MAYDON = "#fdf2f3";
/** Kulrang nishon va o'chiq tugma foni. */
const NISHON_FON = "#eef0f6";

type Sozlash = { secret: string; uri: string };

/**
 * Kod maydonidagi xato turi. Har biriga BOSHQA to'g'irlash mos keladi,
 * shuning uchun ular bitta "xato" satriga yig'ilmaydi (Figma 3.10c
 * «Xato tarmoqlari»).
 */
type KodXato = "notogri" | "muddat" | "limit" | null;

/** Ketayotgan amal — takroriy yuborishni to'sadi. */
type Band = "" | "boshlash" | "tasdiq" | "ochirish";

const KOD_XABAR: Record<Exclude<KodXato, null>, string> = {
  notogri: "Kod noto'g'ri.",
  muddat: "Kod muddati o'tgan. Ilovadagi yangi kodni kiriting.",
  limit:
    "Juda ko'p urinish bo'ldi. 15 daqiqadan so'ng qaytadan urinib ko'ring.",
};

/** Maxfiy kalit 4 belgili guruhlarga bo'linadi — qo'lda kiritish uchun. */
function kalitniBezash(secret: string) {
  return (secret.match(/.{1,4}/g) || []).join(" ");
}

export default function AdminSecurity() {
  const [me, setMe] = useState<Admin | null>(null);
  const [yuklashXato, setYuklashXato] = useState("");
  const [sozlash, setSozlash] = useState<Sozlash | null>(null);
  const [kod, setKod] = useState("");
  const [kodXato, setKodXato] = useState<KodXato>(null);
  /** Tarmoq / server xatosi — holat o'zgarmaydi, «Qayta urinish» chiqadi. */
  const [serverXato, setServerXato] = useState("");
  const [qaytaAmal, setQaytaAmal] = useState<Band>("");
  const [ok, setOk] = useState("");
  const [band, setBand] = useState<Band>("");
  const [tasdiqOyna, setTasdiqOyna] = useState(false);
  const [nusxalandi, setNusxalandi] = useState(false);
  /**
   * Xatodan keyin kursorni maydonga qaytarish so'rovi.
   *
   * To'g'ridan-to'g'ri `focus()` chaqirib bo'lmaydi: xato tutilgan payt
   * maydon hali `band` sababli o'chiq, o'chiq element esa fokus olmaydi.
   * Shuning uchun so'rov belgilanadi va `band` bo'shagach bajariladi.
   */
  const [fokusKerak, setFokusKerak] = useState(false);

  const kodRef = useRef<HTMLInputElement | null>(null);
  const kalitRef = useRef<HTMLElement | null>(null);

  const yukla = useCallback(async () => {
    try {
      setMe(await api.get<Admin>("/api/admin/me", { auth: "admin" }));
      setYuklashXato("");
    } catch (e) {
      setYuklashXato((e as APIError)?.message || "Ma'lumotni yuklab bo'lmadi.");
    }
  }, []);

  useEffect(() => {
    yukla();
  }, [yukla]);

  useEffect(() => {
    if (!fokusKerak || band) return;
    kodRef.current?.focus();
    setFokusKerak(false);
  }, [fokusKerak, band]);

  /** «Nusxalandi» yozuvi o'zini o'zi tozalaydi. */
  useEffect(() => {
    if (!nusxalandi) return;
    const t = setTimeout(() => setNusxalandi(false), 2000);
    return () => clearTimeout(t);
  }, [nusxalandi]);

  function tozala() {
    setKodXato(null);
    setServerXato("");
    setQaytaAmal("");
    setOk("");
  }

  /**
   * Xatoni Figma 3.10c tarmoqlariga moslab ko'rsatadi.
   *
   * `expired_totp` — maydon TOZALANADI va fokus unga qaytadi: eski kod
   * boshqa hech qachon ishlamaydi, uni ekranda qoldirish foydasiz.
   * `bad_totp` — maydon ATAYLAB tozalanmaydi: odam bitta xonani tuzatib
   * qayta bosadi.
   */
  function xatoniKorsat(e: unknown, amal: Band) {
    const x = e as APIError;
    switch (x?.code) {
      case "bad_totp":
        setKodXato("notogri");
        setFokusKerak(true);
        return;
      case "expired_totp":
        setKodXato("muddat");
        setKod("");
        setFokusKerak(true);
        return;
      case "rate_limited":
        setKodXato("limit");
        return;
      case "already_enabled":
      case "no_setup":
        // Serverdagi holat boshqacha — ekranni haqiqat bilan tenglashtiramiz.
        setSozlash(null);
        setKod("");
        yukla();
        return;
      default:
        // Tarmoq yoki server xatosi: 2FA holati o'zgarmagan, shuning uchun
        // ekran joyida qoladi va faqat qayta urinish taklif qilinadi.
        setServerXato(
          x?.message || "Server javob bermadi. Qaytadan urinib ko'ring.",
        );
        setQaytaAmal(amal);
    }
  }

  async function boshlash() {
    if (band) return;
    tozala();
    setBand("boshlash");
    try {
      const s = await api.post<Sozlash>(
        "/api/admin/2fa/setup",
        {},
        { auth: "admin" },
      );
      setSozlash(s);
      setKod("");
    } catch (e) {
      xatoniKorsat(e, "boshlash");
    } finally {
      setBand("");
    }
  }

  function bekor() {
    if (band) return;
    // Maxfiy kalit holatdan olib tashlanadi — ekranda qolib ketmasin.
    setSozlash(null);
    setKod("");
    tozala();
  }

  async function tasdiqla() {
    if (band || kod.length !== 6) return;
    tozala();
    setBand("tasdiq");
    try {
      const res = await api.post<{ accessToken?: string }>(
        "/api/admin/2fa/enable",
        { code: kod },
        { auth: "admin" },
      );
      if (res?.accessToken) setAdminToken(res.accessToken);
      setSozlash(null);
      setKod("");
      setOk("2FA yoqildi.");
      await yukla();
    } catch (e) {
      xatoniKorsat(e, "tasdiq");
    } finally {
      setBand("");
    }
  }

  async function ochir() {
    if (band || kod.length !== 6) return;
    setTasdiqOyna(false);
    tozala();
    setBand("ochirish");
    try {
      const res = await api.post<{ accessToken?: string }>(
        "/api/admin/2fa/disable",
        { code: kod },
        { auth: "admin" },
      );
      if (res?.accessToken) setAdminToken(res.accessToken);
      setKod("");
      setOk("2FA o'chirildi.");
      await yukla();
    } catch (e) {
      xatoniKorsat(e, "ochirish");
    } finally {
      setBand("");
    }
  }

  function qaytaUrin() {
    if (qaytaAmal === "boshlash") boshlash();
    else if (qaytaAmal === "tasdiq") tasdiqla();
    else if (qaytaAmal === "ochirish") ochir();
  }

  async function nusxala() {
    if (!sozlash) return;
    try {
      await navigator.clipboard.writeText(sozlash.secret);
      setNusxalandi(true);
    } catch {
      // Clipboard API yopiq (HTTPS bo'lmagan kontekst yoki ruxsat
      // berilmagan) — kalitni belgilab qo'yamiz, admin Ctrl+C bilan oladi.
      const el = kalitRef.current;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (el && sel) {
        const rng = document.createRange();
        rng.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(rng);
      }
    }
  }

  const yoqilgan = !!me?.totpEnabled;
  const holat: "yuklanmoqda" | "yopiq" | "sozlash" | "yoqilgan" = !me
    ? "yuklanmoqda"
    : yoqilgan
      ? "yoqilgan"
      : sozlash
        ? "sozlash"
        : "yopiq";
  const toliq = kod.length === 6;
  const karta: React.CSSProperties = {
    boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}`,
  };

  /* ── Kod maydoni (Figma 3.10a «Kod maydoni holatlari») ─────────────
     Chegara uch holatda: bo'sh/to'liqmas — kulrang, to'liq — brend ko'k
     (o'chirishda qizil, chunki keyingi qadam xavfli), xato — qizil
     chegara va och pushti fon. */
  const kodMaydoni = (opt: { id?: string; xavf?: boolean }) => {
    const xato = kodXato !== null;
    return (
      <input
        id={opt.id}
        ref={kodRef}
        value={kod}
        onChange={(e) => {
          // Faqat raqam, maksimal 6 belgi (Figma 3.10c · 2-qadam).
          setKod(e.target.value.replace(/\D/g, "").slice(0, 6));
          if (kodXato) setKodXato(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (kod.length !== 6 || band) return;
          if (opt.xavf) setTasdiqOyna(true);
          else tasdiqla();
        }}
        disabled={!!band}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        maxLength={6}
        aria-label={opt.id ? undefined : "6 xonali tasdiqlash kodi"}
        aria-invalid={xato}
        aria-describedby={xato ? "kod-xato" : undefined}
        className={`h-[58px] w-[170px] shrink-0 rounded-xl text-center indent-[6px] text-[22px] font-bold leading-7 tracking-[6px] outline-none transition-shadow placeholder:font-bold placeholder:text-[#c3c6d7] disabled:cursor-not-allowed ${FOKUS}`}
        style={{
          color: IK,
          background: xato ? XATO_MAYDON : "#ffffff",
          boxShadow: xato
            ? `inset 0 0 0 2px ${QIZIL}`
            : toliq
              ? `inset 0 0 0 2px ${opt.xavf ? QIZIL : KO_K}`
              : `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
        }}
      />
    );
  };

  /** Yashil/qizil xabar bloki (Figma 3.10a · F). */
  const xabar = (
    tur: "ok" | "xato",
    matn: string,
    opt?: { id?: string; tag?: React.ReactNode },
  ) => (
    <div
      id={opt?.id}
      role={tur === "xato" ? "alert" : "status"}
      className="flex items-start gap-[10px] rounded-[11px] px-[14px] py-3"
      style={{ background: tur === "xato" ? XAVF_FON : YASHIL_FON }}
    >
      {tur === "xato" ? (
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
      <div className="min-w-0">
        <p
          className="text-[12px] font-medium leading-[17px]"
          style={{ color: tur === "xato" ? QIZIL : YASHIL_MATN }}
        >
          {matn}
        </p>
        {opt?.tag}
      </div>
    </div>
  );

  /** Lavanda ma'lumot paneli. */
  const malumot = (ikon: React.ReactNode, matn: React.ReactNode) => (
    <div
      className="flex items-start gap-[10px] rounded-xl px-4 py-3"
      style={{ background: AVATAR_FON }}
    >
      <span className="mt-[1px] shrink-0" style={{ color: OCH_KUL }}>
        {ikon}
      </span>
      <p className="text-[13px] leading-[19px]" style={{ color: KUL }}>
        {matn}
      </p>
    </div>
  );

  /** Raqamlangan qadam nishoni (Figma: 26×26 ko'k doira). */
  const qadam = (raqam: number, matn: string) => (
    <div className="flex items-center gap-[10px]">
      <span
        aria-hidden
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[12px] font-bold leading-none text-white"
        style={{ background: KO_K }}
      >
        {raqam}
      </span>
      <span className="text-[14px] font-semibold leading-5" style={{ color: IK }}>
        {matn}
      </span>
    </div>
  );

  const chiziq = <div className="h-px" style={{ background: HOSHIYA }} />;

  const kodXatoBloki =
    kodXato && xabar("xato", KOD_XABAR[kodXato], { id: "kod-xato" });

  return (
    <div className="flex max-w-[672px] flex-col gap-4">
      {/* ── Sarlavha kartasi (Figma: 83 px) ──────────────────────────── */}
      <div
        className="flex h-[83px] items-center gap-[14px] rounded-2xl bg-white px-5"
        style={karta}
      >
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-[31px]" style={{ color: IK }}>
            Xavfsizlik
          </h1>
          <p className="mt-[2px] text-[13px] leading-[18px]" style={{ color: OCH_KUL }}>
            Ikki bosqichli himoya (2FA)
          </p>
        </div>
        {/* Holat nishoni. Yuklanmaguncha chizilmaydi: avval "O'chirilgan"
            deb ko'rsatib keyin "Yoqilgan" ga o'tish — noto'g'ri xabar. */}
        {me && (
          <span
            className="ml-auto inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-full px-3"
            style={{ background: yoqilgan ? YASHIL_FON : NISHON_FON }}
          >
            <span
              aria-hidden
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: yoqilgan ? YASHIL : XIRA }}
            />
            <span
              className="whitespace-nowrap text-[13px] font-semibold leading-[18px]"
              style={{ color: yoqilgan ? YASHIL_MATN : OCH_KUL }}
            >
              {yoqilgan ? "Yoqilgan" : "O'chirilgan"}
            </span>
          </span>
        )}
      </div>

      {/* ── Asosiy karta ─────────────────────────────────────────────── */}
      <div
        className="ib-anim ib-anim-panel flex flex-col gap-[18px] rounded-2xl bg-white p-5"
        style={karta}
      >
        {/* Ikonka + tavsif */}
        <div className="flex items-start gap-[14px]">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
            style={{ background: AVATAR_FON, color: KO_K }}
          >
            <ShieldCheck size={24} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold leading-6" style={{ color: IK }}>
              Autentifikator ilovasi
            </h2>
            <p className="mt-[3px] text-[13px] leading-[19px]" style={{ color: KUL }}>
              {holat === "yoqilgan"
                ? "2FA yoqilgan — har kirishda ilovadagi 6 xonali kod so'raladi."
                : "Google Authenticator, Authy yoki shunga o'xshash ilova bilan hisobingizni himoyalang. Yoqilgach, har kirishda 6 xonali kod so'raladi."}
            </p>
          </div>
        </div>

        {chiziq}

        {/* Natija xabari — amaldan keyin karta boshida turadi
            (Figma 3.10c · 6-qadam). */}
        {ok && xabar("ok", ok)}
        {serverXato &&
          xabar("xato", serverXato, {
            tag: qaytaAmal ? (
              <button
                type="button"
                onClick={qaytaUrin}
                disabled={!!band}
                className={`mt-[10px] inline-flex h-[38px] select-none items-center gap-[7px] rounded-[10px] bg-white px-[13px] text-[13px] font-semibold leading-[18px] transition-colors hover:bg-[#f4f6fc] disabled:cursor-not-allowed ${FOKUS}`}
                style={{
                  color: KUL,
                  boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                }}
              >
                <RotateCw size={14} aria-hidden />
                Qayta urinish
              </button>
            ) : undefined,
          })}

        {holat === "yuklanmoqda" && !yuklashXato && (
          <div className="flex flex-col gap-3" aria-hidden>
            <div className="h-12 w-[160px] animate-pulse rounded-[10px] bg-[#eef1f7]" />
            <div className="h-[17px] w-[380px] max-w-full animate-pulse rounded bg-[#f2f4f9]" />
          </div>
        )}

        {!me && yuklashXato && xabar("xato", yuklashXato)}

        {/* ── 1-holat: yoqilmagan ─────────────────────────────────── */}
        {holat === "yopiq" && (
          <div className="flex flex-col gap-[10px]">
            <button
              type="button"
              onClick={boshlash}
              disabled={!!band}
              className={`inline-flex h-12 w-fit select-none items-center gap-[9px] rounded-[10px] px-[22px] text-[15px] font-semibold leading-5 text-white transition-[filter] disabled:cursor-not-allowed ${
                band ? "" : "hover:brightness-95"
              } ${FOKUS}`}
              style={{ background: band ? KO_K_XIRA : KO_K }}
            >
              {band === "boshlash" ? (
                <Loader2 size={17} aria-hidden className="animate-spin" />
              ) : (
                <KeyRound size={17} aria-hidden />
              )}
              {band === "boshlash" ? "Tayyorlanmoqda…" : "2FA yoqish"}
            </button>
            <p className="text-[12px] leading-[17px]" style={{ color: XIRA_QUYUQ }}>
              Bosilgach, ekranda QR kod va maxfiy kalit paydo bo&apos;ladi.
            </p>
          </div>
        )}

        {/* ── 2-holat: sozlash oqimi ──────────────────────────────── */}
        {holat === "sozlash" && sozlash && (
          <>
            {qadam(1, "Autentifikator ilovangizda QR kodni skanerlang")}

            {/* QR — HAR DOIM oq fonda: qorong'i fon skanerlashni buzadi. */}
            <div
              className="grid h-[208px] w-[208px] place-items-center rounded-xl bg-white"
              style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA_OCH}` }}
            >
              <QRCodeSVG
                value={sozlash.uri}
                size={176}
                level="M"
                marginSize={0}
                aria-label="2FA sozlash uchun QR kod"
              />
            </div>

            <p className="text-[13px] leading-[19px]" style={{ color: KUL }}>
              QR ishlamasa — ilovada «Kalit kiritish» (setup key) orqali
              quyidagi maxfiy kalitni qo&apos;lda qo&apos;shing:
            </p>

            {/* Maxfiy kalit yo'lagi (Figma: 56 px) */}
            <div className="flex flex-col gap-[6px]">
              <div
                className="flex min-h-[56px] items-center gap-3 rounded-xl px-[14px] py-[10px]"
                style={{ background: AVATAR_FON }}
              >
                <code
                  ref={kalitRef}
                  className="min-w-0 flex-1 select-all break-all font-mono text-[14px] font-medium leading-5"
                  style={{ color: IK }}
                >
                  {kalitniBezash(sozlash.secret)}
                </code>
                <button
                  type="button"
                  onClick={nusxala}
                  className={`inline-flex h-8 shrink-0 select-none items-center gap-[6px] rounded-lg bg-white px-[11px] text-[12px] font-semibold leading-[17px] transition-colors hover:bg-[#f4f6fc] ${FOKUS}`}
                  style={{
                    color: nusxalandi ? YASHIL_MATN : KUL,
                    boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                  }}
                >
                  {nusxalandi ? (
                    <CircleCheck size={13} aria-hidden />
                  ) : (
                    <Copy size={13} aria-hidden />
                  )}
                  {nusxalandi ? "Nusxalandi" : "Nusxalash"}
                </button>
              </div>
              <p className="text-[12px] leading-[17px]" style={{ color: XIRA_QUYUQ }}>
                Kalit monospace shriftda; bir bosishda to&apos;liq belgilanadi.
              </p>
            </div>

            {chiziq}

            {qadam(2, "Ilova ko'rsatgan 6 xonali kodni kiriting")}

            <div className="flex flex-wrap items-center gap-3">
              {kodMaydoni({})}
              <button
                type="button"
                onClick={tasdiqla}
                disabled={!toliq || !!band}
                className={`inline-flex h-12 shrink-0 select-none items-center gap-[9px] rounded-[10px] px-[22px] text-[15px] font-semibold leading-5 transition-[filter] ${
                  !toliq || band ? "cursor-not-allowed" : "hover:brightness-95"
                } ${FOKUS}`}
                style={
                  band === "tasdiq"
                    ? { background: KO_K_XIRA, color: "#ffffff" }
                    : !toliq || band
                      ? { background: NISHON_FON, color: XIRA }
                      : { background: KO_K, color: "#ffffff" }
                }
              >
                {band === "tasdiq" && (
                  <Loader2 size={17} aria-hidden className="animate-spin" />
                )}
                {band === "tasdiq" ? "Tasdiqlanmoqda…" : "Tasdiqlash"}
              </button>
              <button
                type="button"
                onClick={bekor}
                disabled={!!band}
                className={`inline-flex h-12 shrink-0 select-none items-center rounded-[10px] bg-white px-[22px] text-[15px] font-semibold leading-5 transition-colors hover:bg-[#f4f6fc] disabled:cursor-not-allowed ${FOKUS}`}
                style={{
                  color: KUL,
                  boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
                }}
              >
                Bekor
              </button>
            </div>

            {kodXatoBloki}
          </>
        )}

        {/* ── 3-holat: yoqilgan ───────────────────────────────────── */}
        {holat === "yoqilgan" && (
          <>
            <div className="flex flex-col gap-[10px]">
              <label
                htmlFor="ochirish-kod"
                className="text-[14px] font-semibold leading-5"
                style={{ color: IK }}
              >
                O&apos;chirish uchun joriy 6 xonali kodni kiriting:
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {kodMaydoni({ id: "ochirish-kod", xavf: true })}
                <button
                  type="button"
                  onClick={() => setTasdiqOyna(true)}
                  disabled={!toliq || !!band}
                  className={`inline-flex h-12 shrink-0 select-none items-center gap-[9px] rounded-[10px] px-5 text-[15px] font-semibold leading-5 transition-[filter] ${
                    !toliq || band ? "cursor-not-allowed" : "hover:brightness-95"
                  } ${FOKUS}`}
                  style={
                    band === "ochirish"
                      ? { background: QIZIL_XIRA, color: "#ffffff" }
                      : !toliq || band
                        ? { background: NISHON_FON, color: XIRA }
                        : { background: QIZIL, color: "#ffffff" }
                  }
                >
                  {band === "ochirish" ? (
                    <Loader2 size={17} aria-hidden className="animate-spin" />
                  ) : (
                    toliq && <ShieldOff size={17} aria-hidden />
                  )}
                  {band === "ochirish" ? "O'chirilmoqda…" : "2FA o'chirish"}
                </button>
              </div>
              {/* Hisoblagich Figma 3.10c · 2–3-qadamdan: nechta xona
                  kiritilgani va kod 30 soniyada yangilanishi. */}
              <p
                className="text-[12px] leading-[17px]"
                style={{ color: XIRA_QUYUQ }}
                aria-live="polite"
              >
                {kod.length === 0
                  ? "Kod to'liq 6 xonali bo'lmaguncha «2FA o'chirish» tugmasi o'chiq turadi."
                  : toliq
                    ? "6 / 6 xona · kod ilovada 30 soniyada yangilanadi"
                    : `${kod.length} / 6 xona kiritildi`}
              </p>
            </div>

            {kodXatoBloki}

            {malumot(
              <Smartphone size={16} aria-hidden />,
              <>
                Qurilmani yo&apos;qotsangiz — superadmin sizning
                2FA&apos;ingizni «Adminlar» bo&apos;limidan qayta tiklashi
                mumkin.
              </>,
            )}
          </>
        )}
      </div>

      {/* ── Karta ostidagi ma'lumot paneli (Figma 1-holat) ───────────── */}
      {holat === "yopiq" &&
        malumot(
          <Info size={16} aria-hidden />,
          <>
            Har bir admin faqat o&apos;zining ikki bosqichli himoyasini
            boshqaradi. Boshqa adminning 2FA&apos;sini bu yerdan
            o&apos;zgartirib bo&apos;lmaydi.
          </>,
        )}

      {/* ── Tasdiq oynasi (Figma 3.10c · 4-qadam) ───────────────────── */}
      <AdminOynaQobiq
        open={tasdiqOyna}
        onClose={() => setTasdiqOyna(false)}
        title="2FA o'chirilsinmi?"
        maxWidth="max-w-[420px]"
      >
        <div className="p-5">
          <div className="flex items-start gap-[14px]">
            <span
              aria-hidden
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: ORANJ_FON, color: ORANJ }}
            >
              <TriangleAlert size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold leading-6" style={{ color: IK }}>
                2FA o&apos;chirilsinmi?
              </h2>
              <p className="mt-[6px] text-[13px] leading-[19px]" style={{ color: KUL }}>
                O&apos;chirilgach hisobingiz faqat parol bilan himoyalanadi.
                Istalgan vaqtda qaytadan yoqishingiz mumkin.
              </p>
            </div>
          </div>
          <div className="mt-[18px] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setTasdiqOyna(false)}
              className={`inline-flex h-[38px] select-none items-center rounded-[10px] bg-white px-[15px] text-[13px] font-semibold leading-[18px] transition-colors hover:bg-[#f4f6fc] ${FOKUS}`}
              style={{
                color: KUL,
                boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
              }}
            >
              Bekor
            </button>
            <button
              type="button"
              onClick={ochir}
              disabled={!toliq || !!band}
              className={`inline-flex h-[38px] select-none items-center rounded-[10px] px-[15px] text-[13px] font-semibold leading-[18px] text-white transition-[filter] ${
                !toliq || band ? "cursor-not-allowed" : "hover:brightness-95"
              } ${FOKUS}`}
              style={{ background: !toliq || band ? QIZIL_XIRA : QIZIL }}
            >
              Ha, o&apos;chirish
            </button>
          </div>
        </div>
      </AdminOynaQobiq>
    </div>
  );
}
