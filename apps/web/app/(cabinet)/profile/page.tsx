"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Check, Share2, Pencil, Briefcase, FileText, History,
  Settings, LifeBuoy, ShieldCheck, User as UserIcon, MapPin,
} from "lucide-react";
import { api, Application, Elon, User } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Avatar } from "@/components/ui/Avatar";
import { ShareModal } from "@/components/ShareModal";
import { T } from "@/components/T";

/** Figma "12 · Profil sahifasi": ko'k muqova, profil kartasi, statistika, tasdiqlash. */
export default function MyProfile() {
  const [shareOpen, setShareOpen] = useState(false);

  const { data: me } = useQuery<User>({ queryKey: ["me"], queryFn: () => api.get<User>("/api/me") });
  const { data: myElons } = useQuery<{ active: Elon[]; archived: Elon[] }>({
    queryKey: ["my-elons"],
    queryFn: () => api.get<{ active: Elon[]; archived: Elon[] }>("/api/my/elons"),
  });
  const { data: mine } = useQuery<Application[]>({
    queryKey: ["my-applications"],
    queryFn: () => api.get<Application[]>("/api/my/applications"),
  });

  if (!me) return <Shell title="Mening profilim"><div className="card p-6 muted text-sm"><T>Yuklanmoqda…</T></div></Shell>;

  const fullName = `${me.firstName} ${me.lastName}`.trim();
  const checks = [
    { label: "Telefon raqam", ok: me.isPhoneVerified },
    { label: "Telegram akkaunt", ok: !!me.telegramId },
    { label: "Profil rasmi", ok: !!me.avatarUrl },
    { label: "Hudud ko'rsatilgan", ok: !!me.region },
  ];
  const doneCount = checks.filter((c) => c.ok).length;

  return (
    <Shell wide>
      <div className="py-6 grid lg:grid-cols-[240px_1fr] gap-5 items-start">
        {/* Yon menyu */}
        <nav className="card p-2 hidden lg:flex flex-col gap-0.5 sticky top-[92px]">
          <SideLink href="/profile" icon={<UserIcon size={16} />} label="Profil" active />
          <SideLink href="/settings" icon={<Settings size={16} />} label="Sozlamalar" />
          <SideLink href="/history" icon={<History size={16} />} label="Bajarilgan ishlar" />
          <SideLink href="/my-elons" icon={<Briefcase size={16} />} label="E'lon qilgan ishlar" />
          <SideLink href="/process" icon={<FileText size={16} />} label="Mening arizalarim" />
          <SideLink href="/yordam" icon={<LifeBuoy size={16} />} label="Yordam markazi" />
          <SideLink href="/maxfiylik-siyosati" icon={<ShieldCheck size={16} />} label="Maxfiylik va shartlar" />
        </nav>

        <div className="flex flex-col gap-5 min-w-0">
          {/* Muqova + profil */}
          <section className="card overflow-hidden">
            <div className="gradient-hero h-[110px]" />
            <div className="p-6 pt-0">
              <div className="flex flex-wrap items-start gap-4">
                <div className="-mt-10 rounded-full ring-4" style={{ ["--tw-ring-color" as any]: "var(--card)" }}>
                  <Avatar size="xl" name={fullName} src={me.avatarUrl || undefined} />
                </div>
                <div className="flex-1 min-w-0 pt-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-[22px] font-black heading tracking-[-0.5px]">{fullName || "—"}</h1>
                    {me.isPhoneVerified && (
                      <span className="badge-success"><CheckCircle2 size={12} /><T>Tasdiqlangan</T></span>
                    )}
                    {me.completedJobsCount >= 10 && <span className="badge-amber"><T>Top ishchi</T></span>}
                  </div>
                  <div className="mt-1.5 text-[13.5px] muted flex items-center gap-2 flex-wrap">
                    {(me.skills || []).length > 0 && <span>{(me.skills || []).slice(0, 3).join(" · ")}</span>}
                    {me.region && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={13} className="subtle" />{me.region}{me.district ? `, ${me.district}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Link href="/settings" className="btn btn-primary gap-2 btn-sm"><Pencil size={14} /><T>Profilni tahrirlash</T></Link>
                <button onClick={() => setShareOpen(true)} className="btn btn-soft gap-2 btn-sm">
                  <Share2 size={14} /><T>Profilni ulashish</T>
                </button>
              </div>
            </div>
          </section>

          {/* Statistika */}
          <section className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat value={me.completedJobsCount} label="Bajarilgan ishlar" />
            <Stat value={(myElons?.active.length || 0) + (myElons?.archived.length || 0)} label="Bergan e'lonlarim" />
            <Stat value={mine?.length || 0} label="Yuborgan arizalarim" />
          </section>

          {/* Men haqimda */}
          <section className="card p-6">
            <h2 className="section-title"><T>Men haqimda</T></h2>
            <p className="mt-3 text-[14px] muted leading-relaxed">
              {me.bio ? <T>{me.bio}</T> : <span className="subtle"><T>Hali ma'lumot qo'shilmagan. Sozlamalarda o'zingiz haqingizda yozib qo'ying.</T></span>}
            </p>
            {(me.skills || []).length > 0 && (
              <>
                <div className="mt-5 text-[13px] font-bold heading"><T>Mutaxassisliklar</T></div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(me.skills || []).map((s, i) => (
                    <span key={i} className="chip cursor-default">{s}</span>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Tasdiqlash */}
          <section className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-title"><T>Tasdiqlash</T></h2>
              <span className="text-[13px] subtle">{doneCount}/{checks.length} <T>bajarildi</T></span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {checks.map((c) => (
                <div key={c.label} className="surface flex items-center gap-3 p-3.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                        style={c.ok
                          ? { background: "#DFF5E5", color: "#1A7F3C" }
                          : { background: "var(--bg)", color: "var(--text-subtle)" }}>
                    <Check size={13} />
                  </span>
                  <span className="text-[13.5px] font-semibold heading flex-1"><T>{c.label}</T></span>
                  <span className={c.ok ? "badge-success" : "badge-neutral"}>
                    <T>{c.ok ? "Tasdiqlangan" : "Tasdiqlanmagan"}</T>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} path={`/u/${me.id}`} title={fullName} />
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card p-5 text-center">
      <div className="text-[26px] font-black heading leading-none">{value}</div>
      <div className="mt-1.5 text-[12.5px] subtle"><T>{label}</T></div>
    </div>
  );
}
