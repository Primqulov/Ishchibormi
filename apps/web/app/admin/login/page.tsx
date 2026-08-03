"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setAdminToken } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const body: any = { username: u, password: p };
      if (needCode) body.code = code;
      const r = await api.post<{ accessToken: string }>("/api/admin/login", body, { auth: "none" });
      setAdminToken(r.accessToken);
      router.replace("/admin");
    } catch (e: any) {
      if (e?.code === "totp_required") {
        setNeedCode(true);
        setErr("2FA kodini kiriting (autentifikator ilovangizdan).");
        return;
      }
      if (e?.code === "bad_totp") {
        setNeedCode(true);
        setErr("2FA kod noto'g'ri. Qayta urinib ko'ring.");
        return;
      }
      setErr(e?.message || "Xatolik");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 grid gap-3">
        <h1 className="text-xl font-bold heading">Admin kirish</h1>
        <input className="input" value={u} onChange={(e) => setU(e.target.value)} placeholder="username" required disabled={needCode} />
        <input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="parol" required disabled={needCode} />
        {needCode && (
          <input
            className="input tracking-[0.4em] text-center text-lg"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoFocus
          />
        )}
        {err && <div className={`text-sm ${needCode ? "text-[color:var(--text-muted)]" : "text-danger"}`}>{err}</div>}
        <button className="btn-primary">{needCode ? "Tasdiqlash" : "Kirish"}</button>
        {needCode && (
          <button type="button" onClick={() => { setNeedCode(false); setCode(""); setErr(""); }} className="btn-secondary btn-sm">
            ← Orqaga
          </button>
        )}
      </form>
    </div>
  );
}
