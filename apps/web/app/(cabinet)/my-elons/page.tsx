"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ListChecks, MapPin, Clock, Loader2, MoreHorizontal, Send, Megaphone, Eye } from "lucide-react";
import { api, Application, Elon, Notification } from "@/lib/api";
import { Shell, ShellSearch } from "@/components/Shell";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { OwnerListingActionDialog } from "@/components/OwnerListingActionDialog";
import { T, useT } from "@/components/T";
import { fmtSum, fmtWhen, fromNow } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { isOwnerClosable, isOwnerEditable, loadAllOwnerApplications, MyElons } from "@/lib/owner-listing";

type ListingTab = "active" | "draft" | "completed" | "cancelled" | "archived";
type OwnerAction = { id: string; intent: "delete" | "close" };

export default function MyElonsPage() {
  return <Suspense fallback={<div className="p-8 text-center muted"><T>Yuklanmoqda…</T></div>}><MyListings /></Suspense>;
}

function MyListings() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const requestedTab = searchParams.get("tab");
  const tab: ListingTab = ["draft", "completed", "cancelled", "archived"].includes(requestedTab || "") ? requestedTab as ListingTab : "active";
  const [q, setQ] = useState("");
  const [action, setAction] = useState<OwnerAction | null>(null);
  const [menu, setMenu] = useState("");

  const { data, isLoading, isFetching, isError, refetch } = useQuery<MyElons>({
    queryKey: ["my-elons"], queryFn: () => api.get<MyElons>("/api/my/elons", { cache: "no-store" }),
  });
  const applicationsQuery = useQuery<Record<string, Application[]>>({
    queryKey: ["my-elons-applications"], queryFn: ({ signal }) => loadAllOwnerApplications(signal),
  });
  const { data: mine } = useQuery<Application[]>({ queryKey: ["my-applications"], queryFn: () => api.get<Application[]>("/api/my/applications") });
  const { data: notifications } = useQuery<Notification[]>({ queryKey: ["notifications"], queryFn: () => api.get<Notification[]>("/api/notifications") });
  const unreadIds = new Set((notifications || []).filter((item) => !item.isRead && item.relatedEntity?.type === "application").map((item) => item.relatedEntity!.id));
  const allListings = useMemo(() => Array.from(new Map(
    [...(data?.active || []), ...(data?.drafts || []), ...(data?.archived || [])].map((listing) => [listing.id, listing]),
  ).values()), [data]);
  // The API also archives expired open listings; status alone cannot determine visibility.
  const archivedIds = new Set((data?.archived || []).map((listing) => listing.id));
  const groups: Record<ListingTab, Elon[]> = {
    active: allListings.filter((listing) => !listing.isDeleted && !archivedIds.has(listing.id) && ["recruiting", "filled", "confirmed", "in_progress"].includes(listing.status)),
    draft: allListings.filter((listing) => !listing.isDeleted && listing.status === "draft"),
    completed: allListings.filter((listing) => listing.status === "completed"),
    cancelled: allListings.filter((listing) => listing.status === "cancelled"),
    archived: allListings.filter((listing) => listing.status !== "draft" && (archivedIds.has(listing.id) || !isOwnerClosable(listing))),
  };
  const list = groups[tab].filter((listing) => listing.title.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()))
    .sort((a, b) => (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt));
  const filters: { key: ListingTab; label: string }[] = [
    { key: "active", label: "Faol e'lonlar" }, { key: "draft", label: "Qoralama" },
    { key: "completed", label: "Yakunlangan" }, { key: "cancelled", label: "Bekor qilingan" },
  ];
  if (tab === "archived" || groups.archived.some((listing) => !["completed", "cancelled"].includes(listing.status))) filters.push({ key: "archived", label: "Arxiv" });
  function selectTab(nextTab: ListingTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    setMenu("");
    router.replace(`/my-elons?${params}`, { scroll: false });
  }
  function openAction(id: string, intent: "close" | "delete") { setMenu(""); setAction({ id, intent }); }

  return <Shell wide>
    <div className="py-7 flex flex-col gap-5 max-w-[1240px] mx-auto w-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[26px] font-black heading tracking-[-0.6px] leading-tight"><T>Mening arizalarim</T></h1>
          <p className="text-[13.5px] muted mt-1"><T>Yuborgan arizalaringiz va e'lonlaringizga kelgan arizalar — bir joyda</T></p>
        </div>
        <Link href="/elon/create" className="btn btn-primary gap-1.5"><Plus size={16} /><T>E'lon berish</T></Link>
      </div>
      <div className="card p-1.5 grid sm:grid-cols-2 gap-2">
        <ListingMode href="/process" icon={<Send size={18} />} title="Ishga arizalarim" subtitle="Men yuborgan arizalar" count={mine?.length} />
        <ListingMode href="/my-elons" icon={<Megaphone size={18} />} title="Ish e'lonlarim" subtitle="Menga kelgan arizalar" count={data ? allListings.length : undefined} active />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap" aria-label={t("E'lon holati")}>
          {filters.map((filter) => <button key={filter.key} type="button" aria-pressed={tab === filter.key} onClick={() => selectTab(filter.key)} className={`chip ${tab === filter.key ? "chip-active" : ""}`}>
            <T>{filter.label}</T><span className={`text-[11px] font-bold ${tab === filter.key ? "text-white/75" : "subtle"}`}>{data ? groups[filter.key].length : "—"}</span>
          </button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void refetch(); }} className="flex-1 min-w-[220px] sm:max-w-[400px] sm:ml-auto flex items-center gap-2">
          <div className="flex-1 min-w-0"><ShellSearch value={q} onChange={setQ} placeholder={t("E'lon nomi bo'yicha qidirish…")} className="!h-[38px]" /></div>
          <button type="submit" disabled={isFetching} className="btn btn-outline shrink-0 gap-1.5 !h-[38px] !px-3">{isFetching && <Loader2 size={14} className="animate-spin" />}<T>Qidirish</T></button>
        </form>
      </div>
      {applicationsQuery.isError && <div role="alert" className="card p-4 text-sm muted flex flex-wrap items-center justify-between gap-3">
        <T>Arizalarni yuklab bo'lmadi.</T><button type="button" onClick={() => void applicationsQuery.refetch()} className="btn btn-outline btn-sm"><T>Qayta urinish</T></button>
      </div>}
      {isLoading ? <div className="flex flex-col gap-4">{[0, 1, 2].map((i) => <CardSkeleton key={i} />)}</div> : isError ? (
        <div role="alert" className="card p-8 grid justify-items-center gap-4 text-sm muted"><T>E'lonlarni yuklab bo'lmadi.</T><button type="button" onClick={() => void refetch()} className="btn btn-outline"><T>Qayta urinish</T></button></div>
      ) : list.length === 0 ? <EmptyState icon={<ListChecks size={22} />} title={t(q.trim() ? "E'lon topilmadi" : "Hozircha e'lon yo'q")}
        body={t(q.trim() ? "Boshqa nom bilan qidirib ko'ring." : ["archived", "cancelled", "completed"].includes(tab) ? "Yakunlangan yoki bekor qilingan e'lonlar shu yerda ko'rinadi." : "Birinchi e'loningizni yarating va arizalarni qabul qila boshlang.")}
        action={!q.trim() && <Link href="/elon/create" className="btn btn-primary"><T>E'lon yaratish</T></Link>} /> : <div className="flex flex-col gap-4">{list.map((listing) => {
        const applications = applicationsQuery.data ? applicationsQuery.data[listing.id] || [] : undefined;
        const newCount = applications?.filter((application) => application.status === "pending" && unreadIds.has(application.id)).length || 0;
        return <article key={listing.id} className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {listing.categoryName && <span className="tag-cat" style={{ background: catTone(listing.categoryName).bg, color: catTone(listing.categoryName).fg }}><T>{listing.categoryName}</T></span>}
                {archivedIds.has(listing.id) && isOwnerClosable(listing) ? <span className="badge-neutral"><T>Muddati o'tgan</T></span>
                  : listing.status === "recruiting" || listing.status === "confirmed" ? <span className="badge-success"><T>{listing.status === "confirmed" ? "Tasdiqlangan" : "Faol"}</T></span> : <StatusBadge status={listing.status} />}
                {listing.publishedAt && <span className="text-[12px] subtle">{fromNow(listing.publishedAt)} <T>joylandi</T></span>}
              </div>
              <Link href={`/elon/${listing.id}`} className="block mt-2 text-[17px] font-bold heading leading-snug hover:opacity-80 transition"><T>{listing.title}</T></Link>
              <div className="mt-2 flex items-center gap-4 flex-wrap text-[12.5px] muted">
                <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="shrink-0" /><T>{listing.locationText || [listing.region, listing.district].filter(Boolean).join(", ") || "—"}</T></span>
                {listing.startDate && <span className="inline-flex items-center gap-1.5"><Clock size={14} />{fmtWhen(listing.startDate, listing.workTimeFrom)}</span>}
                {typeof listing.viewsCount === "number" && <span className="inline-flex items-center gap-1.5"><Eye size={14} />{fmtSum(listing.viewsCount)} <T>ta ko'rish</T></span>}
              </div>
            </div>
            <div className="text-right shrink-0 pt-5 max-w-[40%]">
              <div className="text-[20px] sm:text-[22px] font-bold leading-none break-words" style={{ color: "var(--brand)" }}>{listing.pricingType === "negotiable" ? t("Kelishiladi") : fmtSum(listing.pricingType === "per_worker" ? listing.perWorkerAmount : listing.priceAmount)}</div>
              {listing.pricingType !== "negotiable" && <div className="text-[11.5px] muted mt-1">so'm / <T>{listing.pricingType === "total" ? "Butun ish uchun" : "Har bir ishchi uchun"}</T></div>}
            </div>
          </div>
          <div className="divider my-4" />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              {applications && applications.length > 0 && <div className="flex items-center">
                {applications.slice(0, 3).map((application, index) => <span key={application.id} className="rounded-full ring-2" style={{ marginLeft: index ? -8 : 0, ["--tw-ring-color" as string]: "var(--card)" }}><Avatar name={application.workerName} src={application.workerAvatarUrl} size="sm" /></span>)}
                {applications.length > 3 && <span className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold ring-2" style={{ background: "var(--brand-soft)", color: "var(--brand)", marginLeft: -8, ["--tw-ring-color" as string]: "var(--card)" }}>+{applications.length - 3}</span>}
              </div>}
              <span className="text-[13px] font-semibold heading">{applications?.length ?? "—"} <T>ta ariza keldi</T></span>
              {newCount > 0 && <span className="badge-info">{newCount} <T>ta yangi</T></span>}
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {isOwnerEditable(listing) && <Link href={`/elon/${listing.id}/edit`} className="btn btn-sm" style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}><T>Tahrirlash</T></Link>}
              {isOwnerClosable(listing) && <button type="button" onClick={() => openAction(listing.id, "close")} className="btn btn-sm" style={{ background: "var(--bg-subtle)", color: "#ba1a1a" }}><T>E'lonni yopish</T></button>}
              <Link href={`/process?tab=employer&elon=${encodeURIComponent(listing.id)}`} className="btn btn-primary btn-sm"><T>Arizalarni ko'rish</T></Link>
              <ListingMenu listing={listing} open={menu === listing.id} onToggle={() => setMenu(menu === listing.id ? "" : listing.id)} onClose={() => setMenu("")} onAction={openAction} />
            </div>
          </div>
        </article>;
      })}</div>}
    </div>
    {action && <OwnerListingActionDialog open elonId={action.id} intent={action.intent} onClose={() => setAction(null)} onChanged={(listing) => {
      qc.setQueryData<MyElons>(["my-elons"], (previous) => previous ? {
        active: previous.active.filter((item) => item.id !== listing.id), drafts: previous.drafts?.filter((item) => item.id !== listing.id),
        archived: [...previous.archived.filter((item) => item.id !== listing.id), listing],
      } : previous);
    }} />}
  </Shell>;
}

