"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, KeyRound, Check, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, Admin } from "@/lib/api";

export default function AdminSecurity() {
  const [me, setMe] = useState<Admin | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function loadMe() { setMe(await api.get<Admin>("/api/admin/me", { auth: "admin" } as any)); }
  useEffect(() => { loadMe(); }, []);

  async function startSetup() {
    setErr(""); setOk("");
    try {
      setSetup(await api.post<{ secret: string; uri: string }>("/api/admin/2fa/setup", {}, { auth: "admin" } as any));
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function enable() {
    setErr(""); setOk("");
    try {
      await api.post("/api/admin/2fa/enable", { code }, { auth: "admin" } as any);
      setSetup(null); setCode(""); setOk("2FA yoqildi.");
      loadMe();
    } catch (e: any) { setErr(e?.code === "bad_totp" ? "Kod noto'g'ri." : (e?.message || "Xatolik")); }
  }
  async function disable() {
    setErr(""); setOk("");
    try {
      await api.post("/api/admin/2fa/disable", { code }, { auth: "admin" } as any);
      setCode(""); setOk("2FA o'chirildi.");
      loadMe();
    } catch (e: any) { setErr(e?.code === "bad_totp" ? "Kod noto'g'ri." : (e?.message || "Xatolik")); }
  }

  const codeInput = (
    <input
      className="input tracking-[0.4em] text-center text-lg font-semibold max-w-[170px]"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      inputMode="numeric"
    />
  );

  const enabled = !!me?.totpEnabled;

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Xavfsizlik</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Ikki bosqichli himoya (2FA)</p>
        </div>
        {me && (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border"
            style={enabled
              ? { color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }
              : { color: "var(--text-muted)", borderColor: "var(--border)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: enabled ? "var(--success, #16a34a)" : "var(--text-muted)" }} />
            {enabled ? "Yoqilgan" : "O'chirilgan"}
          </span>
        )}
      </div>

      {/* Asosiy kartochka */}
      <div className="card p-5 flex flex-col gap-4">
        {/* Sarlavha + tavsif */}
        <div className="flex gap-3 items-start">
          <div className="shrink-0 grid h-11 w-11 place-items-center rounded-xl" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="font-semibold heading">Autentifikator ilovasi</div>
            <p className="text-sm text-[color:var(--text-muted)] mt-0.5">
              Google Authenticator, Authy yoki shunga o'xshash ilova bilan hisobingizni himoyalang.
              Yoqilgach, har kirishda 6 xonali kod so'raladi.
            </p>
          </div>
        </div>

        {/* Bildirishnomalar */}
        {ok && (
          <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--success, #16a34a) 12%, transparent)", color: "var(--success, #16a34a)" }}>
            <Check size={16} /> {ok}
          </div>
        )}
        {err && (
          <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--danger, #dc2626) 12%, transparent)", color: "var(--danger, #dc2626)" }}>
            <AlertCircle size={16} /> {err}
          </div>
        )}

        {/* Yoqilmagan — boshlash */}
        {me && !enabled && !setup && (
          <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <button onClick={startSetup} className="btn-primary w-fit gap-2"><KeyRound size={16} /> 2FA yoqish</button>
          </div>
        )}

        {/* Yoqilmagan — sozlash oqimi */}
        {me && !enabled && setup && (
          <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <div className="text-sm">
              <span className="inline-grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold mr-1.5 align-middle" style={{ background: "var(--brand)", color: "#fff" }}>1</span>
              Autentifikator ilovangizda <b>QR kodni skanerlang</b>:
            </div>
            {/* QR kod — oq fonli qutida (qorong'i rejimda ham skanerlanadi) */}
            <div className="self-start rounded-xl p-3 bg-white" style={{ border: "1px solid var(--border)" }}>
              <QRCodeSVG value={setup.uri} size={176} level="M" marginSize={0} />
            </div>
            <div className="text-sm text-[color:var(--text-muted)]">
              QR ishlamasa — ilovada <b>&quot;Kalit kiritish&quot;</b> (setup key) orqali quyidagi maxfiy kalitni qo'lda qo'shing:
            </div>
            <code className="block break-all rounded-lg p-3 text-sm font-mono select-all" style={{ background: "var(--surface, rgba(0,0,0,0.04))", border: "1px solid var(--border)" }}>{setup.secret}</code>
            <div className="text-sm mt-1">
              <span className="inline-grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold mr-1.5 align-middle" style={{ background: "var(--brand)", color: "#fff" }}>2</span>
              Ilova ko'rsatgan 6 xonali kodni kiriting:
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {codeInput}
              <button onClick={enable} className="btn-primary" disabled={code.length !== 6}>Tasdiqlash</button>
              <button onClick={() => { setSetup(null); setCode(""); }} className="btn-secondary btn-sm">Bekor</button>
            </div>
          </div>
        )}

        {/* Yoqilgan — o'chirish */}
        {me && enabled && (
          <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <div className="text-sm">O'chirish uchun joriy 6 xonali kodni kiriting:</div>
            <div className="flex flex-wrap gap-2 items-center">
              {codeInput}
              <button onClick={disable} className="btn-danger" disabled={code.length !== 6}>2FA o'chirish</button>
            </div>
            <p className="text-xs text-[color:var(--text-muted)]">
              Qurilmani yo'qotsangiz — superadmin sizning 2FA'ingizni &quot;Adminlar&quot; bo'limidan qayta tiklashi mumkin.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
