"use client";
import { useCallback, useEffect, useState } from "react";
import { Megaphone, Send, Clock, Check } from "lucide-react";
import { api, Broadcast, Paged } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

export default function AdminBroadcast() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [region, setRegion] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [schedule, setSchedule] = useState(""); // datetime-local; empty = hozir
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const [hist, setHist] = useState<Paged<Broadcast> | null>(null);
  const [page, setPage] = useState(1);
  const limit = 10;

  const loadHist = useCallback(async () => {
    setHist(await api.get<Paged<Broadcast>>(`/api/admin/broadcasts?page=${page}&limit=${limit}`, { auth: "admin" } as any));
  }, [page]);
  useEffect(() => { loadHist(); }, [loadHist]);

  async function send() {
    setMsg(""); setSending(true);
    try {
      const scheduledAt = schedule ? new Date(schedule).toISOString() : "";
      const r = await api.post<{ recipients: number; status: string }>(
        "/api/admin/broadcast",
        { title, body, region: region.trim(), activeOnly, scheduledAt },
        { auth: "admin" } as any
      );
      setMsg(r.status === "scheduled"
        ? `~${r.recipients} foydalanuvchiga rejalashtirildi`
        : `~${r.recipients} foydalanuvchiga yuborilmoqda (fon jarayonida)`);
      setTitle(""); setBody(""); setSchedule("");
      setPage(1);
      loadHist();
    } catch (e: any) {
      setMsg(e?.message || "Xatolik");
    } finally {
      setSending(false);
    }
  }
  async function cancel(id: string) {
    await api.delete(`/api/admin/broadcasts/${id}`, { auth: "admin" } as any);
    loadHist();
  }

  const items = hist?.items ?? [];
  const pages = Math.max(1, Math.ceil((hist?.total ?? 0) / limit));

  function statusBadge(b: Broadcast) {
    const map: Record<string, { label: string; color: string }> = {
      scheduled: { label: "rejalashtirilgan", color: "var(--brand, #6366f1)" },
      sending: { label: "yuborilmoqda…", color: "var(--warning, #d97706)" },
    };
    const s = map[b.status] ?? { label: "yuborildi", color: "var(--success, #16a34a)" };
    return (
      <span className="inline-flex justify-center items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap"
        style={{ color: s.color, borderColor: s.color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sarlavha — tepada ixcham navbar sifatida */}
      <div className="card flex items-center gap-3 px-4 py-3">
        <div className="shrink-0 grid h-9 w-9 place-items-center rounded-lg" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          <Megaphone size={18} />
        </div>
        <div>
          <h1 className="text-lg font-bold heading leading-tight">Tarqatma</h1>
          <p className="text-xs text-[color:var(--text-muted)]">Foydalanuvchilarga ommaviy xabar yuborish</p>
        </div>
      </div>

      {/* Yuborish formasi */}
      <div className="card p-5 sm:p-6 flex flex-col gap-4">
        <div className="font-semibold heading">Yangi tarqatma</div>

        <label className="text-sm font-medium heading">Sarlavha
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Masalan: Yangilik!" />
        </label>

        <label className="text-sm font-medium heading">Matn
          <textarea className="input mt-1 min-h-[110px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Xabar matni…" />
        </label>

        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <label className="text-sm font-medium heading">Segment: viloyat <span className="text-[color:var(--text-muted)] font-normal">(ixtiyoriy)</span>
            <input className="input mt-1" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Barchasi" />
          </label>
          <label className="flex items-center gap-2.5 text-sm rounded-lg border px-3 py-2.5 cursor-pointer sm:mt-6" style={{ borderColor: "var(--border)" }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            <span>Faqat faol <span className="text-[color:var(--text-muted)]">(bloklanmagan)</span></span>
          </label>
        </div>

        <label className="text-sm font-medium heading flex items-center gap-1.5">
          <Clock size={14} /> Rejalashtirish <span className="text-[color:var(--text-muted)] font-normal">(bo'sh bo'lsa — hozir yuboriladi)</span>
          <input type="datetime-local" className="input mt-1 w-full block basis-full" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </label>

        <button onClick={send} className="btn-primary w-full gap-2" disabled={!title.trim() || sending}>
          {schedule ? <Clock size={16} /> : <Send size={16} />}
          {sending ? "Yuborilmoqda…" : schedule ? "Rejalashtirish" : "Yuborish"}
        </button>

        {msg && (
          <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--success, #16a34a) 12%, transparent)", color: "var(--success, #16a34a)" }}>
            <Check size={16} /> {msg}
          </div>
        )}
        <p className="text-xs text-[color:var(--text-muted)]">Yuborish fon jarayonida bajariladi — ko'p foydalanuvchi bo'lsa ham sahifa kutib qolmaydi.</p>
      </div>

      {/* Tarixi */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold heading text-sm" style={{ borderColor: "var(--border)" }}>Tarqatmalar tarixi</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm table-fixed">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[color:var(--text-muted)] border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-3 px-4">Sarlavha</th><th className="px-4">Segment</th><th className="px-4">Yuborilgan</th><th className="px-4">Holat</th><th className="px-4">Vaqt</th><th className="px-4 text-right">Amal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-3 px-4 font-medium truncate">{b.title}</td>
                  <td className="px-4 text-[color:var(--text-muted)] truncate">{[b.region || "barcha viloyat", b.activeOnly ? "faol" : "hammasi"].join(" · ")}</td>
                  <td className="px-4">{b.sentCount}</td>
                  <td className="px-4">{statusBadge(b)}</td>
                  <td className="px-4 whitespace-nowrap">{new Date(b.scheduledAt || b.createdAt).toLocaleString("uz-UZ")}</td>
                  <td className="px-4 text-right">
                    {b.status === "scheduled" && <button onClick={() => cancel(b.id)} className="btn-secondary btn-sm">Bekor</button>}
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className="py-8 text-center text-[color:var(--text-muted)]">Hali tarqatma yo'q</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3"><Pagination page={page} pages={pages} onPage={setPage} /></div>
      </div>
    </div>
  );
}
