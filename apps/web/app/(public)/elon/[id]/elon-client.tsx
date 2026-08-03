"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Info, Users, Calendar, MapPin, FileText, ShieldCheck, ChevronRight,
  Phone, Send, Share2, Image as ImageIcon, X, RefreshCw, ArrowLeft,
} from "lucide-react";
import { api, Elon, getAccess, GENDER_LABEL } from "@/lib/api";
import { Modal } from "@/components/Modal";
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
import { safeHref } from "@/lib/url";
import dayjs from "dayjs";

export default function ElonDetails() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [people, setPeople] = useState(1);
  const [cancelReason, setCancelReason] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [status, setStatus] = useState<"none" | "pending" | "accepted">("none");
  const [appId, setAppId] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const has = !!getAccess();
    setAuthed(has);
    if (has) {
      api.get<any>("/api/me").then((u) => { setMe(u); setPhone(u.phone ? fmtPhone(u.phone) : ""); }).catch(() => {});
      api.get<any[]>("/api/my/applications").then((apps) => {
        const mine = apps.find((a) => a.elonId === id);
        if (mine) {
          setAppId(mine.id);
          setStatus(mine.status === "accepted" ? "accepted" : mine.status === "pending" ? "pending" : "none");
        }
      }).catch(() => {});
    }
  }, [id]);

  const { data: e } = useQuery<Elon>({
    queryKey: ["elon", id],
    queryFn: () => api.get<Elon>(`/api/elons/${id}`, { auth: "none" } as any),
    enabled: !!id,
  });

  const apply = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/api/elons/${id}/apply`, { phone, peopleCount: people }),
    onSuccess: (res) => { setOpen(false); setStatus("pending"); if (res?.id) setAppId(res.id); },
    // Masalan "shu kunga boshqa ishga qabul qilingansiz" — ogohlantirish
    // ishchiga modal oynada ko'rsatiladi.
    onError: (e: any) => { setOpen(false); setErrMsg(e?.message || "Xatolik yuz berdi"); },
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/applications/${appId}/cancel`, { reason: cancelReason.trim() }),
    onSuccess: () => { setCancelOpen(false); setCancelReason(""); setStatus("none"); setAppId(""); },
    onError: (e: any) => { setCancelOpen(false); setErrMsg(e?.message || "Xatolik yuz berdi"); },
  });

  if (!e) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="muted text-sm"><T>Yuklanmoqda…</T></div>
      </div>
    );
  }
  const isOwner = me && me.id === e.ownerId;
  // 24 soat ichida joylangan e'lon "Yangi" tegini oladi.
  const isNew = e.publishedAt ? Date.now() - new Date(e.publishedAt).getTime() < 24 * 3600 * 1000 : false;
  const dateLine = e.startDate
    ? `${dayjs(e.startDate).format("D-MMM")}${e.workTimeFrom ? `, ${e.workTimeFrom}` : ""}${e.workTimeTo ? ` - ${e.workTimeTo}` : ""}`
    : "—";
  const hasCoords = !!(e.lat && e.lng);

  /* ── inner content (shared between auth/anon) ── */
  const content = (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
      {/* ── Main column ─────────────── */}
      <div className="grid gap-5 min-w-0">
        {/* Sarlavha kartasi — Figma: teglar, sarlavha, meta qatori */}
        <section className="card p-6">
          <div className="flex items-center gap-2 flex-wrap">
            {e.categoryName && (
              <span className="tag-cat" style={{ background: catTone(e.categoryName).bg, color: catTone(e.categoryName).fg }}>
                <T>{e.categoryName}</T>
              </span>
            )}
            {isNew && <span className="tag-new"><T>Yangi</T></span>}
            {(e.gender === "male" || e.gender === "female") && (
              <span className="badge-neutral"><T>{GENDER_LABEL[e.gender]}</T></span>
            )}
            <StatusBadge status={e.status} />
          </div>
          <h1 className="mt-3 text-[24px] sm:text-[26px] font-black heading tracking-[-0.6px] leading-tight">
            <T>{e.title}</T>
          </h1>
          <div className="mt-3 flex items-center gap-5 flex-wrap text-[13.5px] muted">
            <span className="inline-flex items-center gap-[7px]">
              <MapPin size={15} className="subtle" />
              <T>{[e.region, e.district].filter(Boolean).join(", ") || e.locationText || "Manzil ko'rsatilmagan"}</T>
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
            <FileText size={18} /><T>Ish tavsifi</T>
          </h2>
          <p className="text-[14px] leading-relaxed whitespace-pre-line muted">
            <T>{e.description}</T>
          </p>
        </section>

        {/* Ish shartlari — Figma: kichik plitkalar */}
        <section className="card p-6">
          <h2 className="section-title flex items-center gap-2 mb-4">
            <Info size={18} /><T>Ish shartlari</T>
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
          <h2 className="section-title flex items-center gap-2 mb-4">
            <MapPin size={18} /><T>Manzil</T>
          </h2>
          <div className="grid gap-3">
            <div className="font-semibold flex items-center gap-1.5">
              <MapPin size={15} className="muted" />
              <T>{e.region || "Manzil ko'rsatilmagan"}</T>{e.district ? <span className="muted font-normal">, <T>{e.district}</T></span> : null}
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
              {e.images.map((src, i) => (
                <a
                  key={src}
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="relative aspect-square rounded-xl overflow-hidden border block"
                  style={{ borderColor: "var(--border)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`${e.title} ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition" />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Right column — Figma: yopishqoq narx paneli ────────────── */}
      <aside id="ariza" className="grid gap-4 content-start lg:sticky lg:top-[92px] scroll-mt-24">
        <section className="card p-5">
          <div className="text-[13px] muted"><T>Ish haqi</T></div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-[32px] font-black leading-none tracking-[-1px]" style={{ color: "var(--brand)" }}>
              {e.pricingType === "negotiable" ? t("Kelishiladi") : fmtSum(e.perWorkerAmount || e.priceAmount)}
            </span>
            {e.pricingType !== "negotiable" && <span className="text-[13px] muted pb-1">so'm</span>}
          </div>
          <div className="mt-1.5 text-[12.5px] subtle">
            <T>{PRICING_LABEL[e.pricingType]}</T> · {e.workersNeeded} <T>kishi</T>
          </div>

          <div className="divider my-4" />
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            <Row label="Jami summa" value={fmtSumSom(e.priceAmount, e.pricingType === "negotiable")} />
            <Row label="Ariza berish" value={t("Bepul")} />
            <Row label="Xizmat haqi" value={t("Bepul")} />
          </div>

          {/* Actions */}
          <div className="mt-4 grid gap-2">
            {!isOwner && status === "none" && (
              <button onClick={() => authed ? setOpen(true) : router.push("/login")} className="btn btn-primary w-full !py-3.5 gap-2">
                <Send size={16} /><T>Ariza yuborish</T>
              </button>
            )}
            {!isOwner && status === "pending" && (
              <>
                <div className="w-full rounded-lg py-3 badge-pending justify-center"><T>Ariza yuborilgan — javob kutilmoqda</T></div>
                <button onClick={() => setCancelOpen(true)} disabled={!appId} className="btn btn-outline w-full gap-2 !text-danger disabled:opacity-50"
                        style={{ borderColor: "rgba(217,45,32,0.3)" }}>
                  <X size={16} /><T>Arizani bekor qilish</T>
                </button>
              </>
            )}
            {!isOwner && status === "accepted" && (
              <div className="w-full rounded-lg py-3 badge-success justify-center"><T>Ish qabul qilindi</T></div>
            )}
            {isOwner && (
              <Link href={`/elon/${id}/edit`} className="btn btn-outline w-full"><T>E'lonni tahrirlash</T></Link>
            )}
            <button onClick={() => setShareOpen(true)} className="btn btn-soft w-full gap-2">
              <Share2 size={16} /><T>Ulashish</T>
            </button>
          </div>

          {(e.acceptedCount || 0) > 0 && (
            <div className="mt-4 rounded-xl p-3 text-[12.5px] leading-relaxed"
                 style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
              <T>Bu e'longa allaqachon ariza yuborilgan — tez qaror qiling.</T>
            </div>
          )}
        </section>

        {/* Owner card */}
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
      </aside>

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
      <Link href={authed ? "/elonlar" : "/login"} className="hover:text-[color:var(--text)]"><T>Ish e'lonlari</T></Link>
      <ChevronRight size={13} className="subtle" />
      <span className="truncate max-w-[240px] heading"><T>{e.title}</T></span>
    </nav>
  );

  /* ── Layouts: cabinet (auth) or public (anon) ── */
  if (authed) {
    return (
      <Shell wide>
        <div className="py-6 flex flex-col gap-4">
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
      <span className="font-bold heading">{value}</span>
    </div>
  );
}

