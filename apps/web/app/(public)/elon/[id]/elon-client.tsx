"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Info, Users, Calendar, MapPin, FileText, ShieldCheck, ChevronRight,
  Phone, Send, Share2, Image as ImageIcon, X, RefreshCw, ArrowLeft,
  ArrowRight, CheckCircle2, ExternalLink, Hourglass, Star,
} from "lucide-react";
import { api, Application, Elon, getAccess, GENDER_LABEL, Notification, User } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { OwnerListingActionDialog } from "@/components/OwnerListingActionDialog";
import { ShareModal } from "@/components/ShareModal";
import { MapView } from "@/components/ui/MapView";
import { SlotProgress } from "@/components/ui/SlotProgress";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { Shell } from "@/components/Shell";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { T, useT } from "@/components/T";
import { fmtSum, fmtSumSom, fmtPhone, fromNow } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { safeHref, safeImageSrc } from "@/lib/url";
import {
  invalidateOwnerListingQueries, isOwnerClosable, isOwnerEditable,
  loadAllOwnerApplications, loadOwnerListingGuard, ownerListingError, requiresOwnerCancellation,
} from "@/lib/owner-listing";
import dayjs from "dayjs";

export default function ElonDetails() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [people, setPeople] = useState(1);
  const [cancelReason, setCancelReason] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [ownerActionOpen, setOwnerActionOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [session, setSession] = useState<"checking" | "authenticated" | "anonymous">("checking");
  const authed = session === "authenticated";

  useEffect(() => {
    setSession(getAccess() ? "authenticated" : "anonymous");
    setOpen(false);
    setCancelOpen(false);
    setOwnerActionOpen(false);
    setErrMsg("");
    setSavedToast(false);
    setPeople(1);
  }, [id]);

  const meQuery = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/api/me"),
    enabled: authed,
    retry: false,
  });
  const { data: e, isError: listingError, refetch: refetchListing } = useQuery<Elon>({
    queryKey: ["elon", id],
    // Archived records are private to the owner/applicant, so preserve auth.
    queryFn: () => api.get<Elon>(`/api/elons/${id}`, { cache: "no-store" }),
    enabled: !!id && session !== "checking",
    retry: false,
  });
  const identityResolved = session === "anonymous" || (authed && meQuery.isSuccess && meQuery.isFetchedAfterMount);
  const isOwner = !!(identityResolved && authed && e && meQuery.data?.id === e.ownerId);
  const workerQuery = useQuery<Application[]>({
    queryKey: ["my-applications"],
    queryFn: () => api.get<Application[]>("/api/my/applications"),
    enabled: authed && identityResolved && !!e && !isOwner,
  });
  const ownerAppsQuery = useQuery<Record<string, Application[]>>({
    queryKey: ["my-elons-applications"],
    queryFn: ({ signal }) => loadAllOwnerApplications(signal),
    enabled: isOwner,
  });
  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/api/notifications"),
    enabled: isOwner,
  });
  const applications = isOwner && ownerAppsQuery.data ? ownerAppsQuery.data[id] || [] : undefined;
  const currentApplication = workerQuery.data
    ?.filter((application) => application.elonId === id)
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0];
  const status = currentApplication?.status === "accepted" ? "accepted" : currentApplication?.status === "pending" ? "pending" : "none";
  const appId = currentApplication?.id || "";
  const workerActionsReady = identityResolved && !isOwner && (!authed || workerQuery.isSuccess);
  const unreadApplicationIds = new Set(
    (notifications || []).filter((notification) => !notification.isRead && notification.relatedEntity?.type === "application")
      .map((notification) => notification.relatedEntity!.id),
  );

  useEffect(() => {
    if (meQuery.data?.phone) setPhone(fmtPhone(meQuery.data.phone));
  }, [meQuery.data?.phone]);

  useEffect(() => {
    if (!isOwner || searchParams.get("updated") !== "1") return;
    setSavedToast(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("updated");
    const query = nextParams.toString();
    router.replace(`/elon/${id}${query ? `?${query}` : ""}`, { scroll: false });
  }, [id, isOwner, router, searchParams]);

  useEffect(() => {
    if (!savedToast) return;
    const timer = window.setTimeout(() => setSavedToast(false), 4500);
    return () => window.clearTimeout(timer);
  }, [savedToast]);

  const markSeen = useMutation({
    mutationFn: (ids: string[]) => api.post("/api/notifications/read", { relatedIds: ids }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const accept = useMutation({
    mutationFn: async (applicationId: string) => {
      const fresh = await loadOwnerListingGuard(id);
      qc.setQueryData(["elon", id], fresh.listing);
      qc.setQueryData<Record<string, Application[]>>(["my-elons-applications"], (previous) => ({ ...previous, [id]: fresh.applications }));
      const application = fresh.applications.find((item) => item.id === applicationId);
      if (fresh.listing.isDeleted || !["recruiting", "filled"].includes(fresh.listing.status) || application?.status !== "pending") {
        throw new Error("Bu arizani hozir qabul qilib bo'lmaydi. Ma'lumotlar yangilandi.");
      }
      return api.post(`/api/applications/${applicationId}/accept`);
    },
    onSuccess: async (_result, applicationId) => {
      if (unreadApplicationIds.has(applicationId)) markSeen.mutate([applicationId]);
      await invalidateOwnerListingQueries(qc, id);
    },
    onError: (error: unknown) => {
      setErrMsg(ownerListingError(error));
      void invalidateOwnerListingQueries(qc, id);
    },
  });

  const apply = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/api/elons/${id}/apply`, { phone, peopleCount: people }),
    onSuccess: async () => { setOpen(false); await invalidateOwnerListingQueries(qc, id); },
    // Masalan "shu kunga boshqa ishga qabul qilingansiz" — ogohlantirish
    // ishchiga modal oynada ko'rsatiladi.
    onError: (e: any) => { setOpen(false); setErrMsg(e?.message || "Xatolik yuz berdi"); },
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/applications/${appId}/cancel`, { reason: cancelReason.trim() }),
    onSuccess: async () => { setCancelOpen(false); setCancelReason(""); await invalidateOwnerListingQueries(qc, id); },
    onError: (e: any) => { setCancelOpen(false); setErrMsg(e?.message || "Xatolik yuz berdi"); },
  });

  if (!e) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="grid justify-items-center gap-4 px-5 text-center muted text-sm">
          <T>{listingError ? "E'lonni yuklab bo'lmadi. U mavjud emas yoki uni ko'rish uchun hisobingizga kirishingiz kerak." : "Yuklanmoqda…"}</T>
          {listingError && <div className="flex gap-3">
            <button type="button" onClick={() => void refetchListing()} className="btn btn-outline"><T>Qayta urinish</T></button>
            <Link href={authed ? "/my-elons" : "/login"} className="btn btn-primary"><T>{authed ? "Mening e'lonlarim" : "Kirish"}</T></Link>
          </div>}
        </div>
      </div>
    );
  }
  // 24 soat ichida joylangan e'lon "Yangi" tegini oladi.
  const isNew = e.publishedAt ? Date.now() - new Date(e.publishedAt).getTime() < 24 * 3600 * 1000 : false;
  const dateLine = e.startDate
    ? `${dayjs(e.startDate).format("D-MMM")}${e.workTimeFrom ? `, ${e.workTimeFrom}` : ""}${e.workTimeTo ? ` - ${e.workTimeTo}` : ""}`
    : "—";
  const hasCoords = typeof e.lat === "number" && Number.isFinite(e.lat) && typeof e.lng === "number" && Number.isFinite(e.lng);
  const isArchived = !isOwnerClosable(e);
  const canEdit = isOwnerEditable(e);
  const canClose = isOwnerClosable(e);
  const cancellationRequired = requiresOwnerCancellation(e, applications);
  const activeApplicants = applications?.filter((application) => application.status === "pending" || application.status === "accepted").length || 0;
  const newApplicants = applications?.filter((application) => application.status === "pending" && unreadApplicationIds.has(application.id)).length || 0;
  const acceptedApplicants = applications?.filter((application) => application.status === "accepted").length || 0;
  const applicationCount = applications ? String(applications.length) : "—";
  const applicationStats = `${applicationCount} ${t("ta")}${acceptedApplicants ? ` · ${acceptedApplicants} ${t("tanlangan")}` : newApplicants ? ` · ${newApplicants} ${t("yangi")}` : ""}`;
  const applicationsHref = `/process?tab=employer&elon=${encodeURIComponent(id)}`;
  const mapHref = safeHref(e.locationUrl) || (hasCoords ? `https://www.google.com/maps?q=${e.lat},${e.lng}` : "");

  /* ── inner content (shared between auth/anon) ── */
  const content = (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
      {savedToast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl px-5 py-3 shadow-lg flex items-center gap-2 bg-[#DFF5E5] text-[#1A7F3C] font-semibold text-sm max-w-[calc(100vw-2rem)]">
          <CheckCircle2 size={18} className="shrink-0" /><T>O'zgarishlar saqlandi</T>
        </div>
      )}
      {/* ── Main column ─────────────── */}
      <div className="grid gap-5 min-w-0">
        {/* Sarlavha kartasi — Figma: teglar, sarlavha, meta qatori */}
        <section className="card p-6">
          <div className="flex items-center gap-2 flex-wrap">
            {isOwner && <><span className="tag-cat"><T>MENING E'LONIM</T></span><OwnerStatus listing={e} confirmed={cancellationRequired} /></>}
            {e.categoryName && (
              <span className="tag-cat" style={{ background: catTone(e.categoryName).bg, color: catTone(e.categoryName).fg }}>
                <T>{e.categoryName}</T>
              </span>
            )}
            {!isOwner && isNew && <span className="tag-new"><T>Yangi</T></span>}
            {(e.gender === "male" || e.gender === "female") && (
              <span className="badge-neutral"><T>{GENDER_LABEL[e.gender]}</T></span>
            )}
            {!isOwner && <StatusBadge status={e.status} />}
          </div>
          <h1 className={`text-[24px] ${isOwner ? "mt-4 sm:text-[30px]" : "mt-3 sm:text-[26px]"} font-black heading tracking-[-0.6px] leading-tight`}>
            <T>{e.title}</T>
          </h1>
          <div className="mt-3 flex items-center gap-5 flex-wrap text-[13.5px] muted">
            <span className="inline-flex items-center gap-[7px]">
              <MapPin size={15} className="subtle" />
              <T>{(isOwner ? e.locationText : "") || [e.region, e.district].filter(Boolean).join(", ") || e.locationText || "Manzil ko'rsatilmagan"}</T>
            </span>
            <span className="inline-flex items-center gap-[7px]"><Calendar size={15} className="subtle" />{dateLine}</span>
            <span className="inline-flex items-center gap-[7px]">
              <Users size={15} className="subtle" />{e.workersNeeded} <T>ta ishchi kerak</T>
            </span>
            {e.publishedAt && (
              <span className="inline-flex items-center gap-[7px]"><RefreshCw size={15} className="subtle" />{fromNow(e.publishedAt)}</span>
            )}
          </div>
        </section>

        {/* Ish tavsifi */}
        <section className="card p-6">
          <h2 className="section-title flex items-center gap-2 mb-3">
            {!isOwner && <FileText size={18} />}<T>Ish tavsifi</T>
          </h2>
          <p className="text-[14px] leading-relaxed whitespace-pre-line muted">
            <T>{e.description}</T>
          </p>
        </section>

        {/* Ish shartlari — Figma: kichik plitkalar */}
        <section className="card p-6">
          <h2 className="section-title flex items-center gap-2 mb-4">
            {!isOwner && <Info size={18} />}<T>Ish shartlari</T>
          </h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <Tile label="Sana" value={e.startDate ? dayjs(e.startDate).format("D-MMMM, dddd") : "—"} />
            <Tile label="Vaqt" value={e.workTimeFrom ? `${e.workTimeFrom}${e.workTimeTo ? ` — ${e.workTimeTo}` : ""}` : "—"} />
            <Tile label="Ishchilar soni" value={`${e.workersNeeded} kishi`} />
            <Tile label="Ish haqi turi" value={PRICING_LABEL[e.pricingType]} />
            <Tile label="Kimlar kerak" value={GENDER_LABEL[e.gender || "mixed"]} />
            <Tile label="Kategoriya" value={e.categoryName || "—"} />
          </div>
          <div className="mt-4">
            <SlotProgress accepted={e.acceptedCount || 0} needed={e.workersNeeded || 1} />
          </div>
        </section>

        {/* Manzil */}
        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="section-title flex items-center gap-2">
              {!isOwner && <MapPin size={18} />}<T>Manzil</T>
            </h2>
            {isOwner && mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: "var(--brand)" }}><T>Xaritada ochish</T><ExternalLink size={13} /></a>}
          </div>
          <div className="grid gap-3">
            <div className="font-semibold flex items-center gap-1.5">
              <MapPin size={15} className="muted" />
              <T>{(isOwner ? e.locationText : "") || [e.region, e.district].filter(Boolean).join(", ") || "Manzil ko'rsatilmagan"}</T>
            </div>
            {hasCoords ? (
              <MapView lat={e.lat!} lng={e.lng!} label={e.title} height={220} />
            ) : safeHref(e.locationUrl) ? (
              <a href={safeHref(e.locationUrl)} target="_blank" rel="noreferrer"
                 className="text-sm font-semibold" style={{ color: "var(--brand)" }}>
                <T>Xaritada ochish</T>
              </a>
            ) : (
              <div className="rounded-xl border h-[120px] grid place-items-center muted text-sm" style={{ borderColor: "var(--border)" }}>
                <MapPin size={24} />
              </div>
            )}
          </div>
        </section>

        {/* Rasmlar */}
        {e.images && e.images.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold heading flex items-center gap-2 mb-4">
              <ImageIcon size={18} /><T>Rasmlar</T>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {e.images.map((src, i) => {
                const safeSrc = safeImageSrc(src);
                if (!safeSrc) return null;
                return (
                  <a
                    key={src}
                    href={safeSrc}
                    target="_blank"
                    rel="noreferrer"
                    className="relative aspect-square rounded-xl overflow-hidden border block"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={safeSrc} alt={`${e.title} ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition" />
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {isOwner && (
          <section className="card p-6" id="applications">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <h2 className="section-title"><T>Kelgan arizalar</T> ({applicationCount})</h2>
              <Link href={applicationsHref} className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--brand)" }}><T>Barchasini ko'rish</T><ArrowRight size={14} /></Link>
            </div>
            {ownerAppsQuery.isError ? (
              <div className="py-5 text-sm muted flex flex-wrap items-center justify-between gap-3" role="alert">
                <T>Arizalarni yuklab bo'lmadi.</T>
                <button type="button" onClick={() => void ownerAppsQuery.refetch()} className="btn btn-outline btn-sm"><T>Qayta urinish</T></button>
              </div>
            ) : !applications ? (
              <p className="py-5 text-sm muted"><T>Yuklanmoqda…</T></p>
            ) : applications.length === 0 ? (
              <p className="py-5 text-sm muted"><T>Hozircha arizalar yo'q.</T></p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {[...applications].sort((a, b) => {
                  const rank = (application: Application) => application.status === "accepted" ? 0 : application.status === "pending" ? 1 : 2;
                  return rank(a) - rank(b) || b.appliedAt.localeCompare(a.appliedAt);
                }).slice(0, 3).map((application) => (
                  <div key={application.id} className="py-4 last:pb-0 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    <Avatar name={application.workerName} src={application.workerAvatarUrl} size="lg" />
                    <div className="flex-1 min-w-[150px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[16px] font-bold heading">{application.workerName || t("Foydalanuvchi")}</span>
                        {application.status === "pending" ? (
                          unreadApplicationIds.has(application.id) && <span className="badge-pending !text-[10px]"><T>YANGI ARIZA</T></span>
                        ) : <StatusBadge status={application.status} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] muted">
                        {typeof application.workerRating === "number" && application.workerRating > 0 && <span className="inline-flex items-center gap-1"><Star size={12} fill="currentColor" />{application.workerRating.toFixed(1)}<span aria-hidden="true"> · </span></span>}
                        <span>{fromNow(application.appliedAt)} <T>yuborilgan</T></span>
                        {(application.peopleCount || 1) > 1 && <span> · {application.peopleCount} <T>kishi</T></span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 w-full sm:w-auto sm:justify-end">
                      <Link href={`/u/${application.workerId}`} onClick={() => { if (unreadApplicationIds.has(application.id)) markSeen.mutate([application.id]); }} className="btn btn-soft btn-sm"><T>Profilni ko'rish</T></Link>
                      {!isArchived && ["recruiting", "filled"].includes(e.status) && application.status === "pending" && (
                        <button type="button" onClick={() => accept.mutate(application.id)} disabled={accept.isPending} className="btn btn-primary btn-sm"><T>{accept.isPending && accept.variables === application.id ? "Yuklanmoqda…" : "Tanlash"}</T></button>
                      )}
                      {!isArchived && application.status === "accepted" && application.workerPhone && <a href={`tel:${application.workerPhone.replace(/[^\d+]/g, "")}`} className="btn btn-primary btn-sm gap-1.5"><Phone size={14} /><T>Bog'lanish</T></a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Right column — Figma: yopishqoq narx paneli ────────────── */}
      <aside id="ariza" className="grid gap-4 content-start lg:sticky lg:top-[92px] scroll-mt-24">
        <section className={`card ${isOwner ? "p-6" : "p-5"}`}>
          <div className="text-[13px] muted"><T>Ish haqi</T></div>
          <div className="mt-1 flex items-end gap-2">
            <span className={`${isOwner ? "text-[34px]" : "text-[32px]"} font-black leading-none tracking-[-1px]`} style={{ color: "var(--brand)" }}>
              {e.pricingType === "negotiable" ? t("Kelishiladi") : fmtSum(isOwner ? e.priceAmount : e.perWorkerAmount || e.priceAmount)}
            </span>
            {e.pricingType !== "negotiable" && <span className="text-[13px] muted pb-1">so'm</span>}
          </div>
          <div className="mt-1.5 text-[12.5px] subtle">
            <T>{e.pricingType === "negotiable" ? PRICING_LABEL.negotiable : isOwner ? "Umumiy to'lov" : PRICING_LABEL.per_worker}</T> · {e.workersNeeded} <T>kishi</T>
          </div>

          <div className="divider my-4" />
          {isOwner ? (
            <>
              <div className="flex flex-col gap-3.5 text-[13px]">
                {typeof e.viewsCount === "number" && <Row label="Ko'rishlar" value={`${fmtSum(e.viewsCount)} ${t("ta")}`} />}
                <Row label="Kelgan arizalar" value={ownerAppsQuery.isError ? t("Yuklab bo'lmadi") : applicationStats} />
                {e.status === "cancelled" && e.cancelledAt ? <Row label="Bekor qilingan vaqt" value={dayjs(e.cancelledAt).format("D MMMM, HH:mm")} /> : e.startDate ? <Row label="Ish boshlanishi" value={dateLine} /> : null}
              </div>
              <div className="mt-4 grid gap-4">
                <Link href={applicationsHref} className="btn btn-primary w-full !py-3.5" style={{ boxShadow: "var(--shadow-blue)" }}><T>Arizalarni ko'rish</T> ({applicationCount})</Link>
                <div className="grid grid-cols-2 gap-3">
                  {canEdit ? <Link href={`/elon/${id}/edit`} className="btn btn-soft w-full"><T>Tahrirlash</T></Link> : <button type="button" disabled className="btn btn-soft w-full"><T>Tahrirlash</T></button>}
                  <button type="button" onClick={() => setShareOpen(true)} disabled={isArchived} className="btn w-full" style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}><T>Ulashish</T></button>
                </div>
                <button type="button" onClick={() => setOwnerActionOpen(true)} disabled={!canClose} className="btn w-full !py-3 disabled:opacity-50" style={{ color: "#ba1a1a", background: "color-mix(in srgb, #ba1a1a 6%, var(--card))", border: "1px solid color-mix(in srgb, #ba1a1a 28%, var(--card))" }}>
                  <T>{e.status === "cancelled" ? "Bekor qilingan" : "E'lonni o'chirish"}</T>
                </button>
              </div>
              {canClose && cancellationRequired ? (
                <div className="mt-4 rounded-xl p-3 flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ background: "var(--accent-soft)", color: "#ba1a1a" }}>
                  <Hourglass size={15} className="shrink-0 mt-0.5" /><T>Nomzod tasdiqlangan — e'lonni o'chirish uchun avval ishni sababini ko'rsatib bekor qilish kerak.</T>
                </div>
              ) : canClose && activeApplicants > 0 ? (
                <div className="mt-4 rounded-xl p-3 flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                  <Hourglass size={15} className="shrink-0 mt-0.5" /><span><T>Ish haqi yoki muhim ma'lumotlar o'zgarsa, nomzodlarga bildirishnoma yuboriladi.</T></span>
                </div>
              ) : isArchived && e.status === "cancelled" ? <p className="mt-4 text-[12.5px] muted leading-relaxed"><T>E'lon faol ro'yxatdan olib tashlangan va arxivda saqlanadi.</T></p> : null}
            </>
          ) : <>
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            <Row label="Jami summa" value={fmtSumSom(e.priceAmount, e.pricingType === "negotiable")} />
            <Row label="Ariza berish" value={t("Bepul")} />
              <Row label="Ilovadan foydalanish haqi" value={t("Bepul")} />
          </div>

          {/* Actions */}
          <div className="mt-4 grid gap-2">
            {authed && identityResolved && workerQuery.isError && <div role="alert" className="grid gap-2 text-[13px] muted">
              <T>Arizangiz holatini yuklab bo'lmadi.</T>
              <button type="button" onClick={() => void workerQuery.refetch()} className="btn btn-outline btn-sm"><T>Qayta urinish</T></button>
            </div>}
            {workerActionsReady && status === "none" && e.status === "recruiting" && !e.isDeleted && (
              <button onClick={() => authed ? setOpen(true) : router.push("/login")} className="btn btn-primary w-full !py-3.5 gap-2">
                <Send size={16} /><T>Ariza yuborish</T>
              </button>
            )}
            {workerActionsReady && status === "pending" && !isArchived && (
              <>
                <div className="w-full rounded-lg py-3 badge-pending justify-center"><T>Ariza yuborilgan — javob kutilmoqda</T></div>
                <button onClick={() => setCancelOpen(true)} disabled={!appId} className="btn btn-outline w-full gap-2 !text-danger disabled:opacity-50"
                        style={{ borderColor: "rgba(217,45,32,0.3)" }}>
                  <X size={16} /><T>Arizani bekor qilish</T>
                </button>
              </>
            )}
            {workerActionsReady && status === "accepted" && !isArchived && (
              <div className="w-full rounded-lg py-3 badge-success justify-center"><T>Ish qabul qilindi</T></div>
            )}
            {identityResolved && !isOwner && isArchived && <div className="badge-neutral py-3 justify-center"><T>Bu e'lon ariza qabul qilmaydi.</T></div>}
            {identityResolved && <button onClick={() => setShareOpen(true)} className="btn btn-soft w-full gap-2">
              <Share2 size={16} /><T>Ulashish</T>
            </button>}
          </div>

          {(e.acceptedCount || 0) > 0 && (
            <div className="mt-4 rounded-xl p-3 text-[12.5px] leading-relaxed"
                 style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
              <T>Bu e'longa allaqachon ariza yuborilgan — tez qaror qiling.</T>
            </div>
          )}
          </>}
        </section>

        {isOwner ? (
          <section className="card p-5 !shadow-none">
            <h3 className="text-[14px] font-bold heading flex items-center gap-2"><ShieldCheck size={16} /><T>E'lonni boshqarish</T></h3>
            <p className="mt-2 text-[12.5px] muted leading-relaxed"><T>{isArchived ? "Bu e'lon arxivda saqlanadi. E'lon tafsilotlari va kelgan arizalarni ko'rishingiz mumkin." : "E'lonni tahrirlashingiz yoki o'chirishingiz mumkin. Nomzod tanlangan bo'lsa, avval ishni sababini ko'rsatib bekor qilish kerak. O'chirilgan e'lon arxivda saqlanadi."}</T></p>
            <Link href="/my-elons?tab=cancelled" className="mt-3 inline-block text-[12.5px] font-semibold" style={{ color: "var(--brand)" }}><T>Arxivdagi e'lonlarim</T></Link>
          </section>
        ) : identityResolved && <>
        {/* Employer card only belongs to the worker/anonymous view. */}
        <section className="card p-5 text-center">
          <div className="flex justify-center">
            <Avatar size="lg" name={e.ownerName} src={e.ownerAvatarUrl} />
          </div>
          <div className="mt-3 font-bold heading">{e.ownerName || "Foydalanuvchi"}</div>
          <div className="mt-1 text-xs inline-flex items-center gap-1 muted">
            <ShieldCheck size={12} className="text-success" /><T>Tasdiqlangan buyurtmachi</T>
          </div>
          {e.contactPhone && (
            <a href={`tel:${e.contactPhone}`} className="btn btn-outline w-full mt-3 gap-2 btn-sm">
              <Phone size={14} />{e.contactPhone}
            </a>
          )}
        </section>

        {/* Xavfsizlik eslatmasi — Figma */}
        <section className="card p-5">
          <h3 className="text-[14px] font-bold heading flex items-center gap-2">
            <ShieldCheck size={16} style={{ color: "var(--brand)" }} /><T>Xavfsizlik eslatmasi</T>
          </h3>
          <p className="mt-2 text-[12.5px] muted leading-relaxed">
            <T>Ish haqi to'g'ridan-to'g'ri ish beruvchi bilan kelishiladi — platforma pul o'tkazmalarida ishtirok etmaydi. Ish boshlanmasdan oldin oldindan pul o'tkazmang.</T>
          </p>
          <Link href="/feedback" className="mt-3 inline-block text-[12.5px] font-semibold text-danger">
            <T>E'lonni shikoyat qilish</T>
          </Link>
        </section>
        </>}
      </aside>

      {isOwner && <OwnerListingActionDialog open={ownerActionOpen} elonId={id} onClose={() => setOwnerActionOpen(false)} />}

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} path={`/elon/${id}`} title={e.title} />

      <Modal open={open} onClose={() => setOpen(false)} title={t("Ariza topshirishni tasdiqlaysizmi?")} footer={
        <>
          <button onClick={() => setOpen(false)} className="btn-secondary"><T>Bekor qilish</T></button>
          <button onClick={() => apply.mutate()} disabled={apply.isPending} className="btn-primary"><T>Tasdiqlash</T></button>
        </>
      }>
        <p className="text-sm muted mb-3"><T>{e.title}</T> — {fmtSumSom(e.perWorkerAmount, e.pricingType === "negotiable")} / <T>kishi boshiga</T></p>
        {(() => {
          const remaining = Math.max(1, (e.workersNeeded || 1) - (e.acceptedCount || 0));
          return (
            <label className="block mb-3">
              <span className="text-sm font-medium"><T>NECHA KISHI BORASIZ?</T></span>
              <div className="mt-1 flex items-center gap-3">
                <button type="button" onClick={() => setPeople((n) => Math.max(1, n - 1))} disabled={people <= 1}
                  className="h-10 w-10 rounded-lg border text-lg font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>−</button>
                <span className="min-w-[2.5rem] text-center text-lg font-bold">{people}</span>
                <button type="button" onClick={() => setPeople((n) => Math.min(remaining, n + 1))} disabled={people >= remaining}
                  className="h-10 w-10 rounded-lg border text-lg font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>+</button>
                <span className="text-xs muted ml-1"><T>Bo'sh o'rin</T>: {remaining}</span>
              </div>
            </label>
          );
        })()}
        <label className="block">
          <span className="text-sm font-medium"><T>TELEFON RAQAMINGIZ</T></span>
          <input className="input mt-1" inputMode="numeric" value={phone} onChange={(ev) => setPhone(fmtPhone(ev.target.value))} placeholder="+998 90 020 25 35" />
        </label>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t("Arizani bekor qilasizmi?")} footer={
        <>
          <button onClick={() => setCancelOpen(false)} className="btn-secondary"><T>Yo'q</T></button>
          <button onClick={() => cancel.mutate()} disabled={cancel.isPending || !cancelReason.trim()} className="btn-danger disabled:opacity-50"><T>Ha, bekor qilish</T></button>
        </>
      }>
        <p className="text-sm muted mb-3"><T>{e.title}</T> — <T>ushbu ishga yuborgan arizangiz bekor qilinadi. Keyinroq qayta ariza topshirishingiz mumkin.</T></p>
        <label className="block">
          <span className="text-sm font-medium"><T>BEKOR QILISH SABABI</T> <span className="text-danger">*</span></span>
          <textarea className="input mt-1" rows={3} value={cancelReason} onChange={(ev) => setCancelReason(ev.target.value)} placeholder={t("Masalan: rejalarim o'zgardi")} />
          {!cancelReason.trim() && <span className="text-xs text-danger mt-1 block"><T>Sababni yozmasangiz bekor qila olmaysiz.</T></span>}
        </label>
      </Modal>

      {/* Xato/ogohlantirish — modal ko'rinishida */}
      <Modal open={!!errMsg} onClose={() => setErrMsg("")} title={t("Ogohlantirish")} footer={
        <button onClick={() => setErrMsg("")} className="btn-primary"><T>Tushunarli</T></button>
      }>
        <p className="text-sm"><T>{errMsg}</T></p>
      </Modal>
    </div>
  );

  /* ── Breadcrumb — Figma: "← Orqaga · Bosh sahifa · Ish e'lonlari · ..." ── */
  const crumbs = (
    <nav className="flex items-center gap-2 text-[13px] muted flex-wrap">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--brand)" }}>
        <ArrowLeft size={15} /><T>Orqaga</T>
      </button>
      <ChevronRight size={13} className="subtle" />
      <Link href={authed ? "/dashboard" : "/"} className="hover:text-[color:var(--text)]"><T>Bosh sahifa</T></Link>
      <ChevronRight size={13} className="subtle" />
      {isOwner && <><Link href="/process?tab=employer" className="hover:text-[color:var(--text)]"><T>Mening arizalarim</T></Link><ChevronRight size={13} className="subtle" /></>}
      <Link href={isOwner ? "/my-elons" : authed ? "/elonlar" : "/login"} className="hover:text-[color:var(--text)]"><T>{isOwner ? "Ish e'lonlarim" : "Ish e'lonlari"}</T></Link>
      <ChevronRight size={13} className="subtle" />
      <span className="truncate max-w-[240px] heading"><T>{e.title}</T></span>
    </nav>
  );

  /* ── Layouts: cabinet (auth) or public (anon) ── */
  if (authed) {
    return (
      <Shell wide>
        <div className={`py-6 flex flex-col gap-5 ${isOwner ? "max-w-[1240px] mx-auto w-full" : ""}`}>
          {crumbs}
          {content}
        </div>
      </Shell>
    );
  }

  // Public (anonymous) view
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b backdrop-blur-md"
              style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card) 92%, transparent)" }}>
        <div className="mx-auto max-w-shell flex h-[72px] items-center justify-between px-5 md:px-10">
          <Logo />
          <div className="flex items-center gap-2">
            <LangMenu />
            <ThemeToggle />
            <Link href="/login" className="btn btn-primary"><T>Kirish</T></Link>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-shell w-full px-5 md:px-10 py-6 flex flex-col gap-4">
        {crumbs}
        {content}
      </main>
    </div>
  );
}

const PRICING_LABEL: Record<string, string> = {
  per_worker: "Har bir ishchi uchun",
  total: "Butun ish uchun",
  negotiable: "Kelishilgan holda",
};

function OwnerStatus({ listing, confirmed }: { listing: Elon; confirmed: boolean }) {
  const status = listing.status;
  const label = status === "cancelled" ? "Bekor qilingan"
    : status === "completed" ? "Yakunlangan"
    : status === "in_progress" ? "Bajarilmoqda"
    : status === "draft" ? "Qoralama"
    : status === "hidden" ? "Yashirilgan"
    : confirmed ? "Tasdiqlangan" : "Faol";
  return <span className={`${["cancelled", "hidden"].includes(status) ? "badge-neutral" : status === "draft" ? "badge-pending" : "badge-success"} uppercase !text-[10px] !tracking-wide`}><T>{label}</T></span>;
}

/** Figma "Ish shartlari" plitkasi: surface/bg, kichik yorliq + qalin qiymat. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface p-3.5">
      <div className="text-[11.5px] subtle"><T>{label}</T></div>
      <div className="mt-1 text-[14px] font-bold heading"><T>{value}</T></div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="muted"><T>{label}</T></span>
      <span className="font-bold heading text-right">{value}</span>
    </div>
  );
}

