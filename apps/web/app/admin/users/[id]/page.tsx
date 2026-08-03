"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, User, Elon, Application } from "@/lib/api";
import { Modal } from "@/components/Modal";

interface Report { id: string; reason: string; description?: string; status: string; createdAt: string; }
interface Detail {
  user: User;
  elons: Elon[];
  applications: Application[];
  reports: Report[];
}

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");

  const load = useCallback(async () => {
    setD(await api.get<Detail>(`/api/admin/users/${id}`, { auth: "admin" } as any));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function block(isBlocked: boolean) {
    await api.post(`/api/admin/users/${id}/block`, { isBlocked }, { auth: "admin" } as any);
    load();
  }
  async function verify() {
    await api.post(`/api/admin/users/${id}/verify`, {}, { auth: "admin" } as any);
    load();
  }
  async function sendNotify() {
    await api.post(`/api/admin/users/${id}/notify`, { title: nTitle, body: nBody }, { auth: "admin" } as any);
    setNotifyOpen(false); setNTitle(""); setNBody("");
  }

  if (!d) return <div className="card p-6 text-sm text-[color:var(--text-muted)]">Yuklanmoqda…</div>;
  const u = d.user;

  return (
    <div className="grid gap-4">
      <Link href="/admin/users" className="text-sm hover:underline text-[color:var(--text-muted)]">← Foydalanuvchilar</Link>

      {/* Profil + amallar */}
      <div className="card p-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-black/10 overflow-hidden grid place-items-center text-lg font-bold">
            {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" /> : (u.firstName?.[0] || "?")}
          </div>
          <div>
            <div className="text-lg font-bold">{u.firstName} {u.lastName}</div>
            <div className="text-sm text-[color:var(--text-muted)]">{u.phone} · {u.region} {u.district}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => setNotifyOpen(true)} className="btn-secondary btn-sm">Bildirishnoma</button>
            {!u.isPhoneVerified && <button onClick={verify} className="btn-secondary btn-sm">Tasdiqlash</button>}
            <button onClick={() => block(!u.isBlocked)} className={u.isBlocked ? "btn-primary btn-sm" : "btn-danger btn-sm"}>{u.isBlocked ? "Blokdan ochish" : "Bloklash"}</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Bajarilgan ish" value={u.completedJobsCount} />
          <Stat label="Holat" value={u.isBlocked ? "Bloklangan" : "Faol"} />
        </div>
        {u.bio && <div className="text-sm"><span className="text-[color:var(--text-muted)]">Bio: </span>{u.bio}</div>}
      </div>

      <Section title={`E'lonlari (${d.elons.length})`}>
        {d.elons.length ? d.elons.map((e) => (
          <Row key={e.id}><Link href={`/admin/elons`} className="font-medium">{e.title}</Link><span className="text-[color:var(--text-muted)]">{e.status} · {e.priceAmount.toLocaleString("uz-UZ")}</span></Row>
        )) : <Empty />}
      </Section>

      <Section title={`Arizalari (${d.applications.length})`}>
        {d.applications.length ? d.applications.map((a) => (
          <Row key={a.id}><span className="font-medium">{a.elonTitle}</span><span className="text-[color:var(--text-muted)]">{a.status} · {a.amount.toLocaleString("uz-UZ")}</span></Row>
        )) : <Empty />}
      </Section>

      <Section title={`Ustidan shikoyatlar (${d.reports.length})`}>
        {d.reports.length ? d.reports.map((rp) => (
          <Row key={rp.id}><span className="font-medium">{rp.reason}</span><span className="text-[color:var(--text-muted)]">{rp.status}</span></Row>
        )) : <Empty />}
      </Section>

      <Modal open={notifyOpen} onClose={() => setNotifyOpen(false)} title="Bildirishnoma yuborish" footer={
        <>
          <button onClick={() => setNotifyOpen(false)} className="btn-secondary">Bekor</button>
          <button onClick={sendNotify} className="btn-primary" disabled={!nTitle.trim()}>Yuborish</button>
        </>
      }>
        <div className="grid gap-2">
          <input className="input" placeholder="Sarlavha" value={nTitle} onChange={(e) => setNTitle(e.target.value)} />
          <textarea className="input min-h-[90px]" placeholder="Matn" value={nBody} onChange={(e) => setNBody(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}><div className="text-xs text-[color:var(--text-muted)]">{label}</div><div className="font-semibold">{value}</div></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card p-4"><div className="font-semibold text-sm mb-2">{title}</div><div className="grid gap-1">{children}</div></div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 text-sm border-t py-1.5 first:border-t-0" style={{ borderColor: "var(--border)" }}>{children}</div>;
}
function Empty() { return <div className="text-sm text-[color:var(--text-muted)]">Ma'lumot yo'q</div>; }
