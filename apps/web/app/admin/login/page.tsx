"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Eye, EyeOff, Info, ShieldCheck } from "lucide-react";
import { api, setAdminToken } from "@/lib/api";

// Dizayn: Figma "Admin panel web" — 3.1 · Kirish sahifasi (karta o'lchamlari)
// va 3.1a · Kirish sahifasi — barcha holatlar (oltita holat). Ranglar shu
// sahifa uchun ataylab qo'lda yozilgan: panelning qolgan qismi mavzu
// o'zgaruvchilaridan (--brand #0038d8) foydalanadi, kirish sahifasi esa
// Figma'dagi admin palitrasida (#004ac6) chizilgan.

// Figma'da barcha ramkalar "inside" chiziladi: 1 px chegara qutining ichida
// turadi va o'lchamga qo'shilmaydi. CSS `border` esa border-box ichidan joy
// yeydi — 348 px kenglik 346 ga tushardi. Shuning uchun ramkalar `inset`
// soya bilan chiziladi: o'lcham ham, ichki bo'shliq ham Figma bilan bir xil.
const FIELD_BASE =
  "flex h-12 items-center rounded-xl px-[14px] transition-shadow duration-150";
const FIELD_IDLE =
  "bg-white shadow-[inset_0_0_0_1px_#c3c6d7] focus-within:shadow-[inset_0_0_0_2px_#004ac6,0_0_0_3px_rgba(0,74,198,0.16)]";
const FIELD_OFF = "bg-[#f4f6fc] opacity-70 shadow-[inset_0_0_0_1px_#c3c6d7]";

// Xabar qutisining ikki ohangi (3.1a): qizil — foydalanuvchi tuzatishi kerak
// bo'lgan xato; kulrang — bu xato emas, kirishning ikkinchi qadami.
type Ohang = "xato" | "malumot";
type Xabar = { matn: string; ohang: Ohang };

// Backendning biznes xatolari inglizcha keladi va shundayligicha qoladi: bir xil
// API'dan mobil ilova ham, botlar ham foydalanadi. lib/api.ts dagi qoida ham
// shuni aytadi — kod barqaror, matnni forma o'zi tanlaydi. Shu sababli
// foydalanuvchi ko'radigan o'zbekcha matn shu yerda turadi.
const XATO_MATNI: Record<string, string> = {
  // 3-holat. 10 urinish / 15 daqiqa chegarasi — apps/api loginguard.go.
  bad_credentials: "Login yoki parol noto'g'ri.",
  rate_limited: "Juda ko'p urinish qilindi. 15 daqiqadan so'ng qayta urinib ko'ring.",
  // 5- va 6-holat: kulrang qutida chiqadi.
  totp_required: "2FA kodini kiriting (autentifikator ilovangizdan).",
  bad_totp: "2FA kod noto'g'ri. Qayta urinib ko'ring.",
  // So'rovning o'zi buzilgan holatlar — amalda faqat mijoz eskirganda uchraydi.
  invalid_json: "So'rov noto'g'ri yuborildi. Sahifani yangilab, qayta urinib ko'ring.",
  too_large: "So'rov hajmi juda katta.",
};

// lib/api.ts bu kodlarni o'zi o'zbekcha matn bilan yaratadi (tarmoq yo'q,
// server javob bermayapti, 5xx, noma'lum 4xx) — ularni takrorlamaymiz.
const MIJOZ_KODLARI = new Set(["offline", "server_unavailable", "server_error", "request_failed"]);

// Har qanday xatoni ekranga chiqadigan o'zbekcha xabarga aylantiradi. Oxirgi
// zaxira ham o'zbekcha: hech qachon inglizcha matn ko'rinmasligi kerak.
function xabarla(e: any): Xabar {
  const kod = typeof e?.code === "string" ? e.code : "";
  const ohang: Ohang = kod === "totp_required" || kod === "bad_totp" ? "malumot" : "xato";
  const matn =
    XATO_MATNI[kod] ??
    (MIJOZ_KODLARI.has(kod) && typeof e?.message === "string"
      ? e.message
      : "Kirishda kutilmagan xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.");
  return { matn, ohang };
}