function ListingMode({ href, icon, title, subtitle, count, active = false }: { href: string; icon: React.ReactNode; title: string; subtitle: string; count?: number; active?: boolean }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className="rounded-xl p-4 flex items-center gap-3" style={active ? { background: "var(--brand)", color: "white" } : undefined}>
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ background: active ? "rgba(255,255,255,.15)" : "var(--bg-subtle)" }}>{icon}</span>
    <span className="flex-1"><span className="block text-[14px] font-bold"><T>{title}</T></span><span className={`block mt-0.5 text-[12px] ${active ? "text-white/75" : "subtle"}`}><T>{subtitle}</T></span></span>
    <span className="rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ background: active ? "rgba(255,255,255,.2)" : "var(--brand-soft)", color: active ? "white" : "var(--brand)" }}>{count ?? "—"}</span>
  </Link>;
}

function ListingMenu({ listing, open, onToggle, onClose, onAction }: { listing: Elon; open: boolean; onToggle: () => void; onClose: () => void; onAction: (id: string, intent: "close" | "delete") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const t = useT();
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) closeRef.current(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
        const current = items.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard); };
  }, [open]);
  const itemClass = "block w-full rounded-lg px-3 py-2.5 text-left text-[13px] font-medium hover:bg-[color:var(--bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--brand)]";
  return <div ref={ref} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onClose(); }}>
    <button ref={trigger} type="button" aria-label={t("E'lon amallari")} aria-haspopup="menu" aria-expanded={open} onClick={onToggle} className="btn btn-soft btn-sm !px-2.5"><MoreHorizontal size={20} /></button>
    {open && <div role="menu" aria-label={t("E'lon amallari")} className="card-elevated absolute right-0 top-full mt-2 z-20 w-[248px] max-w-[calc(100vw-3rem)] p-1.5">
      <Link role="menuitem" onClick={onClose} href={`/elon/${listing.id}`} className={itemClass}><T>E'lonni ko'rish</T></Link>
      {isOwnerEditable(listing) && <Link role="menuitem" onClick={onClose} href={`/elon/${listing.id}/edit`} className={itemClass}><T>Tahrirlash</T></Link>}
      {isOwnerClosable(listing) && <><div className="divider my-1" /><button role="menuitem" type="button" onClick={() => onAction(listing.id, "close")} className={itemClass}><T>E'lonni yopish (arxivlash)</T></button><button role="menuitem" type="button" onClick={() => onAction(listing.id, "delete")} className={itemClass} style={{ color: "#ba1a1a", background: "color-mix(in srgb, #ba1a1a 6%, var(--card))" }}><T>E'lonni o'chirish</T></button></>}
    </div>}
  </div>;
}
