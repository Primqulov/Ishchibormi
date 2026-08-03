"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Briefcase, MapPin, Search } from "lucide-react";
import { api, Application, Category, Elon, User } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { JobCard } from "@/components/JobCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { T, useT } from "@/components/T";
import { fmtSum } from "@/lib/format";
import { REGIONS } from "@/lib/regions";

/** Figma "03 · Bosh sahifa": ko'k hero + statistika + kategoriyalar + yangi e'lonlar. */
export default function Dashboard() {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");

  const { data: me } = useQuery<User>({ queryKey: ["me"], queryFn: () => api.get<User>("/api/me") });
  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  const { data: feed, isLoading } = useQuery<{ items: Elon[] }>({
    queryKey: ["feed-latest"],
    queryFn: () => api.get<{ items: Elon[] }>("/api/elons?sort=time&limit=6"),
  });
  const { data: mine } = useQuery<Application[]>({
    queryKey: ["my-applications"],
    queryFn: () => api.get<Application[]>("/api/my/applications"),
  });
  const { data: received } = useQuery<Record<string, Application[]>>({
    queryKey: ["my-elons-applications"],
    queryFn: () => api.get<Record<string, Application[]>>("/api/my/elons/applications"),
  });
  const { data: myElons } = useQuery<{ active: Elon[]; archived: Elon[] }>({
    queryKey: ["my-elons"],
    queryFn: () => api.get<{ active: Elon[]; archived: Elon[] }>("/api/my/elons"),
  });

  const items = feed?.items || [];
  const myApps = mine || [];
  const receivedList = Object.values(received || {}).flat();
  const waiting = myApps.filter((a) => a.status === "pending").length;

  // Profil to'ldirilganligi — real maydonlar asosida.
  const checks = me
    ? [!!me.firstName, !!me.lastName, !!me.phone, me.isPhoneVerified, !!me.avatarUrl, !!me.region, !!me.bio, !!(me.skills && me.skills.length)]
    : [];
  const filled = checks.filter(Boolean).length;
  const percent = checks.length ? Math.round((filled / checks.length) * 100) : 0;

  // "Siz uchun tavsiya" — foydalanuvchi viloyatidagi so'nggi e'lonlar.
  const suggestions = items
    .filter((e) => (me?.region ? e.region === me.region : true))
    .slice(0, 3);

  function goSearch() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (region) p.set("region", region);
    router.push(`/elonlar${p.toString() ? `?${p.toString()}` : ""}`);
  }

  return (
    <Shell wide>
      <div className="py-6 flex flex-col gap-6">
        {/* ── Hero ─────────────────────────────────────── */}
        <section className="gradient-hero rounded-[20px] p-6 sm:p-8 text-white grid lg:grid-cols-[1fr_300px] gap-6 items-center">
          <div className="min-w-0">
            <div className="text-[11.5px] font-bold tracking-[1.2px] uppercase text-white/70">
              <T>Assalomu alaykum</T>{me?.firstName ? `, ${me.firstName}` : ""}
            </div>
            <h1 className="mt-2 text-[26px] sm:text-[30px] font-black tracking-[-0.8px] leading-tight">
              <T>Bugun qanday ish qidiryapsiz?</T>
            </h1>

            {/* Qidiruv paneli */}
            <div className="mt-5 bg-white rounded-[14px] p-1.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 shadow-pop">
              <div className="relative flex-1 min-w-0">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 subtle pointer-events-none" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && goSearch()}
                  placeholder={t("Ish nomi yoki kalit so'z…")}
                  className="w-full bg-transparent pl-11 pr-3 py-3 text-sm outline-none"
                  style={{ color: "var(--text)" }}
                />
              </div>
              <div className="relative sm:border-l sm:pl-2" style={{ borderColor: "var(--border)" }}>
                <MapPin size={15} className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 subtle pointer-events-none" />
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="appearance-none bg-transparent pl-9 sm:pl-10 pr-8 py-2.5 text-sm font-semibold outline-none cursor-pointer w-full"
                  style={{ color: "var(--text)" }}
                >
                  <option value="">{t("Barcha hududlar")}</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button onClick={goSearch} className="btn btn-primary !rounded-[10px] sm:!px-7 !py-3">
                <T>Qidirish</T>
              </button>
            </div>

            {/* Ommabop kategoriyalar */}
            {(cats || []).length > 0 && (
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-white/70"><T>Ommabop</T>:</span>
                {(cats || []).slice(0, 4).map((c) => (
                  <Link
                    key={c.id}
                    href={`/elonlar?categoryId=${c.id}`}
                    className="rounded-full bg-white/15 hover:bg-white/25 transition px-3.5 py-1.5 text-[13px] font-semibold"
                  >
                    <T>{c.name}</T>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Ishchi kerakmi? */}
          <div className="rounded-2xl bg-white/15 p-5 text-center">
            <div className="font-bold text-[17px]"><T>Ishchi kerakmi?</T></div>
            <p className="mt-2 text-[13px] text-white/80 leading-relaxed">
              <T>E'lon joylang — bir necha daqiqada birinchi arizalar keladi.</T>
            </p>
            <Link href="/elon/create" className="btn mt-4 w-full bg-white hover:opacity-90" style={{ color: "var(--brand)" }}>
              <T>E'lon berish</T>
            </Link>
          </div>
        </section>

        {/* ── Statistika ───────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard value={myApps.length}          label="Yuborgan arizalarim"   href="/process"   tone="blue" />
          <StatCard value={receivedList.length}    label="E'lonlarimga arizalar" href="/process"   tone="green" />
          <StatCard value={me?.completedJobsCount || 0} label="Bajarilgan ishlar" href="/history"  tone="amber" />
          <StatCard value={myElons?.active.length || 0} label="Faol e'lonlarim"   href="/my-elons" tone="pink" />
        </section>

        {/* ── Kategoriyalar ────────────────────────────── */}
        {(cats || []).length > 0 && (
          <section>
            <SectionHead title="Kategoriyalar" href="/elonlar" linkLabel="Barchasi" />
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {(cats || []).slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  href={`/elonlar?categoryId=${c.id}`}
                  className="card p-4 flex flex-col items-center gap-2.5 text-center transition hover:-translate-y-0.5 hover:shadow-pop"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl text-xl"
                        style={{ background: "var(--brand-soft)" }}>
                    {c.icon || "🧰"}
                  </span>
                  <div>
                    <div className="text-[13.5px] font-bold heading leading-tight"><T>{c.name}</T></div>
                    <div className="text-[11.5px] subtle mt-0.5">{c.usageCount} <T>ta</T></div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Yangi e'lonlar + yon panel ───────────────── */}
        <section className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
          <div className="min-w-0">
            <SectionHead title="Yangi e'lonlar" href="/elonlar" linkLabel="Barchasini ko'rish" />
            <div className="mt-4 flex flex-col gap-4">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
              ) : items.length === 0 ? (
                <EmptyState
                  icon={<Briefcase size={22} />}
                  title={t("Hozircha e'lonlar yo'q")}
                  body={t("Birinchi e'lonni o'zingiz joylashtiring — u shu yerda ko'rinadi.")}
                  action={<Link href="/elon/create" className="btn btn-primary"><T>E'lon yaratish</T></Link>}
                />
              ) : (
                items.slice(0, 5).map((e) => <JobCard key={e.id} e={e} />)
              )}
            </div>
            {items.length > 0 && (
              <Link href="/elonlar" className="btn btn-soft w-full mt-4 gap-2">
                <T>Barcha e'lonlarni ko'rish</T><ArrowRight size={16} />
              </Link>
            )}
          </div>

          {/* Yon panel */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-[92px]">
            <div className="card p-5">
              <h3 className="section-title mb-3.5"><T>Arizalar holati</T></h3>
              <Row label="Yuborgan arizalarim" value={myApps.length} />
              <Row label="E'lonlarimga kelgan" value={receivedList.length} />
              <Row label="Javob kutayotganlar" value={waiting} />
              <Link href="/process" className="btn btn-soft w-full mt-4"><T>Mening arizalarim</T></Link>
            </div>

            <div className="card p-5">
              <h3 className="section-title"><T>Profil to'ldirilgani</T></h3>
              <div className="mt-3 flex items-center justify-between text-[13px]">
                <span className="muted">{percent}% <T>to'ldirilgan</T></span>
                <span className="font-bold" style={{ color: "var(--brand)" }}>{percent}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-subtle)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: "var(--brand)" }} />
              </div>
              <p className="mt-3 text-[12.5px] subtle leading-relaxed">
                <T>Profil to'liq bo'lsa, ish beruvchilar sizga ko'proq ishonadi.</T>
              </p>
              {percent < 100 && (
                <Link href="/profile" className="btn btn-outline w-full mt-3 btn-sm"><T>Profilni to'ldirish</T></Link>
              )}
            </div>

            {suggestions.length > 0 && (
              <div className="card p-5">
                <h3 className="section-title mb-3"><T>Siz uchun tavsiya</T></h3>
                <div className="flex flex-col gap-2">
                  {suggestions.map((e) => (
                    <Link key={e.id} href={`/elon/${e.id}`} className="surface p-3 transition hover:shadow-card block">
                      <div className="text-[13.5px] font-bold heading line-clamp-1"><T>{e.title}</T></div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[11.5px] subtle inline-flex items-center gap-1 truncate">
                          <MapPin size={12} />{e.locationText || e.region || "—"}
                        </span>
                        <span className="text-[12.5px] font-bold shrink-0" style={{ color: "var(--brand)" }}>
                          {e.pricingType === "negotiable" ? t("Kelishiladi") : `${fmtSum(e.perWorkerAmount || e.priceAmount)} so'm`}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
    </Shell>
  );
}

/* ── helpers ─────────────────────────────────────────── */

const TONE: Record<string, { bg: string; fg: string }> = {
  blue:  { bg: "var(--brand-soft)", fg: "var(--brand)" },
  green: { bg: "#DFF5E5", fg: "#1A7F3C" },
  amber: { bg: "#FFEED4", fg: "#8A5300" },
  pink:  { bg: "#FDE8EF", fg: "#BE185D" },
};

function StatCard({ value, label, href, tone }: { value: number; label: string; href: string; tone: keyof typeof TONE }) {
  const c = TONE[tone];
  return (
    <Link href={href} className="card p-4 flex items-center gap-3.5 transition hover:-translate-y-0.5 hover:shadow-pop">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[17px] font-bold"
            style={{ background: c.bg, color: c.fg }}>
        {value}
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold heading leading-tight"><T>{label}</T></div>
        <div className="text-[11.5px] subtle mt-0.5"><T>Oxirgi 30 kun</T></div>
      </div>
    </Link>
  );
}

function SectionHead({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[19px] font-bold heading tracking-[-0.3px]"><T>{title}</T></h2>
      <Link href={href} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold transition hover:opacity-80"
            style={{ color: "var(--brand)" }}>
        <T>{linkLabel}</T><ArrowRight size={15} />
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-2 text-[13.5px]">
      <span className="muted"><T>{label}</T></span>
      <span className="font-bold" style={{ color: "var(--brand)" }}>{value}</span>
    </div>
  );
}
