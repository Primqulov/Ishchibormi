"use client";
import { useEffect, useState } from "react";
import { api, DashboardStats, AdminStats, DayPoint, NameCount } from "@/lib/api";

export default function AdminDashboard() {
  const [kpi, setKpi] = useState<DashboardStats | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    api.get<DashboardStats>("/api/admin/dashboard", { auth: "admin" } as any).then(setKpi).catch(() => {});
  }, []);
  useEffect(() => {
    api.get<AdminStats>(`/api/admin/stats?days=${days}`, { auth: "admin" } as any).then(setStats).catch(() => {});
  }, [days]);

  const funnel = stats?.funnel || {};
  const funnelRows: NameCount[] = [
    { name: "Yuborilgan", count: funnel["pending"] || 0 },
    { name: "Qabul qilingan", count: funnel["accepted"] || 0 },
    { name: "Rad etilgan", count: funnel["rejected"] || 0 },
    { name: "Bekor qilingan", count: funnel["cancelled"] || 0 },
    { name: "Bajarilgan", count: funnel["completed"] || 0 },
  ];

  return (
    <div className="grid gap-4">
      {/* KPI kartalar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Card label="Jami foydalanuvchi" value={kpi?.users} />
        <Card label="Faol" value={kpi?.activeUsers} />
        <Card label="Bloklangan" value={kpi?.blockedUsers} tone="danger" />
        <Card label="Jami e'lon" value={kpi?.elons} />
        <Card label="Faol e'lon (rec.)" value={kpi?.recruitingElons} />
        <Card label="To'lgan e'lon" value={kpi?.filledElons} />
        <Card label="Bajarilgan ish" value={kpi?.completed} tone="success" />
        <Card label="Bugungi yangi user" value={kpi?.todayUsers} tone="brand" />
        <Card label="Bugungi yangi e'lon" value={kpi?.todayElons} tone="brand" />
        <Card label="Ochiq shikoyat" value={kpi?.openReports} tone="danger" />
        <Card label="Ochiq murojaat" value={kpi?.openFeedback} tone="danger" />
      </div>

      {/* Vaqt oralig'i */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-[color:var(--text-muted)]">O'sish davri:</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`btn-sm rounded-lg px-3 py-1 text-sm ${days === d ? "bg-brand-navy text-white" : "btn-secondary"}`}
          >
            {d} kun
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={`Foydalanuvchi o'sishi (${days} kun)`}>
          <Spark data={stats?.userGrowth || []} />
        </Panel>
        <Panel title={`Yangi e'lonlar (${days} kun)`}>
          <Spark data={stats?.elonGrowth || []} />
        </Panel>
        <Panel title="Arizalar voronkasi">
          <Bars rows={funnelRows} />
        </Panel>
        <Panel title="Eng ommabop turkumlar">
          <Bars rows={stats?.topCategories || []} />
        </Panel>
        <Panel title="Viloyatlar bo'yicha foydalanuvchilar">
          <Bars rows={stats?.regions || []} />
        </Panel>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value?: number; tone?: "danger" | "success" | "brand" }) {
  const color =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "brand" ? "text-[color:var(--brand-navy,inherit)]" : "";
  return (
    <div className="card p-4">
      <div className="text-xs text-[color:var(--text-muted)]">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value ?? "—"}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="font-semibold mb-3 text-sm">{title}</div>
      {children}
    </div>
  );
}

// Spark: minimal inline-SVG area/line chart for a daily series. No external lib.
function Spark({ data }: { data: DayPoint[] }) {
  if (!data.length) return <div className="text-sm text-[color:var(--text-muted)]">Ma'lumot yo'q</div>;
  const w = 600, h = 120, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = pad + i * step;
    const y = h - pad - (d.count / max) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div>
      <div className="text-sm text-[color:var(--text-muted)] mb-1">Jami: <b className="text-[color:var(--text)]">{total}</b> · maks/kun: {max}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="none">
        <path d={area} fill="currentColor" opacity={0.12} className="text-brand-navy" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2} className="text-brand-navy" />
      </svg>
    </div>
  );
}

// Bars: horizontal proportional bars for a labelled count list.
function Bars({ rows }: { rows: NameCount[] }) {
  if (!rows.length) return <div className="text-sm text-[color:var(--text-muted)]">Ma'lumot yo'q</div>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-sm">
          <div className="truncate" title={r.name}>{r.name || "—"}</div>
          <div className="h-2 rounded-full bg-black/10 overflow-hidden">
            <div className="h-full rounded-full bg-brand-navy" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <div className="tabular-nums text-right w-10">{r.count}</div>
        </div>
      ))}
    </div>
  );
}
