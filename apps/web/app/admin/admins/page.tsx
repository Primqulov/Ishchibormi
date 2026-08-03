"use client";
import { useEffect, useState } from "react";
import { api, Admin, AdminRole } from "@/lib/api";
import { Modal } from "@/components/Modal";

const ROLES: AdminRole[] = ["superadmin", "moderator", "support"];

export default function AdminAdmins() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("moderator");
  const [editA, setEditA] = useState<Admin | null>(null);
  const [newPass, setNewPass] = useState("");
  const [delA, setDelA] = useState<Admin | null>(null);
  const [meId, setMeId] = useState<string>("");
  const [err, setErr] = useState("");

  async function load() { setAdmins(await api.get<Admin[]>("/api/admin/admins", { auth: "admin" } as any)); }
  useEffect(() => {
    load();
    api.get<Admin>("/api/admin/me", { auth: "admin" } as any).then((m) => setMeId(m.id)).catch(() => {});
  }, []);

  async function toggleActive(a: Admin) {
    setErr("");
    if (a.id === meId) { setErr("O'zingizning hisobingizni nofaol qila olmaysiz."); return; }
    try {
      await api.patch(`/api/admin/admins/${a.id}`, { isActive: !a.isActive }, { auth: "admin" } as any);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }

  async function create() {
    setErr("");
    try {
      await api.post("/api/admin/admins", { username, name: name.trim(), password, role }, { auth: "admin" } as any);
      setCreateOpen(false); setUsername(""); setName(""); setPassword(""); setRole("moderator");
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function saveEdit() {
    if (!editA) return;
    setErr("");
    try {
      const body: any = { role: editA.role, isActive: editA.isActive, name: (editA.name || "").trim() };
      if (newPass.trim()) body.password = newPass.trim();
      await api.patch(`/api/admin/admins/${editA.id}`, body, { auth: "admin" } as any);
      setEditA(null); setNewPass("");
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function del() {
    if (!delA) return;
    setErr("");
    try {
      await api.delete(`/api/admin/admins/${delA.id}`, { auth: "admin" } as any);
      setDelA(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); setDelA(null); }
  }
  async function resetTwoFactor(id: string) {
    setErr("");
    try {
      await api.patch(`/api/admin/admins/${id}`, { disableTwoFactor: true }, { auth: "admin" } as any);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Adminlar</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Jami {admins.length} ta admin</p>
        </div>
        <button onClick={() => { setErr(""); setCreateOpen(true); }} className="btn-primary btn-sm">+ Yangi admin</button>
      </div>
      {err && !createOpen && !editA && !delA && <div className="text-danger text-sm">{err}</div>}

      {/* Adminlar qatori */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "28%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Admin</th><th className="px-4">Rol</th><th className="px-4">Holat</th><th className="px-4">2FA</th><th className="px-4">Yaratilgan</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 truncate">
                    <div className="font-medium truncate">{a.name || a.username}</div>
                    {a.name && <div className="text-xs text-[color:var(--text-muted)] truncate">@{a.username}</div>}
                  </td>
                  <td className="px-4 capitalize truncate">{a.role}</td>
                  <td className="px-4">
                    {a.id === meId ? (
                      <span
                        className="inline-flex justify-center w-[84px] text-xs font-medium px-2 py-0.5 rounded-full border opacity-70"
                        style={{ color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }}
                        title="O'z hisobingizni nofaol qila olmaysiz"
                      >Faol</span>
                    ) : (
                      <button
                        onClick={() => toggleActive(a)}
                        className="inline-flex justify-center w-[84px] text-xs font-medium px-2 py-0.5 rounded-full border transition hover:opacity-80"
                        style={a.isActive
                          ? { color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }
                          : { color: "var(--text-muted)", borderColor: "var(--border)" }}
                        title={a.isActive ? "Bosib vaqtincha nofaol qilish" : "Bosib qayta faollashtirish"}
                      >{a.isActive ? "Faol" : "Nofaol"}</button>
                    )}
                  </td>
                  <td className="px-4">{a.totpEnabled ? <span className="text-success">yoqilgan</span> : "—"}</td>
                  <td className="px-4 whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString("uz-UZ")}</td>
                  <td className="px-4">
                    <div className="flex gap-2 justify-end">
                      {a.totpEnabled && <button onClick={() => resetTwoFactor(a.id)} className="btn-secondary btn-sm">2FA reset</button>}
                      <button onClick={() => { setErr(""); setNewPass(""); setEditA(a); }} className="btn-secondary btn-sm">Tahrir</button>
                      <button onClick={() => { setErr(""); setDelA(a); }} className="btn-danger btn-sm">O'chirish</button>
                    </div>
                  </td>
                </tr>
              ))}
              {admins.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Adminlar yo'q</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Yaratish */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Yangi admin" footer={
        <>
          <button onClick={() => setCreateOpen(false)} className="btn-secondary">Bekor</button>
          <button onClick={create} className="btn-primary" disabled={!username.trim() || password.length < 6}>Yaratish</button>
        </>
      }>
        <div className="grid gap-2">
          <label className="text-sm">Ism (to'liq ism)
            <input className="input mt-1" placeholder="Masalan: Diyorbek Primqulov" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">Username
            <input className="input mt-1" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="text-sm">Parol
            <input className="input mt-1" type="password" placeholder="kamida 6 belgi" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="text-sm">Rol
            <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {err && <div className="text-danger text-sm">{err}</div>}
        </div>
      </Modal>

      {/* Tahrirlash */}
      <Modal open={!!editA} onClose={() => setEditA(null)} title={`Admin: ${editA?.username}`} footer={
        <>
          <button onClick={() => setEditA(null)} className="btn-secondary">Bekor</button>
          <button onClick={saveEdit} className="btn-primary">Saqlash</button>
        </>
      }>
        {editA && (
          <div className="grid gap-2">
            <label className="text-sm">Ism (to'liq ism)
              <input className="input mt-1" placeholder="Masalan: Diyorbek Primqulov" value={editA.name || ""} onChange={(e) => setEditA({ ...editA, name: e.target.value })} />
            </label>
            <label className="text-sm">Rol
              <select className="input mt-1" value={editA.role} onChange={(e) => setEditA({ ...editA, role: e.target.value as AdminRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={editA.isActive} onChange={(e) => setEditA({ ...editA, isActive: e.target.checked })} /> Faol
            </label>
            <label className="text-sm">Yangi parol (ixtiyoriy)
              <input className="input mt-1" type="password" placeholder="bo'sh qoldirsangiz o'zgarmaydi" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            </label>
            {err && <div className="text-danger text-sm">{err}</div>}
          </div>
        )}
      </Modal>

      {/* O'chirish */}
      <Modal open={!!delA} onClose={() => setDelA(null)} title="Adminni o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelA(null)} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">“{delA?.username}” admin hisobi o'chiriladi.</p>
      </Modal>
    </div>
  );
}
