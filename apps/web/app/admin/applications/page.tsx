"use client";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, Application, AdminStats, Paged, downloadAdminCsv } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

const STATUSES = ["pending", "accepted", "rejected", "cancelled", "completed"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Kutilmoqda", accepted: "Qabul qilingan", rejected: "Rad etilgan",
  cancelled: "Bekor qilingan", completed: "Bajarilgan",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "var(--warning, #d97706)",
  accepted: "var(--success, #16a34a)",
  rejected: "var(--danger, #dc2626)",
  cancelled: "var(--text-muted)",
  completed: "var(--brand, #6366f1)",
};

export default function AdminApplications() {
  const [data, setData] = useState<Paged<Application> | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [stale, setStale] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set("status", status);
    if (stale) params.set("stale", "1");
    setData(await api.get<Paged<Application>>(`/api/admin/applications?${params}`, { auth: "admin" } as any));
  }, [page, status, stale]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, stale]);
  useEffect(() => {
    api.get<AdminStats>("/api/admin/stats", { auth: "admin" } as any).then((s) => setFunnel(s.funnel || {})).catch(() => {});
  }, []);

  function exportCsv() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (stale) params.set("stale", "1");
    downloadAdminCsv("/api/admin/export/applications.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];
  const sum = STATUSES.reduce((a, s) => a + (funnel[s] || 0), 0);

  function statusBadge(s: string) {
    const color = STATUS_COLOR[s] ?? "var(--text-muted)";
    return (
      <span className="inline-flex justify-center items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
        style={{ color, borderColor: color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{STATUS_LABEL[s] || s}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Arizalar</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Jami {total} ta ariza</p>
        </div>
        <button onClick={exportCsv} className="btn-secondary btn-sm gap-1.5"><Download size={15} /> CSV yuklab olish</button>
      </div>

      {/* Voronka (statistika kartochkalari) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATUSES.map((s) => {
          const active = status === s;
          const color = STATUS_COLOR[s];
          return (
            <button
              key={s}
              onClick={() => setStatus(active ? "" : s)}
              className="card p-4 text-left transition hover:shadow-md"
              style={active ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="text-xs text-[color:var(--text-muted)] truncate">{STATUS_LABEL[s]}</span>
              </div>
              <div className="text-2xl font-bold mt-2 heading">{funnel[s] ?? 0}</div>
              <div className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{sum ? Math.round(((funnel[s] || 0) / sum) * 100) : 0}%</div>
            </button>
          );
        })}
      </div>

      {/* Filtrlar + jadval */}
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap gap-3 items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <select className="input max-w-[190px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Holat (barchasi)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer" style={{ borderColor: "var(--border)" }}>
            <input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} /> Uzoq kutayotgan <span className="text-[color:var(--text-muted)]">(3+ kun)</span>
          </label>
          <div className="ml-auto text-sm text-[color:var(--text-muted)]">Jami: {total}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">E'lon</th><th className="px-4">Ishchi</th><th className="px-4">Summa</th><th className="px-4">Holat</th><th className="px-4">Yuborilgan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 font-medium truncate">{a.elonTitle}</td>
                  <td className="px-4 whitespace-nowrap truncate">{a.workerName || a.workerPhone}</td>
                  <td className="px-4 whitespace-nowrap">{a.isNegotiable ? "kelishuv" : `${a.amount.toLocaleString("uz-UZ")} so'm`}</td>
                  <td className="px-4">{statusBadge(a.status)}</td>
                  <td className="px-4 whitespace-nowrap">{new Date(a.appliedAt).toLocaleDateString("uz-UZ")}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={5} className="py-8 text-center text-[color:var(--text-muted)]">Ariza topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>
    </div>
  );
}