export default function AdminLogin() {
  const router = useRouter();
  // Bo'sh: oldindan yozilgan "admin" haqiqiy foydalanuvchi nomi emas edi va
  // har kirishda o'chirishga to'g'ri kelardi.
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [msg, setMsg] = useState<Xabar | null>(null);
  // Kod maydoni qizaradimi. 5-holat (kod so'raldi) va 6-holat (kod noto'g'ri)
  // xabari bir xil kulrang qutida turadi — ularni faqat shu ramka ajratadi.
  const [codeErr, setCodeErr] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    // 4-holat: lib/api.ts 401 dan keyin shu manzilga otadi.
    if (new URLSearchParams(window.location.search).get("session") === "expired") {
      setMsg({ matn: "Admin sessiyasi eskirgan yoki token yaroqsiz. Qayta kiring.", ohang: "xato" });
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setCodeErr(false);
    try {
      const body: any = { username: u, password: p };
      if (needCode) body.code = code;
      const r = await api.post<{ accessToken: string }>("/api/admin/login", body, { auth: "none" });
      setAdminToken(r.accessToken);
      router.replace("/admin");
    } catch (e: any) {
      // 2FA qadamiga o'tish yoki unda qolish. Boshqa xatolar (masalan 2FA
      // paytida chiqqan `rate_limited`) qadamni o'zgartirmaydi va qizil
      // qutida chiqadi — kod maydoni esa bekordan qizarmaydi.
      if (e?.code === "totp_required") setNeedCode(true);
      if (e?.code === "bad_totp") {
        setNeedCode(true);
        setCodeErr(true);
      }
      setMsg(xabarla(e));
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f8f9ff] p-4">
      {/* Fon dog'lari — 3.1 sahifasidagi ikkita xira doira */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-[200px] h-[620px] w-[620px] rounded-full bg-[#004ac6]/10 blur-[90px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[276px] -right-[260px] h-[640px] w-[640px] rounded-full bg-[#ff9500]/[0.07] blur-[90px]"
      />

      <form
        onSubmit={submit}
        className="relative flex w-full max-w-[420px] flex-col gap-[18px] rounded-[22px] bg-white p-9 shadow-[inset_0_0_0_1px_#eaecf2,0_18px_44px_-8px_rgba(11,28,48,0.10),0_2px_8px_rgba(11,28,48,0.05)]"
      >
        {/* Brend */}
        <div className="flex flex-col items-center gap-[14px]">
          <div className="grid h-14 w-14 place-items-center rounded-[18px] bg-[#004ac6] shadow-[0_6px_16px_-2px_rgba(0,74,198,0.32)]">
            <ShieldCheck size={26} strokeWidth={2.1} className="text-white" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-center text-[24px] font-bold leading-[30px] text-[#0b1c30]">Admin kirish</h1>
            <p className="text-center text-[13px] leading-[18px] text-[#737686]">
              {needCode ? "Ikki bosqichli tasdiqlash" : "Boshqaruv paneliga kirish"}
            </p>
          </div>
        </div>

        {/* Login */}
        <div className="flex flex-col gap-[7px]">
          <label
            htmlFor="admin-username"
            className={`text-[12px] font-medium leading-4 ${needCode ? "text-[#9aa0b0]" : "text-[#434655]"}`}
          >
            Login
          </label>
          <div className={`${FIELD_BASE} ${needCode ? FIELD_OFF : FIELD_IDLE}`}>
            <input
              id="admin-username"
              className="min-w-0 flex-1 bg-transparent text-[14px] font-medium leading-5 text-[#0b1c30] outline-none placeholder:font-normal placeholder:text-[#9aa0b0] focus-visible:shadow-none disabled:cursor-not-allowed disabled:text-[#9aa0b0]"
              value={u}
              onChange={(e) => setU(e.target.value)}
              placeholder="username"
              autoComplete="username"
              required
              disabled={needCode}
            />
          </div>
        </div>

        {/* Parol */}
        <div className="flex flex-col gap-[7px]">
          <label
            htmlFor="admin-password"
            className={`text-[12px] font-medium leading-4 ${needCode ? "text-[#9aa0b0]" : "text-[#434655]"}`}
          >
            Parol
          </label>
          <div className={`${FIELD_BASE} ${needCode ? FIELD_OFF : FIELD_IDLE}`}>
            <input
              id="admin-password"
              className="min-w-0 flex-1 bg-transparent text-[14px] font-medium leading-5 text-[#0b1c30] outline-none placeholder:font-normal placeholder:text-[#9aa0b0] focus-visible:shadow-none disabled:cursor-not-allowed disabled:text-[#9aa0b0]"
              type={showPass ? "text" : "password"}
              value={p}
              onChange={(e) => setP(e.target.value)}
              placeholder="parol"
              autoComplete="current-password"
              required
              disabled={needCode}
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              disabled={needCode}
              aria-label={showPass ? "Parolni yashirish" : "Parolni ko'rsatish"}
              className="ml-2 shrink-0 text-[#9aa0b0] focus-visible:shadow-none disabled:cursor-not-allowed"
            >
              {showPass ? <Eye size={18} strokeWidth={2} /> : <EyeOff size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>

        {/* 2FA kodi — faqat ikkinchi qadamda */}
        {needCode && (
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="admin-totp" className="text-[12px] font-medium leading-4 text-[#434655]">
              Autentifikator kodi
            </label>
            {/* Bu maydon o'zi fokus ramkasini ko'rsatadi, shuning uchun
                globals.css'dagi umumiy :focus-visible halqasi (va uning 10 px
                radiusi) ustidan yozib qo'yiladi — aks holda ikkita halqa chiqadi. */}
            <input
              id="admin-totp"
              className={`h-[60px] w-full rounded-xl bg-white text-center indent-[11px] text-[22px] font-semibold leading-7 tracking-[11px] text-[#0b1c30] outline-none placeholder:text-[#c3c6d7] focus-visible:rounded-xl ${
                codeErr
                  ? "shadow-[inset_0_0_0_2px_#e5484d,0_0_0_3px_rgba(229,72,77,0.16)] focus-visible:shadow-[inset_0_0_0_2px_#e5484d,0_0_0_3px_rgba(229,72,77,0.16)]"
                  : "shadow-[inset_0_0_0_2px_#004ac6,0_0_0_3px_rgba(0,74,198,0.16)] focus-visible:shadow-[inset_0_0_0_2px_#004ac6,0_0_0_3px_rgba(0,74,198,0.16)]"
              }`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
          </div>
        )}

        {/* Xabar. Rang qadamga emas, xabarning ohangiga bog'liq: 2FA so'rovi
            kulrang (bu xato emas), qolgani qizil. Shu bois 2FA qadamida
            chiqqan haqiqiy xato ham qizil ko'rinadi. */}
        {msg && (
          <div
            role="alert"
            className={`flex items-start gap-[9px] rounded-[11px] px-3 py-[10px] ${
              msg.ohang === "malumot" ? "bg-[#737686]/[0.08]" : "bg-[#e5484d]/10"
            }`}
          >
            {msg.ohang === "malumot" ? (
              <Info size={16} strokeWidth={2} className="shrink-0 text-[#737686]" />
            ) : (
              <AlertCircle size={16} strokeWidth={2} className="shrink-0 text-[#e5484d]" />
            )}
            <p
              className={`text-[12px] font-medium leading-[17px] ${
                msg.ohang === "malumot" ? "text-[#5a5f73]" : "text-[#e5484d]"
              }`}
            >
              {msg.matn}
            </p>
          </div>
        )}

        <button className="h-[50px] w-full rounded-xl bg-[#004ac6] text-[15px] font-semibold leading-5 text-white shadow-[0_6px_16px_-4px_rgba(0,74,198,0.28)] transition-colors duration-150 hover:bg-[#003a9e]">
          {needCode ? "Tasdiqlash" : "Kirish"}
        </button>

        {needCode && (
          <button
            type="button"
            onClick={() => {
              setNeedCode(false);
              setCode("");
              setMsg(null);
              setCodeErr(false);
            }}
            className="flex h-[38px] w-full items-center justify-center gap-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-[#737686] transition-colors duration-150 hover:bg-[#f8f9ff]"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Orqaga
          </button>
        )}
      </form>
    </div>
  );
}
