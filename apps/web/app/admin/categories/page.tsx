"use client";
import { useEffect, useState } from "react";
import { api, Category, getAdminRole } from "@/lib/api";
import { Modal } from "@/components/Modal";

type Draft = { id?: string; name: string; slug: string; icon: string; isActive: boolean };
const empty: Draft = { name: "", slug: "", icon: "", isActive: true };

export default function AdminCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const [err, setErr] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  async function load() { setCats(await api.get<Category[]>("/api/admin/categories", { auth: "admin" } as any)); }
  useEffect(() => { load(); setIsSuper(getAdminRole() === "superadmin"); }, []);

  async function toggle(c: Category) {
    await api.patch(`/api/admin/categories/${c.id}/active`, { isActive: !c.isActive }, { auth: "admin" } as any);
    load();
  }
  async function save() {
    if (!edit) return;
    setErr("");
    try {
      const body = { name: edit.name, slug: edit.slug, icon: edit.icon, isActive: edit.isActive };
      if (edit.id) await api.put(`/api/admin/categories/${edit.id}`, body, { auth: "admin" } as any);
      else await api.post(`/api/admin/categories`, body, { auth: "admin" } as any);
      setEdit(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function del() {
    if (!delCat) return;
    setErr("");
    try {
      await api.delete(`/api/admin/categories/${delCat.id}`, { auth: "admin" } as any);
      setDelCat(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function deactivateFromModal() {
    if (!delCat) return;
    setErr("");
    try {
      await api.patch(`/api/admin/categories/${delCat.id}/active`, { isActive: false }, { auth: "admin" } as any);
      setDelCat(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Turkumlar</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Jami {cats.length} ta turkum</p>
        </div>
        {isSuper && <button onClick={() => { setErr(""); setEdit({ ...empty }); }} className="btn-primary btn-sm">+ Yangi turkum</button>}
      </div>
      {err && !edit && !delCat && <div className="text-danger text-sm">{err}</div>}

      {/* Turkumlar qatori */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Nomi</th><th className="px-4">Slug</th><th className="px-4">Foydalanish</th><th className="px-4">Tur</th><th className="px-4">Holat</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 truncate">{c.icon} {c.name}</td>
                  <td className="px-4 truncate">{c.slug}</td>
                  <td className="px-4">{c.usageCount}</td>
                  <td className="px-4">{c.isSystemDefault ? "tizim" : "admin"}</td>
                  <td className="px-4">
                    {isSuper ? (
                      <button
                        onClick={() => toggle(c)}
                        className="inline-flex justify-center w-[92px] text-xs font-medium px-2 py-0.5 rounded-full border"
                        style={c.isActive
                          ? { color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }
                          : { color: "var(--text-muted)", borderColor: "var(--border)" }}
                        title="Holatni almashtirish"
                      >{c.isActive ? "Faol" : "O'chirilgan"}</button>
                    ) : (
                      <span className="inline-flex justify-center w-[92px]">{c.isActive ? "Faol" : "O'chirilgan"}</span>
                    )}
                  </td>
                  <td className="px-4">
                    <div className="flex gap-2 justify-end">
                      {isSuper && <button onClick={() => { setErr(""); setEdit({ id: c.id, name: c.name, slug: c.slug, icon: c.icon || "", isActive: c.isActive }); }} className="btn-secondary btn-sm">Tahrir</button>}
                      {isSuper && <button onClick={() => { setErr(""); setDelCat(c); }} className="btn-danger btn-sm">O'chirish</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {cats.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Turkumlar yo'q</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!isSuper && <div className="text-xs text-[color:var(--text-muted)]">Turkumlarni faqat superadmin tahrirlashi mumkin.</div>}

      {/* Yaratish / tahrirlash */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Turkumni tahrirlash" : "Yangi turkum"} footer={
        <>
          <button onClick={() => setEdit(null)} className="btn-secondary">Bekor</button>
          <button onClick={save} className="btn-primary" disabled={!edit?.name.trim()}>Saqlash</button>
        </>
      }>
        {edit && (
          <div className="grid gap-2">
            <label className="text-sm">Nomi
              <input className="input mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Masalan: Quruvchi" />
            </label>
            <label className="text-sm">Slug (ixtiyoriy — nomdan avtomatik)
              <input className="input mt-1" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="quruvchi" />
            </label>
            <label className="text-sm">Icon (emoji yoki nom, ixtiyoriy)
              <input className="input mt-1" value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="🔨" />
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Faol
            </label>
            {err && <div className="text-danger text-sm">{err}</div>}
          </div>
        )}
      </Modal>

      {/* O'chirish */}
      <Modal open={!!delCat} onClose={() => { setDelCat(null); setErr(""); }} title="Turkumni o'chirasizmi?" footer={
        delCat?.isSystemDefault ? (
          <>
            <button onClick={() => { setDelCat(null); setErr(""); }} className="btn-secondary">Yopish</button>
            {delCat?.isActive && <button onClick={deactivateFromModal} className="btn-danger">Nofaol qilish</button>}
          </>
        ) : (
          <>
            <button onClick={() => { setDelCat(null); setErr(""); }} className="btn-secondary">Yo'q</button>
            <button onClick={del} className="btn-danger">Ha, o'chirish</button>
          </>
        )
      }>
        {delCat?.isSystemDefault ? (
          <p className="text-sm muted">“{delCat?.name}” — tizim turkumi va butunlay o'chirilmaydi. Uni faqat <b>nofaol</b> qilish mumkin (feeddan yashiriladi).</p>
        ) : (
          <p className="text-sm muted">“{delCat?.name}” o'chiriladi. E'lonlarda ishlatilgan bo'lsa, o'chirish rad etiladi.</p>
        )}
        {err && <div className="mt-2 text-danger text-sm">{err}</div>}
      </Modal>
    </div>
  );
}
