"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  User,
  Elon,
  Application,
  APIError,
  getAdminRole,
  isUserBlocked,
  moderationBanUntil,
  blockSourceLabel,
  platformLabel,
} from "@/lib/api";
import { Modal } from "@/components/Modal";
import { safeImageSrc } from "@/lib/url";
import { fmtDateTime } from "@/lib/format";

interface Report { id: string; reason: string; description?: string; status: string; createdAt: string; }

/**
 * Bitta moderatsiya buzilishi (backend: `moderation_strikes.events[]`).
 *
 * `detail` — tasnif natijasi (masalan `HARM_CATEGORY_HARASSMENT=HIGH`).
 * Foydalanuvchiga hech qachon ko'rsatilmaydi, admin uchun esa aynan shu
 * "nega bloklandi" degan savolga oxirgi javob.
 */
interface StrikeEvent { kind: string; detail?: string; at: string; }
interface StrikeRecord {
  phone: string;
  strikes: number;
  bannedUntil?: string;
  events?: StrikeEvent[];
  updatedAt: string;
}

interface Detail {
  user: User;
  elons: Elon[];
  applications: Application[];
  reports: Report[];
  /** Buzilishlar tarixi — hech qachon qoida buzmagan foydalanuvchida null. */
  moderationStrikes?: StrikeRecord | null;
}

