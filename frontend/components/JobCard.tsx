"use client";
import { useState } from "react";
import Link from "next/link";
import { MapPin, Clock, Users, Share2 } from "lucide-react";
import { Elon, GENDER_LABEL } from "@/lib/api";
import { fmtSumSom, fromNow } from "@/lib/format";
import { catTone } from "@/lib/cat-color";
import { ShareModal } from "./ShareModal";
import { Avatar } from "./ui/Avatar";
import { T } from "./T";

/**
 * Figma "Card/Job": oq karta (r16), chapda mazmun — teglar, sarlavha (18px bold),
 * meta qatori, ajratgich, e'lon egasi; o'ngda 196px narx paneli (surface/bg, r12).
 */
export function JobCard({ e, compact }: { e: Elon; compact?: boolean }) {
  const negotiable = e.pricingType === "negotiable";
  const [shareOpen, setShareOpen] = useState(false);
  const place = e.locationText || [e.region, e.district].filter(Boolean).join(", ");
  const left = e.workersNeeded - (e.acceptedCount || 0);
  // 24 soat ichida chiqqan e'lon "YANGI" tegi bilan ajratiladi.
  const isNew = e.publishedAt ? Date.now() - new Date(e.publishedAt).getTime() < 24 * 3600 * 1000 : false;

  return (
    <>
      <div className="card p-5 sm:pl-6 sm:pr-5 flex flex-col sm:flex-row gap-5 items-start transition hover:shadow-pop">
        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {e.categoryName && (
              <span className="tag-cat" style={{ background: catTone(e.categoryName).bg, color: catTone(e.categoryName).fg }}>
                <T>{e.categoryName}</T>
              </span>
            )}
            {isNew && <span className="tag-new"><T>Yangi</T></span>}
            {e.workersNeeded > 1 && left > 0 && (
              <span className="badge-neutral">{left} <T>joy qoldi</T></span>
            )}
            {e.workersNeeded > 1 && left <= 0 && <span className="badge-success"><T>Joy to'ldi</T></span>}
            {(e.gender === "male" || e.gender === "female") && (
              <span className="badge-neutral"><T>{GENDER_LABEL[e.gender]}</T></span>
            )}
          </div>

          <Link href={`/elon/${e.id}`} className="block">
            <h3 className="text-[18px] font-bold heading leading-6 tracking-[-0.2px] line-clamp-2 hover:opacity-80 transition">
              <T>{e.title}</T>
            </h3>
          </Link>

          <div className="flex items-center gap-5 flex-wrap text-[13.5px] muted">
            {place && (
              <span className="inline-flex items-center gap-[7px]">
                <MapPin size={15} className="subtle shrink-0" /><T>{place}</T>
              </span>
            )}
            {e.publishedAt && (
              <span className="inline-flex items-center gap-[7px]">
                <Clock size={15} className="subtle shrink-0" />{fromNow(e.publishedAt)}
              </span>
            )}
            <span className="inline-flex items-center gap-[7px]">
              <Users size={15} className="subtle shrink-0" />{e.workersNeeded} <T>ta ishchi</T>
            </span>
          </div>

          {!compact && (
            <>
              <div className="divider" />
              <div className="flex items-center gap-2.5">
                <Avatar name={e.ownerName} src={e.ownerAvatarUrl} size="sm" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold heading truncate">{e.ownerName || "—"}</div>
                  <div className="text-[11.5px] subtle truncate">
                    {e.publishedAt ? fromNow(e.publishedAt) : ""}
                    {place ? ` · ${place}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => setShareOpen(true)}
                  className="ml-auto p-2 rounded-lg subtle hover:text-[color:var(--brand)] hover:bg-[color:var(--brand-soft)] transition"
                  aria-label="Ulashish"
                >
                  <Share2 size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Price panel — Figma: w 196, surface/bg, r12, p18 */}
        <div className="surface w-full sm:w-[196px] shrink-0 p-[18px] flex flex-col items-center gap-2.5">
          <div className="text-center leading-none">
            <div className="text-2xl font-bold tracking-[-0.4px]" style={{ color: "var(--brand)" }}>
              {fmtSumSom(e.perWorkerAmount || e.priceAmount, negotiable).replace(/\s*so'm$/, "")}
            </div>
            <div className="text-xs muted mt-1.5">
              {negotiable ? <T>kelishilgan holda</T> : <T>so'm / kuniga</T>}
            </div>
          </div>
          <Link
            href={`/elon/${e.id}#ariza`}
            className="w-full text-center rounded-[9px] py-[11px] text-[13.5px] font-bold text-white transition hover:opacity-90"
            style={{ background: "var(--brand-light)" }}
          >
            <T>Ariza yuborish</T>
          </Link>
          <Link
            href={`/elon/${e.id}`}
            className="w-full text-center rounded-[9px] py-[9px] text-[13px] font-semibold transition hover:bg-[color:var(--brand-soft)]"
            style={{ color: "var(--brand)" }}
          >
            <T>Batafsil</T>
          </Link>
        </div>
      </div>
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} path={`/elon/${e.id}`} title={e.title} />
    </>
  );
}
