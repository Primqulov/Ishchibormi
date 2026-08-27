"use client";
import { useEffect, useState } from "react";
import { adminBase, api, Category, getAdminRole, getAdminToken } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";

type Draft = { id?: string; name: string; slug: string; icon: string; isActive: boolean };
const empty: Draft = { name: "", slug: "", icon: "", isActive: true };

export default function AdminCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const [err, setErr] = useState("");
  const [isSuper, setIsSuper] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);

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
  async function uploadIcon(file: File) {
    setErr("");
    setIconUploading(true);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      // adminBase(), API_BASE emas: admin API endi faqat boshqaruv
      // subdomenida javob beradi — ommaviy domenda bu yo'l 404.
      // Bu chaqiruv FormData yuborgani uchun api.post'dan o'tmaydi (u
      // JSON qo'yadi), shuning uchun manzil bu yerda alohida tanlanadi.
      const res = await fetch(`${adminBase()}/api/admin/categories/icon`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAdminToken() || ""}` },
        credentials: "include",
        body,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setEdit((current) => current ? { ...current, icon: data.url } : current);
    } catch (e: any) {
      setErr(e?.message || "Ikonka yuklashda xatolik");
    } finally {
      setIconUploading(false);
    }
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
              <col style={{ width: "24%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "17%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Nomi</th><th className="px-4">Slug</th>
                <th className="px-4" title="Hozir feedda ko'rinib turgan e'lonlar">Faol e'lon</th>
                <th className="px-4" title="Kategoriyada tarixan joylangan barcha e'lonlar">Jami</th>
                <th className="px-4">Tur</th><th className="px-4">Holat</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <CategoryIconPreview icon={c.icon} name={c.name} />
                      <span className="truncate">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 truncate">{c.slug}</td>
                  <td className="px-4">{c.activeCount}</td>
                  <td className="px-4 text-[color:var(--text-muted)]">{c.usageCount}</td>
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
                <tr><td colSpan={7} className="py-8 text-center text-[color:var(--text-muted)]">Turkumlar yo'q</td></tr>
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
          <button onClick={save} className="btn-primary" disabled={!edit?.name.trim() || !edit?.icon.trim() || iconUploading}>Saqlash</button>
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
            <div className="text-sm">
              <div className="font-medium">Kategoriya ikonkasi <span className="text-danger">*</span></div>
              <p className="mt-1 text-xs muted">Internetdagi SVG/PNG/WebP/JPG manzilini kiriting yoki kompyuterdan rasm yuklang.</p>
              <div className="mt-2 flex items-center gap-3">
                <CategoryIconPreview icon={edit.icon} name={edit.name || "Kategoriya"} large />
                <div className="flex-1 grid gap-2">
                  <input
                    className="input"
                    type="url"
                    value={edit.icon}
                    onChange={(e) => setEdit({ ...edit, icon: e.target.value })}
                    placeholder="https://.../icon.svg"
                    required
                  />
                  <label className="btn-secondary btn-sm w-fit cursor-pointer">
                    {iconUploading ? "Yuklanmoqda…" : "PNG/JPG/WebP yuklash"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={iconUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadIcon(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
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

function CategoryIconPreview({ icon, name, large = false }: { icon?: string; name: string; large?: boolean }) {
  const size = large ? "h-16 w-16" : "h-9 w-9";
  return (
    <span className={`${size} shrink-0 rounded-xl border grid place-items-center overflow-hidden bg-[color:var(--bg-subtle)]`}>
      <CategoryIcon icon={icon} name={name} className="h-[65%] w-[65%]" />
    </span>
  );
}