/** Buzilish turi — inson o'qiy oladigan nom (backend: KindElon/Profile/Avatar). */
const STRIKE_KIND: Record<string, string> = {
  elon: "E'lon matni yoki rasmi",
  profile: "Profil ma'lumotlari",
  avatar: "Profil rasmi",
};

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [isSuper, setIsSuper] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setD(await api.get<Detail>(`/api/admin/users/${id}`, { auth: "admin" } as any));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setIsSuper(getAdminRole() === "superadmin"); }, []);

  async function submitBlock() {
    if (!reason.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/api/admin/users/${id}/block`, { isBlocked: true, reason: reason.trim() }, { auth: "admin" } as any);
      setBlockOpen(false); setReason("");
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Bloklab bo'lmadi");
    } finally { setBusy(false); }
  }
  async function submitUnblock() {
    setBusy(true); setErr("");
    try {
      // Bitta chaqiruv qo'lda qo'yilgan blokni ham, avtomatik blokni ham
      // ochadi — panelda blok bitta tushuncha.
      await api.post(`/api/admin/users/${id}/block`, { isBlocked: false }, { auth: "admin" } as any);
      setUnblockOpen(false);
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Blokni ochib bo'lmadi");
    } finally { setBusy(false); }
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
  const blockedNow = isUserBlocked(u);
  const banUntil = moderationBanUntil(u);
  const canUnblock = isSuper || !banUntil;
  const strikes = d.moderationStrikes;

  return (
    <div className="grid gap-4">
      <Link href="/admin/users" className="text-sm hover:underline text-[color:var(--text-muted)]">← Foydalanuvchilar</Link>

      {/* Profil + amallar */}
      <div className="card p-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-black/10 overflow-hidden grid place-items-center text-lg font-bold">
            {safeImageSrc(u.avatarUrl) ? <img src={safeImageSrc(u.avatarUrl)} alt="" className="h-full w-full object-cover" /> : (u.firstName?.[0] || "?")}
          </div>
          <div>
            <div className="text-lg font-bold">{u.firstName} {u.lastName}</div>
            <div className="text-sm text-[color:var(--text-muted)]">{u.phone} · {u.region} {u.district}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => setNotifyOpen(true)} className="btn-secondary btn-sm">Bildirishnoma</button>
            {!u.isPhoneVerified && <button onClick={verify} className="btn-secondary btn-sm">Tasdiqlash</button>}
            {/* BITTA tugma — qo'lda qo'yilgan va avtomatik blok uchun bir xil. */}
            {blockedNow ? (
              <button
                onClick={() => { setErr(""); setUnblockOpen(true); }}
                disabled={!canUnblock}
                title={canUnblock ? "" : "Avtomatik moderatsiya blokini faqat superadmin ocha oladi"}
                className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Blokdan chiqarish
              </button>
            ) : (
              <button onClick={() => { setErr(""); setReason(""); setBlockOpen(true); }} className="btn-danger btn-sm">
                Bloklash
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Bajarilgan ish" value={u.completedJobsCount} />
          <Stat label="Holat" value={blockedNow ? "Bloklangan" : "Faol"} />
          {/* Ikkalasi ham ko'rsatiladi, teng bo'lganda ham: bu profil
              kartasi, ro'yxat emas — bu yerda savol "bu odam haqida nima
              bilamiz", va bo'sh qolgan katak javobning o'zi.

              Yorliq "Ro'yxat PLATFORMASI" — pastdagi "Ro'yxatdan o'tgan"
              sana bilan chalkashmasligi uchun. */}
          <Stat label="Ro'yxat platformasi" value={platformLabel(u.signupPlatform)} />
          <Stat label="Oxirgi platforma" value={platformLabel(u.lastPlatform)} />
        </div>
        {/* Hisob qachon yaratilgan — profildagi eng asosiy vaqt belgisi.
            ANIQ sana va soat, nisbiy vaqt ("3 oy oldin") emas: bu sahifaga
            admin murojaatga javob berish yoki e'tirozni tekshirish uchun
            kiradi, va u yerda "qachan aynan" degan savol muhim. */}
        <div className="grid gap-1 text-sm">
          {u.createdAt && (
            <div>
              <span className="text-[color:var(--text-muted)]">Ro&apos;yxatdan o&apos;tgan: </span>
              <b>{fmtDateTime(u.createdAt)}</b>
            </div>
          )}
          {u.lastSeenAt && (
            <div className="text-xs text-[color:var(--text-muted)]">
              Oxirgi faollik: {fmtDateTime(u.lastSeenAt)}
            </div>
          )}
        </div>
        {u.bio && <div className="text-sm"><span className="text-[color:var(--text-muted)]">Bio: </span>{u.bio}</div>}
      </div>

      {/* Blok kartasi — sahifadagi eng muhim javob: NEGA bloklangan.
          Faqat bloklangan foydalanuvchida ko'rinadi. */}
      {blockedNow && (
        <div
          className="card p-5 grid gap-3 border"
          style={{ borderColor: "var(--danger, #dc2626)" }}
        >
          <div className="font-semibold" style={{ color: "var(--danger, #dc2626)" }}>
            Blok ma&apos;lumotlari
          </div>
          <div className="grid gap-2 text-sm">
            <Field label="Sabab">
              {u.blockReason || <span className="text-[color:var(--text-muted)]">Ko&apos;rsatilmagan (eski blok)</span>}
            </Field>
            <Field label="Kim qo&apos;ygan">{blockSourceLabel(u) || "—"}</Field>
            {u.blockedAt && (
              <Field label="Qachon">{new Date(u.blockedAt).toLocaleString("uz-UZ")}</Field>
            )}
            {banUntil && (
              <Field label="Qachongacha">
                {banUntil.toLocaleDateString("uz-UZ")} gacha
                <span className="text-[color:var(--text-muted)]"> · muddat tugagach o&apos;z-o&apos;zidan ochiladi</span>
              </Field>
            )}
            {!banUntil && u.isBlocked && (
              <Field label="Qachongacha">
                <span className="text-[color:var(--text-muted)]">Qo&apos;lda ochilguncha</span>
              </Field>
            )}
          </div>

          {/* Buzilishlar tarixi — sabab jumlasining dalili. */}
          {strikes && !!strikes.events?.length && (
            <div className="grid gap-1">
              <div className="text-sm font-semibold mt-1">
                Qoidabuzarliklar ({strikes.strikes})
              </div>
              {strikes.events!.map((ev, i) => (
                <div
                  key={`${ev.at}-${i}`}
                  className="flex items-start justify-between gap-3 text-sm border-t py-1.5 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div>
                    <div className="font-medium">{STRIKE_KIND[ev.kind] || ev.kind}</div>
                    {ev.detail && (
                      <div className="text-xs text-[color:var(--text-muted)] break-all">{ev.detail}</div>
                    )}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)] whitespace-nowrap">
                    {new Date(ev.at).toLocaleString("uz-UZ")}
                  </div>
                </div>
              ))}
              <p className="text-xs text-[color:var(--text-muted)] mt-1">
                Tarix telefon raqami bo&apos;yicha saqlanadi — hisob o&apos;chirilib qayta ochilsa ham qoladi.
              </p>
            </div>
          )}
        </div>
      )}

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

      {/* Bloklash — sabab MAJBURIY, chunki uni o'qiydigan admin ko'pincha
          boshqa odam va boshqa vaqtda bo'ladi. */}
      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="Foydalanuvchini bloklash" footer={
        <>
          <button onClick={() => setBlockOpen(false)} className="btn-secondary">Bekor</button>
          <button onClick={submitBlock} className="btn-danger" disabled={busy || !reason.trim()}>
            {busy ? "Bloklanmoqda…" : "Bloklash"}
          </button>
        </>
      }>
        <div className="grid gap-2">
          <p className="text-sm muted">
            <b>{u.firstName} {u.lastName}</b> ilovadan foydalana olmay qoladi va e&apos;lonlari yashiriladi.
          </p>
          <label className="text-sm font-medium">Bloklash sababi</label>
          <textarea
            className="input min-h-[90px]"
            placeholder="Masalan: takroriy spam e'lonlar, boshqa foydalanuvchilarga tahdid…"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-[color:var(--text-muted)]">
            Sabab shu sahifada saqlanadi — ertaga nega bloklangani shu yerdan bilinadi.
          </p>
          {err && <p className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{err}</p>}
        </div>
      </Modal>

      <Modal open={unblockOpen} onClose={() => setUnblockOpen(false)} title="Blokdan chiqarasizmi?" footer={
        <>
          <button onClick={() => setUnblockOpen(false)} className="btn-secondary">Yo&apos;q</button>
          <button onClick={submitUnblock} className="btn-primary" disabled={busy}>
            {busy ? "Ochilmoqda…" : "Ha, ochish"}
          </button>
        </>
      }>
        <div className="grid gap-2 text-sm muted">
          {u.blockReason && <p><span className="text-[color:var(--text-muted)]">Blok sababi: </span>{u.blockReason}</p>}
          <p>Foydalanuvchi ilovadan yana foydalana boshlaydi va e&apos;lonlari qaytadi.</p>
          {banUntil && (
            <p>
              Bu avtomatik blok ({banUntil.toLocaleDateString("uz-UZ")} gacha edi). Buzilishlar hisobi ham
              nolga tushadi — aks holda keyingi bitta buzilish uni darhol qayta bloklardi.
            </p>
          )}
          {err && <p style={{ color: "var(--danger, #dc2626)" }}>{err}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}><div className="text-xs text-[color:var(--text-muted)]">{label}</div><div className="font-semibold">{value}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 items-start">
      <div className="text-[color:var(--text-muted)]">{label}</div>
      <div>{children}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card p-4"><div className="font-semibold text-sm mb-2">{title}</div><div className="grid gap-1">{children}</div></div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 text-sm border-t py-1.5 first:border-t-0" style={{ borderColor: "var(--border)" }}>{children}</div>;
}
function Empty() { return <div className="text-sm text-[color:var(--text-muted)]">Ma'lumot yo'q</div>; }
