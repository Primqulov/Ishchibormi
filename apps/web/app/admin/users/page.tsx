"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, User, Paged, downloadAdminCsv } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";

export default function AdminUsers() {
  const [data, setData] = useState<Paged<User> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [blocked, setBlocked] = useState("");
  const [verified, setVerified] = useState("");
  const [delId, setDelId] = useState("");
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    setData(await api.get<Paged<User>>(`/api/admin/users?${params}`, { auth: "admin" } as any));
  }, [page, q, region, blocked, verified]);

  useEffect(() => { load(); }, [load]);
  // Filtr o'zgarsa 1-sahifaga qaytamiz.
  useEffect(() => { setPage(1); }, [q, region, blocked, verified]);

  async function block(id: string, isBlocked: boolean) {
    await api.post(`/api/admin/users/${id}/block`, { isBlocked }, { auth: "admin" } as any);
    load();
  }
  async function del() {
    await api.delete(`/api/admin/users/${delId}`, { auth: "admin" } as any);
    setDelId("");
    load();
  }
  function exportCsv() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    downloadAdminCsv("/api/admin/export/users.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const users = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Foydalanuvchilar</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Jami {total} ta foydalanuvchi</p>
        </div>
        <button onClick={exportCsv} className="btn-secondary btn-sm gap-1.5">CSV yuklab olish</button>
      </div>

      {/* Filtr + jadval */}
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap gap-2 items-center px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <input className="input max-w-[220px]" placeholder="Ism yoki telefon…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="input max-w-[150px]" placeholder="Viloyat" value={region} onChange={(e) => setRegion(e.target.value)} />
          <select className="input max-w-[160px]" value={blocked} onChange={(e) => setBlocked(e.target.value)}>
            <option value="">Holat (barchasi)</option>
            <option value="0">Faol</option>
            <option value="1">Bloklangan</option>
          </select>
          <select className="input max-w-[170px]" value={verified} onChange={(e) => setVerified(e.target.value)}>
            <option value="">Tasdiq (barchasi)</option>
            <option value="1">Tasdiqlangan</option>
            <option value="0">Tasdiqlanmagan</option>
          </select>
          <div className="text-sm text-[color:var(--text-muted)] ml-auto">Jami: {total}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "28%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Ism</th><th className="px-4">Telefon</th><th className="px-4">Viloyat</th><th className="px-4">Holat</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 truncate">
                    <Link href={`/admin/users/${u.id}`} className="hover:underline font-medium">{u.firstName} {u.lastName}</Link>
                  </td>
                  <td className="px-4 whitespace-nowrap">{u.phone}</td>
                  <td className="px-4 truncate">{u.region}</td>
                  <td className="px-4">
                    <span className="inline-flex justify-center w-[92px] text-xs font-medium px-2 py-0.5 rounded-full border"
                      style={u.isBlocked
                        ? { color: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)" }
                        : { color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }}>
                      {u.isBlocked ? "Bloklangan" : "Faol"}
                    </span>
                  </td>
                  <td className="px-4">
                    <div className="flex gap-2 justify-end">
                      <Link href={`/admin/users/${u.id}`} className="btn-secondary btn-sm">Batafsil</Link>
                      <button onClick={() => block(u.id, !u.isBlocked)} className="btn-secondary btn-sm">{u.isBlocked ? "Ochish" : "Bloklash"}</button>
                      <button onClick={() => setDelId(u.id)} className="btn-danger btn-sm">O'chirish</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Hech narsa topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>

      <Modal open={!!delId} onClose={() => setDelId("")} title="Foydalanuvchini o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelId("")} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">Foydalanuvchi o'chiriladi. Davom etasizmi?</p>
      </Modal>
    </div>
  );
}
