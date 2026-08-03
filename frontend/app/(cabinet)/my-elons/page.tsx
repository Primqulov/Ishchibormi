"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ListChecks, MapPin, Clock, Users, Loader2 } from "lucide-react";
import { api, Application, Elon } from "@/lib/api";
import { Shell, ShellSearch } from "@/components/Shell";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { SlotProgress } from "@/components/ui/SlotProgress";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/Modal";
import { T, useT } from "@/components/T";
import { fmtSum, fromNow } from "@/lib/format";
import { catTone } from "@/lib/cat-color";

type MyElons = { active: Elon[]; archived: Elon[] };

/** Figma "08 · Mening arizalarim — Ish e'lonlarim": e'lon kartalari + arizalar soni. */
export default function MyElons() {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [delId, setDelId] = useState("");

  const { data, isLoading, isFetching, refetch } = useQuery<MyElons>({
    queryKey: ["my-elons"],
    queryFn: () => api.get<MyElons>("/api/my/elons"),
  });
  const { data: received } = useQuery<Record<string, Application[]>>({
    queryKey: ["my-elons-applications"],
    queryFn: () => api.get<Record<string, Application[]>>("/api/my/elons/applications"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/elons/${id}`),
    onSuccess: () => { setDelId(""); qc.invalidateQueries({ queryKey: ["my-elons"] }); },
  });

  const counts = { active: data?.active.length ?? 0, archived: data?.archived.length ?? 0 };
  const list = (data?.[tab] || []).filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell wide>
      <div className="py-6 flex flex-col gap-5">
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[26px] font-black heading tracking-[-0.6px] leading-tight"><T>Mening e'lonlarim</T></h1>
            <p className="text-[13.5px] muted mt-1">
              <T>Siz joylagan ishlar va ularga kelgan arizalar</T>
            </p>
          </div>
          <Link href="/elon/create" className="btn btn-primary gap-1.5"><Plus size={16} /><T>E'lon berish</T></Link>
        </div>

        {/* Tablar — o'ng tomonida qidiruv */}
        <div className="card p-2.5 flex items-center gap-3 flex-wrap">
          {/* Tab tugmalari — qidiruv input/tugmasi bilan bir xil shakl va balandlik */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setTab("active")}
              className={`btn ${tab === "active" ? "btn-primary" : "btn-outline"} gap-2 !h-[46px]`}
            >
              <T>Faol e'lonlar</T>
              <span className={`text-[11px] font-bold ${tab === "active" ? "text-white/75" : "subtle"}`}>{counts.active}</span>
            </button>
            <button
              onClick={() => setTab("archived")}
              className={`btn ${tab === "archived" ? "btn-primary" : "btn-outline"} gap-2 !h-[46px]`}
            >
              <T>Arxiv</T>
              <span className={`text-[11px] font-bold ${tab === "archived" ? "text-white/75" : "subtle"}`}>{counts.archived}</span>
            </button>
          </div>

          {/* Qidiruv: harf kiritilganda ro'yxat darrov filtrlanadi, tugma (yoki
              Enter) bosilganda esa e'lonlar serverdan qaytadan yuklanadi. */}
          <form
            onSubmit={(e) => { e.preventDefault(); refetch(); }}
            className="flex-1 min-w-[220px] sm:max-w-[480px] sm:ml-auto flex items-center gap-2"
          >
            <div className="flex-1 min-w-0">
              <ShellSearch
                value={q}
                onChange={setQ}
                placeholder={t("E'lon nomi bo'yicha qidirish…")}
                className="!h-[46px]"
              />
            </div>
            <button type="submit" disabled={isFetching} className="btn btn-primary shrink-0 gap-1.5 !h-[46px]">
              {isFetching && <Loader2 size={15} className="animate-spin" />}
              <T>Qidirish</T>
            </button>
          </form>
        </div>

        {/* Ro'yxat */}
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={22} />}
            title={t("Hozircha e'lon yo'q")}
            body={
              tab === "archived" ? t("Yakunlangan yoki bekor qilingan e'lonlar shu yerda ko'rinadi.")
              : t("Birinchi e'loningizni yarating va arizalarni qabul qila boshlang.")
            }
            action={<Link href="/elon/create" className="btn btn-primary"><T>E'lon yaratish</T></Link>}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {list.map((e) => {
              const apps = received?.[e.id] || [];
              const pending = apps.filter((a) => a.status === "pending").length;
              return (
                <div key={e.id} className="card p-5 flex flex-col lg:flex-row gap-5">
                  <div className="flex-1 min-w-0 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {e.categoryName && (
                        <span className="tag-cat" style={{ background: catTone(e.categoryName).bg, color: catTone(e.categoryName).fg }}>
                          <T>{e.categoryName}</T>
                        </span>
                      )}
                      <StatusBadge status={e.status} />
                      {e.publishedAt && <span className="text-[12px] subtle">{fromNow(e.publishedAt)} <T>joylandi</T></span>}
                    </div>

                    <Link href={`/elon/${e.id}`}
                          className={`text-[18px] font-bold heading leading-snug hover:opacity-80 transition ${tab === "archived" ? "line-through opacity-70" : ""}`}>
                      <T>{e.title}</T>
                    </Link>

                    <div className="flex items-center gap-5 flex-wrap text-[13px] muted">
                      <span className="inline-flex items-center gap-[7px]">
                        <MapPin size={14} className="subtle" />
                        <T>{e.locationText || [e.region, e.district].filter(Boolean).join(", ") || "—"}</T>
                      </span>
                      {e.startDate && (
                        <span className="inline-flex items-center gap-[7px]">
                          <Clock size={14} className="subtle" />{e.workTimeFrom || "—"}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-[7px]">
                        <Users size={14} className="subtle" />{e.workersNeeded} <T>ta ishchi</T>
                      </span>
                    </div>

                    {tab !== "archived" && <SlotProgress accepted={e.acceptedCount || 0} needed={e.workersNeeded || 1} />}

                    {/* Arizachilar — Figma: avatarlar + "N ta ariza keldi" */}
                    {apps.length > 0 && (
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="flex items-center">
                          {apps.slice(0, 3).map((a, i) => (
                            <span
                              key={a.id}
                              className="rounded-full ring-2"
                              style={{ marginLeft: i === 0 ? 0 : -8, ["--tw-ring-color" as any]: "var(--card)" }}
                            >
                              <Avatar name={a.workerName?.trim() || a.workerPhone} src={a.workerAvatarUrl} size="xs" />
                            </span>
                          ))}
                          {apps.length > 3 && (
                            <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"
                                  style={{ background: "var(--brand-100)", color: "var(--brand)", marginLeft: -8 }}>
                              +{apps.length - 3}
                            </span>
                          )}
                        </div>
                        <span className="text-[13px] muted">{apps.length} <T>ta ariza keldi</T></span>
                        {pending > 0 && <span className="badge-info">{pending} <T>ta yangi</T></span>}
                      </div>
                    )}
                  </div>

                  {/* O'ng ustun — narx va amallar */}
                  <div className="lg:min-w-[320px] shrink-0 flex flex-col gap-3 lg:items-end justify-between">
                    <div className="lg:text-right">
                      <div className="text-[22px] font-bold leading-none" style={{ color: "var(--brand)" }}>
                        {e.pricingType === "negotiable" ? t("Kelishiladi") : fmtSum(e.perWorkerAmount || e.priceAmount)}
                      </div>
                      {e.pricingType !== "negotiable" && <div className="text-[11.5px] muted mt-1.5">so'm / <T>kunlik</T></div>}
                    </div>
                    <div className="flex flex-wrap lg:flex-nowrap gap-2 lg:justify-end">
                      <Link href={`/elon/${e.id}/edit`} className="btn btn-outline btn-sm gap-1.5"><Pencil size={13} /><T>Tahrirlash</T></Link>
                      <button onClick={() => setDelId(e.id)}
                              className="btn btn-sm !bg-transparent text-danger hover:!bg-[rgba(217,45,32,0.08)]">
                        <T>E'lonni o'chirish</T>
                      </button>
                      <Link href="/process" className="btn btn-primary btn-sm"><T>Arizalarni ko'rish</T></Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* O'chirishni tasdiqlash — modal ko'rinishida */}
      <Modal open={!!delId} onClose={() => setDelId("")} title={t("E'lonni o'chirasizmi?")} footer={
        <>
          <button onClick={() => setDelId("")} className="btn-secondary"><T>Yo'q</T></button>
          <button onClick={() => del.mutate(delId)} disabled={del.isPending} className="btn-danger"><T>Ha, o'chirish</T></button>
        </>
      }>
        <p className="text-sm muted"><T>E'lon butunlay o'chiriladi va qayta tiklab bo'lmaydi. Davom etasizmi?</T></p>
      </Modal>
    </Shell>
  );
}
