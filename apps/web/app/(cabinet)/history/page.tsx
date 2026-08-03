"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, Application } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import {
  Search, Users, User as UserIcon, Settings, History as HistoryIcon,
  Briefcase, FileText, LifeBuoy, ShieldCheck,
} from "lucide-react";
import { T, useT } from "@/components/T";
import { fmtDate, fmtSum, fmtSumSom } from "@/lib/format";
import dayjs from "dayjs";

function shortReason(s: string, max = 50) {
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

const RANGES: [string, string][] = [
  ["month", "Bu oy"],
  ["3m", "3 oy"],
  ["year", "Bu yil"],
  ["", "Barchasi"],
];

/** Figma "15 · Bajarilgan ishlar tarixi": yon menyu, ko'k jamlanma, jadval. */
export default function History() {
  const t = useT();
  const [q, setQ] = useState("");
  const [reasonView, setReasonView] = useState<Application | null>(null);
  const [status, setStatus] = useState<string>("");
  const [range, setRange] = useState<string>("");

  const { data } = useQuery<Application[]>({
    queryKey: ["history"],
    queryFn: () => api.get<Application[]>("/api/me/history"),
  });

  const list = useMemo(() => {
    let arr = data || [];
    if (q) arr = arr.filter((a) => a.elonTitle.toLowerCase().includes(q.toLowerCase()));
    if (status) arr = arr.filter((a) => a.status === status);
    if (range) {
      const cut = ({
        month: dayjs().startOf("month"),
        "3m": dayjs().subtract(3, "month"),
        year: dayjs().startOf("year"),
      } as any)[range];
      if (cut) arr = arr.filter((a) => dayjs(a.completedAt || a.decidedAt || a.appliedAt).isAfter(cut));
    }
    return arr;
  }, [data, q, status, range]);

  // Jamlanma — faqat yakunlangan ishlar bo'yicha (kelishilganlar summaga kirmaydi).
  const completed = list.filter((a) => a.status === "completed");
  const total = completed.reduce((s, a) => s + (a.isNegotiable ? 0 : a.amount || 0), 0);
  const avg = completed.length ? Math.round(total / completed.length) : 0;

  return (
    <Shell wide>
      <div className="py-6 grid lg:grid-cols-[240px_1fr] gap-5 items-start">
        {/* Yon menyu */}
        <nav className="card p-2 hidden lg:flex flex-col gap-0.5 sticky top-[92px]">
          <SideLink href="/profile" icon={<UserIcon size={16} />} label="Profil" />
          <SideLink href="/settings" icon={<Settings size={16} />} label="Sozlamalar" />
          <SideLink href="/history" icon={<HistoryIcon size={16} />} label="Bajarilgan ishlar" active />
          <SideLink href="/my-elons" icon={<Briefcase size={16} />} label="E'lon qilgan ishlar" />
          <SideLink href="/process" icon={<FileText size={16} />} label="Mening arizalarim" />
          <SideLink href="/yordam" icon={<LifeBuoy size={16} />} label="Yordam markazi" />
          <SideLink href="/maxfiylik-siyosati" icon={<ShieldCheck size={16} />} label="Maxfiylik va shartlar" />
        </nav>

        <div className="flex flex-col gap-5 min-w-0">
          <div>
            <h1 className="text-[26px] font-black heading tracking-[-0.6px] leading-tight"><T>Bajarilgan ishlar</T></h1>
            <p className="text-[13.5px] muted mt-1">
              {completed.length} <T>ta yakunlangan ish</T>
            </p>
          </div>

          {/* Ko'k jamlanma karta */}
          <section className="gradient-hero rounded-2xl p-6 text-white flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] font-bold tracking-[1.2px] uppercase text-white/70">
                <T>Bajarilgan ishlar qiymati</T>
              </div>
              <div className="mt-2 text-[30px] font-black tracking-[-1px] leading-none">{fmtSum(total)} so'm</div>
              <p className="mt-2.5 text-[12.5px] text-white/75">
                <T>To'lovlar ish beruvchi bilan to'g'ridan-to'g'ri amalga oshiriladi</T>
              </p>
            </div>
            <div className="flex gap-8">
              <div>
                <div className="text-[22px] font-black leading-none">{completed.length}</div>
                <div className="mt-1 text-[11.5px] text-white/70"><T>Bajarilgan</T></div>
              </div>
              <div>
                <div className="text-[22px] font-black leading-none">{fmtSum(avg)}</div>
                <div className="mt-1 text-[11.5px] text-white/70"><T>O'rtacha narx</T></div>
              </div>
            </div>
          </section>

          {/* Filtrlar */}
          <div className="card p-3.5 flex items-center gap-2.5 flex-wrap">
            <span className="text-[13.5px] muted"><T>Davr</T>:</span>
            {RANGES.map(([v, l]) => (
              <button key={l} onClick={() => setRange(v)} className={`chip ${range === v ? "chip-active" : ""}`}>
                <T>{l}</T>
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-[240px]">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 subtle pointer-events-none" />
              <input className="input !py-2 !pl-10 !rounded-full" placeholder={t("Qidiruv…")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          <div className="card p-2.5 flex items-center gap-2 flex-wrap">
            <button onClick={() => setStatus("")} className={`chip ${!status ? "chip-active" : ""}`}><T>Barchasi</T></button>
            <button onClick={() => setStatus("completed")} className={`chip ${status === "completed" ? "chip-active" : ""}`}><T>Bajarildi</T></button>
            <button onClick={() => setStatus("cancelled")} className={`chip ${status === "cancelled" ? "chip-active" : ""}`}><T>Bekor qilindi</T></button>
            <button onClick={() => setStatus("rejected")} className={`chip ${status === "rejected" ? "chip-active" : ""}`}><T>Rad etildi</T></button>
          </div>

          {/* Jadval */}
          <section className="card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_150px_110px_130px] gap-3 px-5 py-3 border-b text-[11.5px] font-bold uppercase tracking-[0.6px] subtle"
                 style={{ borderColor: "var(--border)" }}>
              <span><T>Ish</T></span>
              <span><T>Ish beruvchi</T></span>
              <span><T>Sana</T></span>
              <span className="text-right"><T>Summa</T></span>
            </div>

            {list.length === 0 && <div className="p-10 text-center muted text-sm"><T>Hozircha yozuv yo'q.</T></div>}

            {list.map((a) => (
              <div key={a.id}
                   className="grid sm:grid-cols-[1fr_150px_110px_130px] gap-2 sm:gap-3 px-5 py-4 border-b last:border-b-0 items-center"
                   style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <Link href={`/elon/${a.elonId}`}
                        className={`text-[14px] font-bold heading hover:opacity-80 transition ${a.status !== "completed" ? "line-through opacity-70" : ""}`}>
                    <T>{a.elonTitle}</T>
                  </Link>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] subtle inline-flex items-center gap-1">
                      <Users size={12} />{a.peopleCount || 1} <T>kishi</T>
                    </span>
                    <span className="sm:hidden"><StatusBadge status={a.status} /></span>
                  </div>
                  {a.status === "cancelled" && (
                    <div className="text-[11.5px] text-danger mt-1">
                      <T>{a.cancelledBy === "worker" ? "Ishchi tomonidan bekor qilingan" : "Ish beruvchi tomonidan bekor qilingan"}</T>
                      {a.cancelReason && <> — <span className="muted"><T>{shortReason(a.cancelReason)}</T></span></>}
                      {a.cancelReason && a.cancelReason.length > 50 && (
                        <button onClick={() => setReasonView(a)} className="ml-1 font-semibold" style={{ color: "var(--brand)" }}>
                          <T>Batafsil</T>
                        </button>
                      )}
                    </div>
                  )}
                  {a.status === "rejected" && (
                    <div className="text-[11.5px] muted mt-1"><T>Ish beruvchi tomonidan qabul qilinmagan</T></div>
                  )}
                </div>

                <div className="text-[13px] muted truncate">{a.ownerName || "—"}</div>
                <div className="text-[13px] muted">{fmtDate(a.completedAt || a.decidedAt || a.appliedAt)}</div>
                <div className="sm:text-right flex sm:block items-center gap-2">
                  <span className={`text-[14px] font-bold ${a.status !== "completed" ? "line-through muted" : ""}`}
                        style={a.status === "completed" ? { color: "var(--brand)" } : undefined}>
                    {fmtSumSom(a.amount, a.isNegotiable)}
                  </span>
                  <span className="hidden sm:block mt-1"><StatusBadge status={a.status} /></span>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>

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

function SideLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Link href={href} className={`sidenav-item ${active ? "sidenav-item-active" : ""}`}>
      {icon}<T>{label}</T>
    </Link>
  );
}
