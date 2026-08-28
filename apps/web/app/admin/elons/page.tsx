"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { api, Elon, Category, Paged, downloadAdminCsv, getAdminRole, APIError } from "@/lib/api";
import { DeleteModeModal, DeleteMode } from "@/components/admin/DeleteModeModal";
import { Pagination } from "@/components/Pagination";

const STATUS_META: Record<string, { label: string; color: string }> = {
  recruiting: { label: "yig'ilmoqda", color: "var(--success, #16a34a)" },
  filled: { label: "to'ldi", color: "var(--brand, #6366f1)" },
  in_progress: { label: "jarayonda", color: "var(--warning, #d97706)" },
  completed: { label: "yakunlandi", color: "var(--text-muted)" },
  cancelled: { label: "bekor qilingan", color: "var(--danger, #dc2626)" },
  hidden: { label: "yashirilgan", color: "var(--text-muted)" },
};
const STATUSES = Object.keys(STATUS_META);

export default function AdminElons() {
  const [data, setData] = useState<Paged<Elon> | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [region, setRegion] = useState("");
  const [delId, setDelId] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  // "O'chirilgan" filtri: bo'sh = hammasi (standart), chunki olib tashlangan
  // e'lon admin panelida ko'rinib turishi kerak.
  const [deleted, setDeleted] = useState("");
  // Bazadan butunlay o'chirish faqat superadminga ko'rsatiladi. Server
  // tomonida ham alohida tekshiriladi — bu faqat interfeys.
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => { setIsSuper(getAdminRole() === "superadmin"); }, []);
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (region.trim()) params.set("region", region.trim());
    if (deleted) params.set("deleted", deleted);
    setData(await api.get<Paged<Elon>>(`/api/admin/elons?${params}`, { auth: "admin" } as any));
  }, [page, q, status, categoryId, region, deleted]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status, categoryId, region, deleted]);
  useEffect(() => { api.get<Category[]>("/api/admin/categories", { auth: "admin" } as any).then(setCats).catch(() => {}); }, []);

  async function setStatusOf(id: string, s: string) {
    await api.patch(`/api/admin/elons/${id}/status`, { status: s }, { auth: "admin" } as any);
    load();
  }
  async function del(mode: DeleteMode) {
    setDelBusy(true); setDelErr("");
    try {
      await api.delete(`/api/admin/elons/${delId}?mode=${mode}`, { auth: "admin" } as any);
      setDelId("");
      load();
    } catch (e) {
      setDelErr((e as APIError)?.message || "O'chirib bo'lmadi");
    } finally { setDelBusy(false); }
  }
  function exportCsv() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (region.trim()) params.set("region", region.trim());
    downloadAdminCsv("/api/admin/export/elons.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const elons = data?.items ?? [];

  function statusBadge(s: string) {
    const m = STATUS_META[s] ?? { label: s, color: "var(--text-muted)" };
    return (
      <span className="inline-flex justify-center items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
        style={{ color: m.color, borderColor: m.color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />{m.label}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">E'lonlar</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Jami {total} ta e'lon</p>
        </div>
        <button onClick={exportCsv} className="btn-secondary btn-sm gap-1.5"><Download size={15} /> CSV yuklab olish</button>
      </div>

      {/* Filtrlar + jadval */}
      <div className="card p-0 overflow-hidden">
        {/* Filtr paneli */}
        <div className="flex flex-wrap gap-2 items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="relative flex-1 min-w-[180px] max-w-[260px]">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input className="input pl-8 w-full" placeholder="Sarlavha bo'yicha qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input max-w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Holat (barchasi)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select className="input max-w-[180px]" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Turkum (barchasi)</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input max-w-[150px]" placeholder="Viloyat" value={region} onChange={(e) => setRegion(e.target.value)} />
          <select className="input max-w-[190px]" value={deleted} onChange={(e) => setDeleted(e.target.value)}>
            <option value="">O'chirilganlar bilan</option>
            <option value="hide">Faqat faollari</option>
            <option value="only">Faqat o'chirilganlari</option>
          </select>
        </div>

        {/* Jadval */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "27%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Sarlavha</th><th className="px-4">Turkum</th><th className="px-4">Holat</th><th className="px-4">Ishchilar</th><th className="px-4">Narx</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {elons.map((e) => (
                <tr key={e.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 font-medium truncate">
                    {e.title}
                    {e.isDeleted && (
                      <span className="ml-2 align-middle text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
                        style={{ color: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)" }}>
                        o&apos;chirilgan
                      </span>
                    )}
                  </td>
                  <td className="px-4 truncate">{e.categoryName}</td>
                  <td className="px-4">{statusBadge(e.status)}</td>
                  <td className="px-4">{e.workersNeeded}</td>
                  <td className="px-4 whitespace-nowrap">{e.priceAmount.toLocaleString("uz-UZ")} so'm</td>
                  <td className="px-4">
                    <div className="flex gap-2 justify-end">
                      {/* O'chirilgan e'lon uchun "Yashirish/Tiklash" ma'nosini
                          yo'qotadi — u allaqachon foydalanuvchilarga
                          ko'rinmaydi va qaytarilmaydi. Faqat superadmin uni
                          bazadan butunlay o'chira oladi. */}
                      {!e.isDeleted && (e.status === "hidden"
                        ? <button onClick={() => setStatusOf(e.id, "recruiting")} className="btn-secondary btn-sm">Tiklash</button>
                        : <button onClick={() => setStatusOf(e.id, "hidden")} className="btn-secondary btn-sm">Yashirish</button>)}
                      {(!e.isDeleted || isSuper) && (
                        <button onClick={() => { setDelErr(""); setDelId(e.id); }} className="btn-danger btn-sm">
                          {e.isDeleted ? "Bazadan o'chirish" : "O'chirish"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!elons.length && <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Hech narsa topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>

      <DeleteModeModal
        open={!!delId}
        title="E'lonni o'chirish"
        what="e'lon"
        canPurge={isSuper}
        busy={delBusy}
        error={delErr}
        onCancel={() => setDelId("")}
        onConfirm={del}
      />
    </div>
  );
}
