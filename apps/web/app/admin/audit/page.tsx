"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, AdminAudit, Admin, Category, Paged } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

// Har bir amal kodi uchun o'qiladigan yorliq va nishon turi.
const ACTION_META: Record<string, { label: string; kind: "category" | "admin" | "user" | "elon" | "review" | "text" | "none" }> = {
  login_success: { label: "Tizimga kirdi", kind: "text" },
  login_failed: { label: "Kirish urinishi (muvaffaqiyatsiz)", kind: "text" },
  logout: { label: "Tizimdan chiqdi", kind: "text" },
  broadcast: { label: "Tarqatma yubordi", kind: "text" },
  broadcast_schedule: { label: "Tarqatma rejalashtirdi", kind: "text" },
  broadcast_cancel: { label: "Tarqatmani bekor qildi", kind: "text" },
  category_create: { label: "Turkum qo'shdi", kind: "category" },
  category_update: { label: "Turkumni tahrirladi", kind: "category" },
  category_delete: { label: "Turkumni o'chirdi", kind: "category" },
  category_active: { label: "Turkum holatini o'zgartirdi", kind: "category" },
  admin_create: { label: "Yangi admin qo'shdi", kind: "admin" },
  admin_update: { label: "Adminni tahrirladi", kind: "admin" },
  admin_delete: { label: "Adminni o'chirdi", kind: "admin" },
  "2fa_enable": { label: "2FA'ni yoqdi", kind: "none" },
  "2fa_disable": { label: "2FA'ni o'chirdi", kind: "none" },
  user_block: { label: "Foydalanuvchini blokladi", kind: "user" },
  user_delete: { label: "Foydalanuvchini o'chirdi", kind: "user" },
  user_notify: { label: "Foydalanuvchiga xabar yubordi", kind: "user" },
  user_verify: { label: "Foydalanuvchini tasdiqladi", kind: "user" },
  elon_delete: { label: "E'lonni o'chirdi", kind: "elon" },
  elon_status: { label: "E'lon holatini o'zgartirdi", kind: "elon" },
  export_users: { label: "Foydalanuvchilarni CSV eksport qildi", kind: "none" },
  export_elons: { label: "E'lonlarni CSV eksport qildi", kind: "none" },
  export_applications: { label: "Arizalarni CSV eksport qildi", kind: "none" },
};
const KIND_PREFIX: Record<string, string> = { user: "Foydalanuvchi", elon: "E'lon", review: "Sharh", category: "Turkum", admin: "Admin" };
const isObjectId = (s: string) => /^[a-f0-9]{24}$/i.test(s);

export default function AdminAuditPage() {
  const [data, setData] = useState<Paged<AdminAudit> | null>(null);
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [admMap, setAdmMap] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const limit = 30;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (action.trim()) params.set("action", action.trim());
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to + "T23:59:59").toISOString());
    setData(await api.get<Paged<AdminAudit>>(`/api/admin/audit?${params}`, { auth: "admin" } as any));
  }, [page, action, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [action, from, to]);
  useEffect(() => {
    api.get<Category[]>("/api/admin/categories", { auth: "admin" } as any)
      .then((cs) => setCatMap(Object.fromEntries(cs.map((c) => [c.id, c.name])))).catch(() => {});
    api.get<Admin[]>("/api/admin/admins", { auth: "admin" } as any)
      .then((as) => setAdmMap(Object.fromEntries(as.map((a) => [a.id, a.name || a.username])))).catch(() => {});
  }, []);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];

  function actionLabel(code: string) { return ACTION_META[code]?.label || code; }

  function resolveTarget(a: AdminAudit): string {
    const t = (a.target || "").trim();
    const meta = ACTION_META[a.action];
    if (!t) return "—";
    if (meta?.kind === "text") return t; // username / sarlavha — allaqachon o'qiladigan
    if (isObjectId(t)) {
      if (catMap[t]) return catMap[t];
      if (admMap[t]) return admMap[t];
      const pref = meta ? KIND_PREFIX[meta.kind] : "";
      return pref ? `${pref} · …${t.slice(-6)}` : `…${t.slice(-6)}`;
    }
    return t;
  }

  const actionOptions = useMemo(() => Object.entries(ACTION_META).map(([code, m]) => ({ code, label: m.label })), []);

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Audit log</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Adminlar amallari tarixi · jami {total} ta yozuv</p>
        </div>
      </div>

      {/* Filtr + jadval */}
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap gap-2 items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <select className="input max-w-[240px]" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Amal (barchasi)</option>
            {actionOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
          <label className="text-sm flex items-center gap-1.5 text-[color:var(--text-muted)]">Dan <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm flex items-center gap-1.5 text-[color:var(--text-muted)]">Gacha <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="text-sm text-[color:var(--text-muted)] ml-auto">Jami: {total}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "17%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "21%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Vaqt</th><th className="px-4">Admin</th><th className="px-4">Amal</th><th className="px-4">Maqsad</th><th className="px-4">Tafsilot</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 whitespace-nowrap text-[color:var(--text-muted)]">{new Date(a.createdAt).toLocaleString("uz-UZ")}</td>
                  <td className="px-4 font-medium truncate">{a.adminName || (a.adminId && a.adminId !== "000000000000000000000000" ? `…${a.adminId.slice(-6)}` : "—")}</td>
                  <td className="px-4 truncate" title={a.action}>{actionLabel(a.action)}</td>
                  <td className="px-4 truncate">{resolveTarget(a)}</td>
                  <td className="px-4 truncate text-[color:var(--text-muted)]" title={a.detail || ""}>{a.detail || "—"}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={5} className="py-8 text-center text-[color:var(--text-muted)]">Yozuv topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>
    </div>
  );
}
