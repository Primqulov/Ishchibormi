"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  User,
  Paged,
  downloadAdminCsv,
  getAdminRole,
  APIError,
  isUserBlocked,
  moderationBanUntil,
  blockSourceLabel,
  platformLabel,
  CLIENT_PLATFORMS,
} from "@/lib/api";
import { Modal } from "@/components/Modal";
import { DeleteModeModal, DeleteMode } from "@/components/admin/DeleteModeModal";
import { Pagination } from "@/components/Pagination";

export default function AdminUsers() {
  const [data, setData] = useState<Paged<User> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [blocked, setBlocked] = useState("");
  const [verified, setVerified] = useState("");
  const [platform, setPlatform] = useState("");
  const [delId, setDelId] = useState("");
  // Avtomatik blokni faqat superadmin ocha oladi — backend ham shu qoidani
  // qo'llaydi (403 `moderation_ban_superadmin_only`). Rolni bilib turish
  // tugmani oldindan o'chirib qo'yish uchun kerak: bosilib, keyin rad
  // etiladigan amal taklif qilinmasin.
  const [isSuper, setIsSuper] = useState(false);
  // Bloklash oynasi: sabab MAJBURIY, shuning uchun bu bir bosishli amal emas.
  const [blockTarget, setBlockTarget] = useState<User | null>(null);
  const [reason, setReason] = useState("");
  // Blokni ochish oynasi.
  const [unblockTarget, setUnblockTarget] = useState<User | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  // "O'chirilgan" filtri: bo'sh = hammasi (standart), chunki o'chirilgan
  // hisob admin panelida ko'rinib turishi kerak.
  const [deleted, setDeleted] = useState("");
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    if (platform) params.set("platform", platform);
    if (deleted) params.set("deleted", deleted);
    setData(await api.get<Paged<User>>(`/api/admin/users?${params}`, { auth: "admin" } as any));
  }, [page, q, region, blocked, verified, platform, deleted]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setIsSuper(getAdminRole() === "superadmin"); }, []);
  // Filtr o'zgarsa 1-sahifaga qaytamiz.
  useEffect(() => { setPage(1); }, [q, region, blocked, verified, platform, deleted]);

  /** Bu foydalanuvchini shu admin blokdan chiqara oladimi. */
  function canUnblock(u: User): boolean {
    return isSuper || !moderationBanUntil(u);
  }

  async function submitBlock() {
    if (!blockTarget || !reason.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.post(
        `/api/admin/users/${blockTarget.id}/block`,
        { isBlocked: true, reason: reason.trim() },
        { auth: "admin" } as any,
      );
      setBlockTarget(null); setReason("");
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Bloklab bo'lmadi");
    } finally { setBusy(false); }
  }

  async function submitUnblock() {
    if (!unblockTarget) return;
    setBusy(true); setErr("");
    try {
      // Bitta chaqiruv ikkala blokni ham ochadi (qo'lda qo'yilgani va
      // avtomatik) — panelda blok bitta tushuncha bo'lgani uchun.
      await api.post(
        `/api/admin/users/${unblockTarget.id}/block`,
        { isBlocked: false },
        { auth: "admin" } as any,
      );
      setUnblockTarget(null);
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Blokni ochib bo'lmadi");
    } finally { setBusy(false); }
  }

  async function del(mode: DeleteMode) {
    setDelBusy(true); setDelErr("");
    try {
      await api.delete(`/api/admin/users/${delId}?mode=${mode}`, { auth: "admin" } as any);
      setDelId("");
      load();
    } catch (e) {
      setDelErr((e as APIError)?.message || "O'chirib bo'lmadi");
    } finally { setDelBusy(false); }
  }
  function exportCsv() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    if (platform) params.set("platform", platform);
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
          <select className="input max-w-[190px]" value={deleted} onChange={(e) => setDeleted(e.target.value)}>
            <option value="">O&apos;chirilganlar bilan</option>
            <option value="hide">Faqat faollari</option>
            <option value="only">Faqat o&apos;chirilganlari</option>
          </select>
          <select className="input max-w-[170px]" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">Platforma (barchasi)</option>
            {CLIENT_PLATFORMS.map((p) => (
              <option key={p} value={p}>{platformLabel(p)}</option>
            ))}
          </select>
          <div className="text-sm text-[color:var(--text-muted)] ml-auto">Jami: {total}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "23%" }} />
              <col style={{ width: "19%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Ism</th><th className="px-4">Telefon</th><th className="px-4">Viloyat</th><th className="px-4">Platforma</th><th className="px-4">Holat</th><th className="px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const blockedNow = isUserBlocked(u);
                const until = moderationBanUntil(u);
                return (
                  <tr key={u.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-3 px-4 truncate">
                      <Link href={`/admin/users/${u.id}`} className="hover:underline font-medium">{u.firstName} {u.lastName}</Link>
                      {u.isDeleted && (
                        <span className="ml-2 align-middle text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
                          style={{ color: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)" }}>
                          o&apos;chirilgan
                        </span>
                      )}
                    </td>
                    {/* O'chirilgan hisobda raqam `deletedPhone` ga ko'chadi —
                        aks holda katak bo'sh ko'rinardi. */}
                    <td className="px-4 whitespace-nowrap">{u.phone || u.deletedPhone || "—"}</td>
                    <td className="px-4 truncate">{u.region}</td>
                    {/* Platforma: yuqorida — hozir foydalanadigani, ostida —
                        qayerdan ro'yxatdan o'tgani. Ikkinchisi faqat FARQ
                        qilganda ko'rsatiladi: bir xil bo'lsa u qatorga hech
                        narsa qo'shmaydi, faqat ko'zni chalg'itardi. */}
                    <td className="px-4">
                      <div className="flex flex-col gap-0.5 items-start py-1">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--border)" }}>
                          {platformLabel(u.lastPlatform)}
                        </span>
                        {u.signupPlatform && u.signupPlatform !== u.lastPlatform && (
                          <span className="text-[11px] text-[color:var(--text-muted)]">
                            ro&apos;yxat: {platformLabel(u.signupPlatform)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4">
                      {/* BITTA holat belgisi. Ilgari qo'lda va avtomatik blok
                          ikki alohida nishon edi — "Faol" deb turgan odam
                          aslida ilovaga kira olmasligi mumkin edi. Manba va
                          sabab endi belgi EMAS, uning izohi. */}
                      <div className="flex flex-col gap-1 items-start py-1">
                        <span className="inline-flex justify-center w-[92px] text-xs font-medium px-2 py-0.5 rounded-full border"
                          style={blockedNow
                            ? { color: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)" }
                            : { color: "var(--success, #16a34a)", borderColor: "var(--success, #16a34a)" }}>
                          {blockedNow ? "Bloklangan" : "Faol"}
                        </span>
                        {blockedNow && (
                          <div className="text-[11px] leading-snug text-[color:var(--text-muted)]">
                            <div>
                              {blockSourceLabel(u)}
                              {until && ` · ${until.toLocaleDateString("uz-UZ")} gacha`}
                            </div>
                            {u.blockReason && <div className="line-clamp-2" title={u.blockReason}>{u.blockReason}</div>}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4">
                      <div className="flex gap-2 justify-end">
                        <Link href={`/admin/users/${u.id}`} className="btn-secondary btn-sm">Batafsil</Link>
                        {/* BITTA tugma: blok manbasi qanday bo'lishidan qat'i
                            nazar. Avtomatik blokni moderator ocha olmaydi —
                            tugma bosilib 403 olishdan ko'ra, o'chiq turgani
                            va sababi aytilgani ma'qul. */}
                        {blockedNow ? (
                          <button
                            onClick={() => { setErr(""); setUnblockTarget(u); }}
                            disabled={!canUnblock(u)}
                            title={canUnblock(u) ? "" : "Avtomatik moderatsiya blokini faqat superadmin ocha oladi"}
                            className="btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Blokdan chiqarish
                          </button>
                        ) : (
                          <button onClick={() => { setErr(""); setReason(""); setBlockTarget(u); }} className="btn-secondary btn-sm">
                            Bloklash
                          </button>
                        )}
                        {/* O'chirilgan hisob uchun bloklash ma'nosini yo'qotadi:
                            u allaqachon kira olmaydi va qaytarilmaydi. Faqat
                            superadmin uni bazadan butunlay o'chira oladi. */}
                        {(!u.isDeleted || isSuper) && (
                          <button onClick={() => { setDelErr(""); setDelId(u.id); }} className="btn-danger btn-sm">
                            {u.isDeleted ? "Bazadan o'chirish" : "O'chirish"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users.length && <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Hech narsa topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>

      <DeleteModeModal
        open={!!delId}
        title="Foydalanuvchini o'chirish"
        what="hisob"
        canPurge={isSuper}
        busy={delBusy}
        error={delErr}
        onCancel={() => setDelId("")}
        onConfirm={del}
      />

      {/* Bloklash — sabab MAJBURIY.
          Nega: blokni ochadigan yoki e'tirozni ko'radigan admin ko'pincha uni
          qo'ygan admin emas, va oradan oylar o'tgan bo'ladi. Sababsiz blok —
          hech kim javob bera olmaydigan qaror. */}
      <Modal open={!!blockTarget} onClose={() => setBlockTarget(null)} title="Foydalanuvchini bloklash" footer={
        <>
          <button onClick={() => setBlockTarget(null)} className="btn-secondary">Bekor</button>
          <button onClick={submitBlock} className="btn-danger" disabled={busy || !reason.trim()}>
            {busy ? "Bloklanmoqda…" : "Bloklash"}
          </button>
        </>
      }>
        <div className="grid gap-2">
          <p className="text-sm muted">
            <b>{blockTarget?.firstName} {blockTarget?.lastName}</b> ilovadan foydalana olmay qoladi
            va uning e&apos;lonlari yashiriladi.
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
            Sabab foydalanuvchining batafsil sahifasida saqlanadi — ertaga nega bloklangani shu yerdan bilinadi.
          </p>
          {err && <p className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{err}</p>}
        </div>
      </Modal>

      {/* Blokni ochish — bitta amal, manbasidan qat'i nazar. */}
      <Modal open={!!unblockTarget} onClose={() => setUnblockTarget(null)} title="Blokdan chiqarasizmi?" footer={
        <>
          <button onClick={() => setUnblockTarget(null)} className="btn-secondary">Yo&apos;q</button>
          <button onClick={submitUnblock} className="btn-primary" disabled={busy}>
            {busy ? "Ochilmoqda…" : "Ha, ochish"}
          </button>
        </>
      }>
        <div className="grid gap-2 text-sm muted">
          {unblockTarget?.blockReason && (
            <p>
              <span className="text-[color:var(--text-muted)]">Blok sababi: </span>
              {unblockTarget.blockReason}
            </p>
          )}
          <p>Foydalanuvchi ilovadan yana foydalana boshlaydi va e&apos;lonlari qaytadi.</p>
          {unblockTarget && moderationBanUntil(unblockTarget) && (
            <p>
              Bu avtomatik blok ({moderationBanUntil(unblockTarget)!.toLocaleDateString("uz-UZ")} gacha edi).
              Buzilishlar hisobi ham nolga tushadi — aks holda keyingi bitta buzilish uni darhol qayta
              bloklardi.
            </p>
          )}
          {err && <p style={{ color: "var(--danger, #dc2626)" }}>{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
