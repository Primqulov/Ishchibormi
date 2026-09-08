"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, Application, Notification, Elon, User } from "@/lib/api";
import { invalidateOwnerListingQueries, loadAllOwnerApplications, loadOwnerListingGuard, MyElons, ownerListingError } from "@/lib/owner-listing";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { SlotProgress } from "@/components/ui/SlotProgress";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/Modal";
import { Phone, MapPin, ChevronDown, ExternalLink, Send, Inbox, Plus, Users, Clock, ArrowLeft } from "lucide-react";
import { T, useT } from "@/components/T";
import { fmtSum, fmtSumSom, fromNow } from "@/lib/format";
import Link from "next/link";

// Bekor qilish sababini ro'yxatda qisqa ko'rsatish uchun.
function shortReason(s: string, max = 60) {
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

// Chapdagi rangli chiziq — ariza holatiga qarab (Figma 07).
const STRIPE: Record<string, string> = {
  pending: "#FF9500",
  accepted: "#1A7F3C",
  rejected: "#D92D20",
  cancelled: "#D92D20",
  completed: "#0038D8",
};

/** Figma "07/09 · Mening arizalarim": ikki rejim — yuborgan arizalarim va menga kelgan arizalar. */
export default function ProcessPage() {
  return <Suspense fallback={<div className="p-8 text-center muted"><T>Yuklanmoqda…</T></div>}><Process /></Suspense>;
}

function Process() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "employer" ? "employer" : "worker";
  const requestedElon = tab === "employer" ? searchParams.get("elon") || "" : "";
  const [status, setStatus] = useState<string>("");
  const [cancelId, setCancelId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelAsOwner, setCancelAsOwner] = useState(false);
  const [openElons, setOpenElons] = useState<Record<string, boolean>>({});
  const [reasonView, setReasonView] = useState<Application | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const t = useT();
  const qc = useQueryClient();

  const { data: mine, isLoading: mineLoading, isError: mineError, refetch: refetchMine } = useQuery<Application[]>({
    queryKey: ["my-applications"],
    queryFn: () => api.get<Application[]>("/api/my/applications"),
  });
  const { data: received, isLoading: receivedLoading, isError: receivedError, refetch: refetchReceived } = useQuery<Record<string, Application[]>>({
    queryKey: ["my-elons-applications"],
    queryFn: ({ signal }) => loadAllOwnerApplications(signal),
  });
  const { data: notifs } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/api/notifications"),
  });
  // Har bir e'lonning to'lish holatini (acceptedCount / workersNeeded) ko'rsatish
  // uchun ish beruvchining e'lonlarini olamiz.
  const { data: myElons, isLoading: listingsLoading, isError: listingsError, refetch: refetchListings } = useQuery<MyElons>({
    queryKey: ["my-elons"],
    queryFn: () => api.get<MyElons>("/api/my/elons", { cache: "no-store" }),
  });
  const { data: me, isSuccess: identityResolved } = useQuery<User>({ queryKey: ["me"], queryFn: () => api.get<User>("/api/me"), retry: false });
  const elonById = useMemo(() => {
    const m: Record<string, Elon> = {};
    [...(myElons?.active || []), ...(myElons?.drafts || []), ...(myElons?.archived || [])].forEach((e) => { m[e.id] = e; });
    return m;
  }, [myElons]);

  // Nuqtalar uchun: ariza bilan bog'liq o'qilmagan bildirishnomalardagi
  // ariza id'lari. Karta/tab shu id'lar bilan solishtiriladi.
  const unreadAppIds = new Set(
    (notifs || []).filter((n) => !n.isRead && n.relatedEntity?.type === "application").map((n) => n.relatedEntity!.id)
  );
  const seen = useMutation({
    mutationFn: (ids: string[]) => api.post("/api/notifications/read", { relatedIds: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  // Foydalanuvchi arizani ko'rgach/harakat qilgach shu arizaning nuqtasini tozalaymiz.
  function markSeen(...ids: string[]) {
    const fresh = ids.filter((id) => unreadAppIds.has(id));
    if (fresh.length) seen.mutate(fresh);
  }

  const workerDot = (mine || []).some((a) => unreadAppIds.has(a.id));
  const employerDot = Object.values(received || {}).some((apps) => apps.some((a) => unreadAppIds.has(a.id)));

  function refreshLists() { return invalidateOwnerListingQueries(qc, requestedElon); }

  async function verifyEmployerApplication(applicationId: string, statuses: Application["status"][], listingStatuses: Elon["status"][]) {
    const application = Object.values(received || {}).flat().find((item) => item.id === applicationId);
    if (!application) throw new Error("Ariza topilmadi. Sahifani yangilang.");
    const fresh = await loadOwnerListingGuard(application.elonId);
    qc.setQueryData(["elon", application.elonId], fresh.listing);
    qc.setQueryData<Record<string, Application[]>>(["my-elons-applications"], (previous) => ({ ...previous, [application.elonId]: fresh.applications }));
    const current = fresh.applications.find((item) => item.id === applicationId);
    if (!current || !statuses.includes(current.status) || !listingStatuses.includes(fresh.listing.status)) {
      throw new Error("Bu ariza bilan hozir amal bajarib bo'lmaydi. Ma'lumotlar yangilandi.");
    }
    return current;
  }
  function decisionError(error: unknown) {
    setErrMsg(ownerListingError(error));
    void refreshLists();
  }
  const accept = useMutation({
    mutationFn: async (id: string) => { await verifyEmployerApplication(id, ["pending"], ["recruiting", "filled"]); return api.post(`/api/applications/${id}/accept`); },
    onSuccess: refreshLists,
    onError: decisionError,
  });
  const reject = useMutation({
    mutationFn: async (id: string) => { await verifyEmployerApplication(id, ["pending"], ["recruiting", "filled"]); return api.post(`/api/applications/${id}/reject`); },
    onSuccess: refreshLists,
    onError: decisionError,
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (cancelAsOwner) await verifyEmployerApplication(cancelId, ["accepted"], ["recruiting", "filled", "confirmed", "in_progress"]);
      return api.post(`/api/applications/${cancelId}/cancel`, { reason: cancelReason.trim() });
    },
    onSuccess: async () => { setCancelId(""); setCancelReason(""); setCancelAsOwner(false); await refreshLists(); },
    onError: decisionError,
  });
  const done = useMutation({
    mutationFn: async ({ id, asOwner }: { id: string; asOwner: boolean }) => {
      if (asOwner) await verifyEmployerApplication(id, ["accepted"], ["recruiting", "filled", "confirmed", "in_progress"]);
      return api.post(`/api/applications/${id}/confirm-done`);
    },
    onSuccess: refreshLists,
    onError: decisionError,
  });

  const myApps = mine || [];
  const receivedCount = Object.values(received || {}).flat().length;
  const filtered = status ? myApps.filter((a) => a.status === status) : myApps;
  const countOf = (s: string) => myApps.filter((a) => a.status === s).length;
  const employerBusy = accept.isPending || reject.isPending || done.isPending || cancel.isPending;
  const employerGroups: [string, Application[]][] = requestedElon
    ? received?.[requestedElon] || elonById[requestedElon] ? [[requestedElon, received?.[requestedElon] || []]] : []
    : Object.entries(received || {});

  return (
    <Shell wide>
      <div className="py-6 flex flex-col gap-5">
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[26px] font-black heading tracking-[-0.6px] leading-tight"><T>Mening arizalarim</T></h1>
            <p className="text-[13.5px] muted mt-1">
              <T>Yuborgan arizalaringiz va e'lonlaringizga kelgan arizalar — bir joyda</T>
            </p>
          </div>
          <Link href="/elon/create" className="btn btn-primary gap-1.5"><Plus size={16} /><T>E'lon berish</T></Link>
        </div>

        {/* Rejim kartalari — Figma: ikkita katta tanlov */}
        <div className="grid sm:grid-cols-2 gap-4">
          <ModeCard
            active={tab === "worker"} onClick={() => { router.push("/process"); setStatus(""); }}
            icon={<Send size={17} />} title="Ishga arizalarim" subtitle="Men yuborgan arizalar"
            count={myApps.length} dot={workerDot}
          />
          <ModeCard
            active={tab === "employer"} onClick={() => router.push("/my-elons")}
            icon={<Inbox size={17} />} title="Ish e'lonlarim" subtitle="Menga kelgan arizalar"
            count={receivedCount} dot={employerDot}
          />
        </div>

        {/* ── Ishga arizalarim ─────────────────────────────────── */}
        {tab === "worker" && (
          <>
            <div className="card p-2.5 flex items-center gap-2 flex-wrap">
              <Chip active={!status} onClick={() => setStatus("")} label="Barchasi" count={myApps.length} />
              <Chip active={status === "pending"} onClick={() => setStatus("pending")} label="Kutilmoqda" count={countOf("pending")} />
              <Chip active={status === "accepted"} onClick={() => setStatus("accepted")} label="Qabul qilingan" count={countOf("accepted")} />
              <Chip active={status === "rejected"} onClick={() => setStatus("rejected")} label="Rad etilgan" count={countOf("rejected")} />
              <Chip active={status === "completed"} onClick={() => setStatus("completed")} label="Bajarilgan" count={countOf("completed")} />
            </div>

            <div className="flex flex-col gap-4">
              {mineLoading ? <div className="card p-10 text-center muted text-sm"><T>Yuklanmoqda…</T></div> : mineError ? <div role="alert" className="card p-6 flex flex-wrap gap-3 items-center justify-between text-sm muted"><T>Arizalarni yuklab bo'lmadi.</T><button type="button" onClick={() => void refetchMine()} className="btn btn-outline btn-sm"><T>Qayta urinish</T></button></div> : filtered.length === 0 && (
                <div className="card p-10 text-center muted text-sm"><T>Sizda ariza yo'q.</T></div>
              )}
              {filtered.map((a) => (
                <div key={a.id} className="card relative overflow-hidden p-5 pl-6 flex flex-col sm:flex-row gap-4">
                  <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: STRIPE[a.status] || "var(--brand)" }} />

                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={a.status} />
                      <span className="text-[12px] subtle">{fromNow(a.appliedAt)} <T>yuborilgan</T></span>
                      {unreadAppIds.has(a.id) && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />}
                    </div>

                    <Link href={`/elon/${a.elonId}`} onClick={() => markSeen(a.id)}
                          className="text-[17px] font-bold heading leading-snug hover:opacity-80 transition">
                      <T>{a.elonTitle}</T>
                    </Link>

                    <div className="flex items-center gap-4 flex-wrap text-[13px] muted">
                      {a.ownerName && (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={a.ownerName} src={a.ownerAvatarUrl} size="xs" />
                          <T>E'lon beruvchi</T>: <span className="heading font-semibold">{a.ownerName}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5"><Users size={14} className="subtle" />{a.peopleCount || 1} <T>kishi</T></span>
                    </div>

                    {a.status === "cancelled" && a.cancelReason && (
                      <div className="text-[12.5px] muted">
                        <T>{a.cancelledBy === "worker" ? "Ishchi bekor qildi" : "Ish beruvchi bekor qildi"}</T> — <T>{shortReason(a.cancelReason)}</T>
                        {a.cancelReason.length > 60 && (
                          <button onClick={() => setReasonView(a)} className="ml-1.5 font-semibold" style={{ color: "var(--brand)" }}>
                            <T>Batafsil</T>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="sm:text-right flex sm:flex-col items-center sm:items-end gap-3 justify-between">
                    <div>
                      <div className="text-[20px] font-bold leading-none" style={{ color: "var(--brand)" }}>
                        {a.isNegotiable ? t("Kelishiladi") : fmtSum(a.amount)}
                      </div>
                      {!a.isNegotiable && <div className="text-[11.5px] muted mt-1">so'm / <T>kunlik</T></div>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {a.status === "accepted" && (
                        <>
                          <a href={`tel:${a.workerPhone}`} className="btn btn-outline btn-sm gap-1.5"><Phone size={13} /><T>Aloqa</T></a>
                          <Link href={`/elon/${a.elonId}`} className="btn btn-outline btn-sm gap-1.5"><MapPin size={13} /><T>Manzil</T></Link>
                          <button onClick={() => done.mutate({ id: a.id, asOwner: false })} disabled={done.isPending} className="btn btn-primary btn-sm"><T>Bajarildi</T></button>
                        </>
                      )}
                      {(a.status === "pending" || a.status === "accepted") && (
                        <button onClick={() => { setCancelReason(""); setCancelAsOwner(false); setCancelId(a.id); }}
                                className="btn btn-sm !bg-transparent text-danger hover:!bg-[rgba(217,45,32,0.08)]">
                          <T>Arizani bekor qilish</T>
                        </button>
                      )}
                      <Link href={`/elon/${a.elonId}`} className="btn btn-soft btn-sm"><T>Batafsil</T></Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Menga kelgan arizalar ────────────────────────────── */}
        {tab === "employer" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Link href="/my-elons" className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--brand)" }}><ArrowLeft size={14} /><T>Ish e'lonlarimga qaytish</T></Link>
              {requestedElon && <Link href="/process?tab=employer" className="text-[13px] font-semibold" style={{ color: "var(--brand)" }}><T>Barcha e'lonlarning arizalari</T></Link>}
            </div>
            {(receivedLoading || listingsLoading) ? <div className="card p-10 text-center muted text-sm"><T>Yuklanmoqda…</T></div> : (receivedError || listingsError) ? <div role="alert" className="card p-6 flex flex-wrap gap-3 items-center justify-between text-sm muted">
              <T>Arizalar yoki e'lon ma'lumotlarini yuklab bo'lmadi.</T><button type="button" onClick={() => { void refetchReceived(); void refetchListings(); }} className="btn btn-outline btn-sm"><T>Qayta urinish</T></button>
            </div> : employerGroups.length === 0 && (
              <div className="card p-10 text-center muted text-sm"><T>Hozircha arizalar yo'q.</T></div>
            )}
            {employerGroups.map(([elonId, apps]) => {
              const open = requestedElon === elonId ? openElons[elonId] !== false : !!openElons[elonId];
              const el = elonById[elonId];
              const owned = !!(identityResolved && me && el && el.ownerId === me.id && !el.isDeleted && !listingsError && !receivedError);
              const canManage = owned && ["recruiting", "filled", "confirmed", "in_progress"].includes(el.status);
              const canDecide = owned && ["recruiting", "filled"].includes(el.status);
              return (
                <div key={elonId} className="card p-5" id={`applications-${elonId}`}>
                  {/* Sarlavha bosilganda sahifa ochilmaydi — pastidan arizachilar ro'yxati ochiladi. */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenElons((s) => ({ ...s, [elonId]: !open }));
                      if (!open) markSeen(...apps.map((a) => a.id));
                    }}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        {apps.some((a) => unreadAppIds.has(a.id)) && (
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                        )}
                        <span className="text-[17px] font-bold heading truncate"><T>{el?.title || apps[0]?.elonTitle || "E'lon"}</T></span>
                        {el && <StatusBadge status={el.status} />}
                      </span>
                      {el && (
                        <span className="mt-1 flex items-center gap-3 text-[12.5px] muted">
                          <span className="inline-flex items-center gap-1.5"><Users size={13} className="subtle" />{el.workersNeeded} <T>ta ishchi</T></span>
                          {el.publishedAt && (
                            <span className="inline-flex items-center gap-1.5"><Clock size={13} className="subtle" />{fromNow(el.publishedAt)}</span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2.5 shrink-0">
                      <span className="badge-info">{apps.length} <T>ta ariza</T></span>
                      <ChevronDown size={18} className={`transition-transform subtle ${open ? "rotate-180" : ""}`} />
                    </span>
                  </button>

                  {el && canManage && (
                    <div className="mt-3.5">
                      <SlotProgress accepted={el.acceptedCount} needed={el.workersNeeded} />
                    </div>
                  )}

                  {open && (
                    <div className="mt-4 flex flex-col gap-2">
                      <Link href={`/elon/${elonId}`} className="text-[12.5px] font-semibold inline-flex items-center gap-1.5 w-fit"
                            style={{ color: "var(--brand)" }}>
                        <ExternalLink size={12} /><T>E'lonni ochish</T>
                      </Link>
                      {!receivedLoading && !receivedError && apps.length === 0 && <p className="py-4 text-sm muted"><T>Bu e'longa hali ariza yuborilmagan.</T></p>}
                      {el && (el.isDeleted || ["cancelled", "completed", "hidden"].includes(el.status)) && <p className="py-1 text-[12px] muted"><T>E'lon yopilgan. Arizalar tarixini ko'rishingiz mumkin.</T></p>}
                      {apps.map((a) => (
                        <div key={a.id} className="surface p-3.5 flex flex-wrap items-center gap-3">
                          <Avatar name={a.workerName?.trim() || a.workerPhone} src={a.workerAvatarUrl} size="sm" />
                          <div className="mr-auto min-w-0">
                            <div className="text-[13.5px] font-bold heading flex items-center gap-1.5">
                              {unreadAppIds.has(a.id) && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />}
                              <span className="truncate">{a.workerName?.trim() || a.workerPhone}</span>
                            </div>
                            <div className="text-[11.5px] subtle">{a.workerPhone} · {a.peopleCount || 1} <T>kishi</T> · {fmtSumSom(a.amount, a.isNegotiable)}</div>
                            {a.status === "cancelled" && a.cancelReason && (
                              <div className="text-[11.5px] muted mt-0.5">
                                <T>{a.cancelledBy === "worker" ? "Ishchi bekor qildi" : "Siz bekor qildingiz"}</T> — <T>{shortReason(a.cancelReason, 40)}</T>
                                {a.cancelReason.length > 40 && (
                                  <button onClick={() => setReasonView(a)} className="ml-1 font-semibold" style={{ color: "var(--brand)" }}>
                                    <T>Batafsil</T>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <StatusBadge status={a.status} />
                          <Link href={`/u/${a.workerId}`} className="btn btn-soft btn-sm"><T>Profilni ko'rish</T></Link>
                          {canManage && a.workerPhone && <a href={`tel:${a.workerPhone.replace(/[^\d+]/g, "")}`} className="btn btn-outline btn-sm gap-1.5"><Phone size={12} /><T>Qo'ng'iroq</T></a>}
                          {a.status === "pending" && canDecide && (
                            <>
                              <button onClick={() => { markSeen(a.id); accept.mutate(a.id); }} disabled={employerBusy} className="btn btn-primary btn-sm"><T>Qabul qilish</T></button>
                              <button onClick={() => { markSeen(a.id); reject.mutate(a.id); }} disabled={employerBusy}
                                      className="btn btn-sm !bg-transparent text-danger hover:!bg-[rgba(217,45,32,0.08)]"><T>Rad etish</T></button>
                            </>
                          )}
                          {a.status === "accepted" && canManage && (
                            <>
                              <button onClick={() => { markSeen(a.id); done.mutate({ id: a.id, asOwner: true }); }} disabled={employerBusy || !!a.employerConfirmedDone} className="btn btn-primary btn-sm"><T>{a.employerConfirmedDone ? "Tasdiqlangan" : "Bajarildi"}</T></button>
                              <button onClick={() => { markSeen(a.id); setCancelReason(""); setCancelAsOwner(true); setCancelId(a.id); }} disabled={employerBusy}
                                      className="btn btn-sm !bg-transparent text-danger hover:!bg-[rgba(217,45,32,0.08)]"><T>Bekor qilish</T></button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!cancelId} onClose={() => { if (!cancel.isPending) setCancelId(""); }} title={t("Ishni bekor qilasizmi?")} footer={
        <>
          <button onClick={() => setCancelId("")} disabled={cancel.isPending} className="btn-secondary"><T>Yo'q</T></button>
          <button onClick={() => cancel.mutate()} disabled={cancel.isPending || !cancelReason.trim()} className="btn-danger disabled:opacity-50"><T>Ha, bekor qilish</T></button>
        </>
      }>
        <p className="text-sm muted mb-3"><T>{cancelAsOwner ? "Tanlangan ishchi bilan kelishuv bekor qilinadi. Sababi ariza tarixida saqlanadi." : "Ushbu ishni bekor qilasiz. Keyinroq qayta ariza topshirishingiz mumkin."}</T></p>
        <label className="block">
          <span className="text-sm font-medium"><T>BEKOR QILISH SABABI</T> <span className="text-danger">*</span></span>
          <textarea className="input mt-1" rows={3} maxLength={500} disabled={cancel.isPending} value={cancelReason} onChange={(ev) => setCancelReason(ev.target.value)} placeholder={t("Masalan: rejalarim o'zgardi")} />
          {!cancelReason.trim() && <span className="text-xs text-danger mt-1 block"><T>Sababni yozmasangiz bekor qila olmaysiz.</T></span>}
        </label>
      </Modal>

      {/* Xato/ogohlantirish — modal ko'rinishida */}
      <Modal open={!!errMsg} onClose={() => setErrMsg("")} title={t("Ogohlantirish")} footer={
        <button onClick={() => setErrMsg("")} className="btn-primary"><T>Tushunarli</T></button>
      }>
        <p className="text-sm"><T>{errMsg}</T></p>
      </Modal>

      {/* Bekor qilish sababini batafsil o'qish */}
      <Modal open={!!reasonView} onClose={() => setReasonView(null)} title={t("Bekor qilish sababi")}>
        {reasonView && (
          <div className="grid gap-2">
            <p className="text-sm font-semibold"><T>{reasonView.elonTitle}</T></p>
            <p className="text-xs text-[color:var(--text-muted)]">
              <T>{reasonView.cancelledBy === "worker" ? "Ishchi tomonidan bekor qilingan" : "Ish beruvchi tomonidan bekor qilingan"}</T>
            </p>
            <p className="text-sm whitespace-pre-line"><T>{reasonView.cancelReason || ""}</T></p>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

/* ── helpers ─────────────────────────────────────────── */

function ModeCard({
  active, onClick, icon, title, subtitle, count, dot,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  title: string; subtitle: string; count: number; dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`card p-4 flex items-center gap-3.5 text-left transition ${active ? "!border-transparent" : "hover:shadow-pop"}`}
      style={active ? { background: "var(--brand)", color: "#fff" } : undefined}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={active ? { background: "rgba(255,255,255,0.2)", color: "#fff" } : { background: "var(--brand-soft)", color: "var(--brand)" }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[14.5px] font-bold ${active ? "" : "heading"}`}>
          <T>{title}</T>
          {dot && <span className="inline-block ml-2 h-1.5 w-1.5 rounded-full align-middle" style={{ background: active ? "#fff" : "var(--accent)" }} />}
        </span>
        <span className={`block text-[12.5px] mt-0.5 ${active ? "text-white/75" : "subtle"}`}><T>{subtitle}</T></span>
      </span>
      <span className="grid min-w-[30px] h-7 px-2 place-items-center rounded-full text-[12.5px] font-bold"
            style={active ? { background: "rgba(255,255,255,0.2)", color: "#fff" } : { background: "var(--brand-soft)", color: "var(--brand)" }}>
        {count}
      </span>
    </button>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={`chip ${active ? "chip-active" : ""}`}>
      <T>{label}</T>
      <span className={`text-[11px] font-bold ${active ? "text-white/75" : "subtle"}`}>{count}</span>
    </button>
  );
}
