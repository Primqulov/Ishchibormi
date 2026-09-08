"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { api, type APIError, type Elon, getAccess, type User } from "@/lib/api";
import {
  invalidateOwnerListingQueries, isOwnerClosable, loadOwnerListingGuard,
  ownerListingError, type OwnerListingGuard, requiresOwnerCancellation,
} from "@/lib/owner-listing";
import { T, useT } from "@/components/T";

type Props = {
  open: boolean;
  elonId: string;
  intent?: "delete" | "close";
  onClose: () => void;
  onChanged?: (listing: Elon) => void;
};
type Stage = "loading" | "confirm" | "blocked" | "reason" | "success" | "error";
type ClosureAttempt = { snapshot: OwnerListingGuard; session: string; asCancellation: boolean };

/** All three entry points use the same freshly checked owner-only flow. */
export function OwnerListingActionDialog(props: Props) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<OwnerAction key={`${props.elonId}:${props.intent}`} {...props} />, document.body);
}

function OwnerAction({ elonId, intent = "delete", onClose, onChanged }: Props) {
  const router = useRouter();
  const client = useQueryClient();
  const t = useT();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const lastAttempt = useRef<ClosureAttempt | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [guard, setGuard] = useState<OwnerListingGuard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(true);
  const [reason, setReason] = useState("");
  const [cancelled, setCancelled] = useState(intent === "close");
  const [followupPending, setFollowupPending] = useState(false);
  const [affected, setAffected] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const pendingCount = (value: OwnerListingGuard) => value.applications.filter((a) => a.status === "pending").length;

  function showGuard(value: OwnerListingGuard) {
    if (!isOwnerClosable(value.listing)) {
      throw { code: "listing_unavailable", message: "Bu e'lon allaqachon yopilgan. Uni o'zgartirib bo'lmaydi." } satisfies APIError;
    }
    setGuard(value);
    setStage(requiresOwnerCancellation(value.listing, value.applications) ? "blocked" : "confirm");
    setBusy(false);
  }

  function fail(value: unknown) {
    if (!mounted.current) return;
    const code = (value as Partial<APIError>)?.code;
    setError(ownerListingError(value));
    setRetryable(!["owner_required", "listing_unavailable", "no_account", "account_disabled", "account_banned"].includes(code || ""));
    setStage("error");
    setBusy(false);
  }

  async function load() {
    const version = ++generation.current;
    setStage("loading");
    setBusy(true);
    setError("");
    try {
      if (lastAttempt.current && await recoverCommitted(lastAttempt.current)) return;
      const value = await loadOwnerListingGuard(elonId);
      if (mounted.current && version === generation.current) showGuard(value);
    } catch (value) {
      if (mounted.current && version === generation.current) fail(value);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void load();
    return () => {
      mounted.current = false;
      document.body.style.overflow = previousOverflow;
      element?.close();
    };
    // The keyed component has a fixed listing/intent for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!busy) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [busy]);

  function complete(snapshot: OwnerListingGuard, asCancellation: boolean, pending: boolean, result?: Partial<Elon>) {
    lastAttempt.current = null;
    const listing: Elon = {
      ...snapshot.listing,
      status: "cancelled",
      cancelledAt: result?.cancelledAt || snapshot.listing.cancelledAt || new Date().toISOString(),
      cancelReason: result?.cancelReason || (asCancellation ? reason.trim() : snapshot.listing.cancelReason),
    };
    setAffected(snapshot.applications.filter((a) => a.status === "pending" || a.status === "accepted").length);
    setGuard({ ...snapshot, listing });
    setCancelled(asCancellation);
    setFollowupPending(pending);
    setStage("success");
    setError("");
    setBusy(false);
    client.setQueryData(["elon", elonId], listing);
    onChanged?.(listing);
    void invalidateOwnerListingQueries(client, elonId);
  }

  async function recoverCommitted(attempt: ClosureAttempt): Promise<boolean> {
    if (getAccess() !== attempt.session) {
      throw { code: "owner_required", message: "Hisob o'zgardi. E'lonni o'z hisobingizdan qayta oching." } satisfies APIError;
    }
    const [listing, user] = await Promise.all([
      api.get<Elon>(`/api/elons/${encodeURIComponent(elonId)}`, { cache: "no-store" }),
      api.get<User>("/api/me"),
    ]);
    if (!mounted.current) return true;
    if (getAccess() !== attempt.session || user.id !== attempt.snapshot.user.id || listing.ownerId !== user.id) {
      throw { code: "owner_required", message: "Bu amalni faqat e'lon egasi bajarishi mumkin." } satisfies APIError;
    }
    if (listing.id === elonId && !listing.isDeleted && listing.status === "cancelled") {
      complete({ ...attempt.snapshot, listing }, attempt.asCancellation, true, listing);
      return true;
    }
    return false;
  }

  async function submit(asCancellation: boolean) {
    if (locked.current || !guard) return;
    if (asCancellation && (!reason.trim() || [...reason.trim()].length > 500)) {
      setError(t("Bekor qilish sababini yozing (500 belgigacha)."));
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    let attempted: OwnerListingGuard | null = null;
    let session: string | null = null;
    try {
      const fresh = await loadOwnerListingGuard(elonId);
      if (!mounted.current) return;
      if (fresh.user.id !== guard.user.id || !isOwnerClosable(fresh.listing)) {
        throw { code: "listing_unavailable", message: "E'lon holati o'zgardi. Sahifani yangilang." } satisfies APIError;
      }
      if (!asCancellation && (requiresOwnerCancellation(fresh.listing, fresh.applications) || pendingCount(fresh) !== pendingCount(guard))) {
        showGuard(fresh);
        return;
      }
      attempted = fresh;
      session = getAccess();
      if (!session) throw { code: "no_account", message: "Hisobingizga qayta kiring." } satisfies APIError;
      lastAttempt.current = { snapshot: fresh, session, asCancellation: asCancellation || intent === "close" };
      // The old DELETE endpoint physically erased records. The compatible
      // archive endpoint retains history even during an API rolling update.
      const result = await api.post<Partial<Elon>>(`/api/elons/${encodeURIComponent(elonId)}/cancel`,
        asCancellation ? { reason: reason.trim() } : intent === "delete" ? { intent: "delete" } : {});
      if (getAccess() !== session) {
        throw { code: "owner_required", message: "Hisob o'zgardi. E'lonni o'z hisobingizdan qayta oching." } satisfies APIError;
      }
      if (mounted.current) complete(fresh, asCancellation || intent === "close", false, result);
    } catch (value) {
      if (!mounted.current) return;
      const code = (value as Partial<APIError>)?.code;
      if (["account_banned", "account_disabled", "owner_required", "listing_unavailable"].includes(code || "")) {
        fail(value);
        return;
      }
      // A timeout/503 can follow a committed closure. Verify ownership and
      // cancellation separately; do not claim notifications already arrived.
      if (attempted && session && lastAttempt.current) {
        try {
          if (await recoverCommitted(lastAttempt.current)) return;
        } catch (recoveryError) {
          const recoveryCode = (recoveryError as Partial<APIError>)?.code;
          if (["owner_required", "no_account", "account_banned", "account_disabled"].includes(recoveryCode || "")) {
            fail(recoveryError);
            return;
          }
          // Keep the attempted context for a later Retry after connectivity returns.
        }
      }
      try {
        const fresh = await loadOwnerListingGuard(elonId);
        if (!mounted.current) return;
        if (fresh.user.id !== guard.user.id) throw value;
        if (fresh.listing.status === "cancelled" && lastAttempt.current) {
          const attempt = lastAttempt.current;
          if (getAccess() !== attempt.session || fresh.user.id !== attempt.snapshot.user.id) {
            throw { code: "owner_required", message: "Bu amalni faqat e'lon egasi bajarishi mumkin." } satisfies APIError;
          }
          complete({ ...attempt.snapshot, listing: fresh.listing }, attempt.asCancellation, true, fresh.listing);
          return;
        }
        showGuard(fresh);
        if (!requiresOwnerCancellation(fresh.listing, fresh.applications)) setError(ownerListingError(value));
      } catch (refreshError) {
        fail(refreshError);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function leave(destination: string) {
    closeRef.current();
    router.push(destination);
    router.refresh();
  }

  const success = stage === "success";
  const title = stage === "loading" ? "Ma'lumotlar tekshirilmoqda…"
    : stage === "blocked" ? "E'lonni o'chirib bo'lmaydi"
    : stage === "reason" ? "Ishni bekor qilish"
    : success ? (cancelled ? "Ish bekor qilindi" : "E'lon o'chirildi")
    : stage === "error" ? "Amalni bajarib bo'lmadi"
    : intent === "close" ? "E'lonni yopasizmi?" : "E'lonni o'chirasizmi?";
  const count = guard ? pendingCount(guard) : 0;
  const selected = guard?.applications.filter((a) => a.status === "accepted") || [];

  return <dialog ref={dialog} aria-labelledby={titleId} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!busy && !success) closeRef.current(); }}
    className="owner-action-dialog w-[calc(100%-32px)] max-w-[420px] max-h-[calc(100dvh-32px)] rounded-[20px] p-6 sm:p-8 overflow-y-auto border-0"
    style={{ background: "var(--card)", color: "var(--text)", boxShadow: "0 24px 60px rgba(11,28,48,.22)" }}>
    <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full"
      style={{ background: success ? "#DDF5E4" : "#FCE2E2", color: success ? "#13853B" : "#BA1A1A" }}>
      {stage === "loading" ? <Loader2 size={28} className="animate-spin" /> : success ? <Check size={30} /> : <AlertTriangle size={30} />}
    </div>
    <h2 id={titleId} className="text-[21px] font-bold heading text-center leading-snug"><T>{title}</T></h2>
    {stage === "confirm" && <p className="mt-3 text-sm muted text-center leading-relaxed"><T>{count
      ? `Bu amalni qaytarib bo'lmaydi. E'lon ro'yxatdan olib tashlanadi va unga yuborilgan ${count} ta ariza avtomatik bekor qilinadi.`
      : "Bu amalni qaytarib bo'lmaydi."}</T></p>}
    {stage === "blocked" && <p className="mt-3 text-sm muted text-center leading-relaxed"><T>Bu ishga nomzod tanlangan va ish tasdiqlangan. Kelishuvni to'xtatish uchun «Ishni bekor qilish»dan foydalaning.</T></p>}
    {stage === "reason" && <label className="block mt-5 text-sm font-semibold">
      <T>Bekor qilish sababi</T>
      <textarea autoFocus className="input mt-2 min-h-[108px] resize-y" value={reason} maxLength={500}
        onChange={(event) => setReason(event.target.value)} disabled={busy} placeholder={t("Sababini qisqacha yozing…")} />
      <span className="block mt-1 text-xs subtle font-normal"><T>Sabab nomzodlarga yuboriladi va ish tarixida saqlanadi.</T></span>
    </label>}
    {success && <p className="mt-3 text-sm muted text-center leading-relaxed"><T>{followupPending
      ? "E'lon yopildi. Arizalar va bildirishnomalar yangilanishi biroz vaqt olishi mumkin."
      : affected > 0 ? `E'lon ro'yxatdan olib tashlandi. ${affected} ta ariza bekor qilindi va nomzodlarga xabar yuborildi.`
      : "E'lon ro'yxatdan olib tashlandi."}</T></p>}
    {guard && ["confirm", "blocked", "success"].includes(stage) && <dl className="grid gap-2 mt-5 rounded-xl p-4 text-[13px]"
      style={{ background: success ? "var(--bg-subtle)" : "#FCE2E2", color: success ? "var(--text)" : "#0B1C30" }}>
      <div className="flex justify-between gap-4"><dt className="shrink-0"><T>{stage === "blocked" ? "Tanlangan ishchi" : "E'lon"}</T></dt><dd className="font-bold text-right break-words min-w-0">{stage === "blocked" ? selected.map((a) => a.workerName || a.workerPhone).join(", ") || t("Nomzod tasdiqlangan") : guard.listing.title}</dd></div>
      {stage !== "blocked" && <div className="flex justify-between gap-4"><dt><T>{success ? "Bekor qilingan arizalar" : "Kelgan arizalar"}</T></dt><dd className="font-bold">{success ? affected : count} <T>ta</T></dd></div>}
      {stage === "blocked" && guard.listing.startDate && <div className="flex justify-between gap-4"><dt><T>Ish boshlanishi</T></dt><dd className="font-bold">{new Date(guard.listing.startDate).toLocaleDateString("uz-UZ")} {guard.listing.workTimeFrom}</dd></div>}
      {success && guard.listing.cancelledAt && <div className="flex justify-between gap-4"><dt><T>Yopilgan vaqt</T></dt><dd className="font-bold">{new Date(guard.listing.cancelledAt).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</dd></div>}
    </dl>}
    {error && <p role="alert" className="mt-4 text-sm text-center text-danger"><T>{error}</T></p>}
    {stage !== "loading" && <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2.5 mt-6">
      {success ? <>
        <button type="button" className="btn btn-outline !px-2 !whitespace-normal" onClick={() => leave("/my-elons?tab=cancelled")}><T>Arxivni ko'rish</T></button>
        <button type="button" className="btn btn-primary !px-2 !whitespace-normal" onClick={() => leave("/my-elons")}><T>E'lonlarimga qaytish</T></button>
      </> : <>
        <button type="button" className="btn btn-outline !px-2" disabled={busy} onClick={() => stage === "reason" ? setStage("blocked") : closeRef.current()}><T>{stage === "confirm" || stage === "reason" ? "Bekor qilish" : "Yopish"}</T></button>
        {stage === "error" ? retryable && <button type="button" className="btn btn-primary !px-2" onClick={() => void load()}><T>Qayta urinish</T></button>
          : <button type="button" className="btn !text-white !px-2 !whitespace-normal" style={{ background: "#BA1A1A" }} disabled={busy || (stage === "reason" && !reason.trim())}
            onClick={() => stage === "blocked" ? setStage("reason") : void submit(stage === "reason")}>
            {busy && <Loader2 size={16} className="animate-spin shrink-0" />}<T>{stage === "blocked" || stage === "reason" ? "Ishni bekor qilish" : intent === "close" ? "Ha, yopish" : "Ha, o'chirish"}</T>
          </button>}
      </>}
    </div>}
    {["confirm", "success", "blocked"].includes(stage) && <p className="mt-4 text-xs subtle text-center"><T>{stage === "blocked" ? "Bekor qilish sababi ish tarixida saqlanadi." : "O'chirilgan e'lon arxivda saqlanadi."}</T></p>}
  </dialog>;
}
