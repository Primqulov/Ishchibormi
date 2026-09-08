"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, Loader2, Map as MapIcon, MapPin, Minus, Plus, ShieldAlert, User2, Users, X } from "lucide-react";
import { api, APIError, Application, Category, Elon, getAccess, GENDER_LABEL, GENDER_OPTIONS } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { ModerationModal, isModerationError } from "@/components/ModerationModal";
import { OwnerListingActionDialog } from "@/components/OwnerListingActionDialog";
import { MapPicker } from "@/components/ui/MapPicker";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { T, useT } from "@/components/T";
import { fmtSum, fmtThousands, onlyDigits } from "@/lib/format";
import { uploadFile } from "@/lib/upload";
import { invalidateOwnerListingQueries, isOwnerClosable, isOwnerEditable, loadOwnerListingGuard } from "@/lib/owner-listing";
import { OwnerEditForm, ownerEditForm, ownerEditPayload, ownerEditValidation, sameEditLocation, sameOwnerEditBaseline } from "./edit-form";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "Ma'lumotlarni yuklab bo'lmadi. Qayta urinib ko'ring.";
}

export default function EditElon() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const [listing, setListing] = useState<Elon | null>(null);
  const [form, setForm] = useState<OwnerEditForm | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moderationError, setModerationError] = useState<APIError | null>(null);
  const initialForm = useRef<OwnerEditForm | null>(null);
  const originalListing = useRef<Elon | null>(null);
  const requestVersion = useRef(0);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const allowNavigation = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    setError("");
    setStaleSnapshot(false);
    setSaving(false);
    setUploading(false);
    savingRef.current = false;
    uploadingRef.current = false;
    setListing(null);
    setForm(null);
    setShowMap(false);
    setDeleteOpen(false);
    initialForm.current = null;
    originalListing.current = null;
    allowNavigation.current = false;
    void Promise.all([loadOwnerListingGuard(id), api.get<Category[]>("/api/categories")]).then(([guard, cats]) => {
      if (requestVersion.current !== version) return;
      setListing(guard.listing);
      setApplications(guard.applications);
      setCategories(cats);
      if (isOwnerEditable(guard.listing)) {
        const values = ownerEditForm(guard.listing);
        originalListing.current = guard.listing;
        initialForm.current = values;
        setForm(values);
      }
    }).catch((err: unknown) => {
      if (requestVersion.current === version) setLoadError(errorMessage(err));
    }).finally(() => {
      if (requestVersion.current === version) setLoading(false);
    });
    return () => { requestVersion.current += 1; };
  }, [id, retry]);

  const dirty = useMemo(() => !!form && JSON.stringify(form) !== JSON.stringify(initialForm.current), [form]);
  const busy = saving || uploading;
  const editable = !!listing && isOwnerEditable(listing);
  const activeApplications = applications.filter((application) => application.status === "pending" || application.status === "accepted").length;
  const minWorkers = Math.max(1, listing?.acceptedCount || 0);

  // Keep an in-flight save/upload on this page, and warn before discarding edits.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (allowNavigation.current || (!dirty && !savingRef.current && !uploadingRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function onNavigation(event: MouseEvent) {
      if (allowNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href || (destination.pathname === window.location.pathname && destination.hash)) return;
      if (savingRef.current || uploadingRef.current || (dirty && !window.confirm(t("Saqlanmagan o'zgarishlar bekor qilinsinmi?")))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onNavigation, true);
    };
  }, [dirty, t]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function returnToDetails() {
    if (savingRef.current || uploadingRef.current) return;
    if (dirty && !window.confirm(t("Saqlanmagan o'zgarishlar bekor qilinsinmi?"))) return;
    allowNavigation.current = true;
    router.push(`/elon/${encodeURIComponent(id)}`);
  }

  function reloadLatest() {
    if (savingRef.current || uploadingRef.current) return;
    if (dirty && !window.confirm(t("Saqlanmagan o'zgarishlar bekor qilinsinmi?"))) return;
    setRetry((value) => value + 1);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !listing || !originalListing.current || savingRef.current || uploadingRef.current || !editable) return;
    const validation = ownerEditValidation(form, originalListing.current);
    if (validation) { setError(validation); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    setModerationError(null);
    const version = requestVersion.current;
    const saveToken = getAccess();
    function checkSaveSession() {
      if (!saveToken || getAccess() !== saveToken) {
        throw { code: "owner_required", message: "Hisob o'zgardi. E'lonni o'z hisobingizdan qayta oching." } satisfies APIError;
      }
    }
    let navigated = false;
    try {
      const guard = await loadOwnerListingGuard(id);
      if (version !== requestVersion.current) return;
      checkSaveSession();
      setListing(guard.listing);
      setApplications(guard.applications);
      if (!isOwnerEditable(guard.listing)) { setError("Bu holatdagi e'lonni tahrirlab bo'lmaydi."); return; }
      if (!sameOwnerEditBaseline(originalListing.current, guard.listing)) {
        setStaleSnapshot(true);
        setError("E'lon ma'lumotlari sahifa ochilganidan beri o'zgargan. So'nggi ma'lumotlarni yuklang va tahriringizni qayta kiriting.");
        return;
      }
      const freshValidation = ownerEditValidation(form, { ...originalListing.current, acceptedCount: guard.listing.acceptedCount });
      if (freshValidation) { setError(freshValidation); return; }
      const updated = await api.patch<Elon>(`/api/elons/${id}`, ownerEditPayload(form, originalListing.current));
      if (version !== requestVersion.current) return;
      checkSaveSession();
      await invalidateOwnerListingQueries(queryClient, id);
      if (version !== requestVersion.current) return;
      checkSaveSession();
      allowNavigation.current = true;
      initialForm.current = ownerEditForm(updated);
      setForm(initialForm.current);
      setListing(updated);
      navigated = true;
      router.replace(`/elon/${encodeURIComponent(id)}?updated=1`);
    } catch (err: unknown) {
      if (version !== requestVersion.current) return;
      if (isModerationError(err)) setModerationError(err as APIError);
      else setError(errorMessage(err));
    } finally {
      if (version === requestVersion.current && !navigated) { savingRef.current = false; setSaving(false); }
    }
  }

  const price = typeof form?.priceAmount === "number" ? form.priceAmount : 0;
  const workers = form?.workersNeeded || 1;
  const total = form?.pricingType === "total" ? price : price * workers;
  const perWorker = form?.pricingType === "total" ? Math.floor(price / workers) : price;
  const categoryOptions = listing && !categories.some((category) => category.id === listing.categoryId)
    ? [{ id: listing.categoryId, name: listing.categoryName }, ...categories] : categories;

  return <Shell wide>
    <div className="mx-auto w-full max-w-[760px] py-6 sm:py-8">
      <nav aria-label={t("Sahifa yo'li")} className="mb-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs subtle">
        <button type="button" onClick={returnToDetails} disabled={busy} className="mr-1 inline-flex items-center gap-1.5 font-semibold text-[color:var(--brand)] disabled:opacity-50"><ArrowLeft size={14} /><T>Orqaga</T></button>
        <span aria-hidden="true">·</span><Link href="/my-elons" className="hover:text-[color:var(--brand)]"><T>Mening arizalarim</T></Link>
        <span aria-hidden="true">/</span><Link href="/my-elons" className="hover:text-[color:var(--brand)]"><T>Ish e'lonlarim</T></Link>
        {listing && <><span aria-hidden="true">/</span><span className="max-w-[200px] truncate">{listing.title}</span></>}
        <span aria-hidden="true">/</span><span aria-current="page"><T>Tahrirlash</T></span>
      </nav>
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.7px] heading"><T>E'lonni tahrirlash</T></h1>
      <p className="mt-2 text-sm leading-relaxed muted"><T>Ma'lumotlarni o'zgartirib, so'ng o'zgarishlarni saqlang. Muhim o'zgarishlar nomzodlarga bildiriladi.</T></p>

      {loading ? <div className="card mt-6 flex items-center justify-center gap-2 px-6 py-16 muted" role="status"><Loader2 size={20} className="animate-spin" /><T>Yuklanmoqda…</T></div>
        : loadError ? <div className="card mt-6 p-6" role="alert"><p className="text-sm text-danger">{t(loadError)}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="btn-secondary mt-4"><T>Qayta urinib ko'rish</T></button></div>
          : !form ? <div className="card mt-6 p-7 text-center"><ShieldAlert className="mx-auto text-[color:var(--text-subtle)]" size={36} /><p className="mt-3 font-semibold"><T>Bu holatdagi e'lonni tahrirlab bo'lmaydi.</T></p><button type="button" className="btn-primary mt-5" onClick={returnToDetails}><T>E'lonni ko'rish</T></button></div>
            : <>
              {activeApplications > 0 && editable && <Notice className="mt-6"><T>Bu e'longa</T> {activeApplications} <T>ta faol ariza yuborilgan. Ish haqi, kategoriya, sana yoki manzil o'zgarsa, nomzodlarga bildirishnoma yuboriladi.</T></Notice>}

              <form onSubmit={save} className="card mt-6 p-5 sm:p-7" aria-busy={busy}>
                {error && <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"><p>{t(error)}</p>{staleSnapshot && <button type="button" onClick={reloadLatest} disabled={busy} className="btn-secondary mt-3"><T>So'nggi ma'lumotlarni yuklash</T></button>}</div>}
                {!editable && <Notice className="mb-5"><T>Bu holatdagi e'lonni tahrirlab bo'lmaydi.</T></Notice>}
                <fieldset disabled={busy || !editable || deleteOpen} className="m-0 grid min-w-0 gap-6 border-0 p-0 disabled:opacity-70" style={{ pointerEvents: busy || !editable || deleteOpen ? "none" : undefined }}>
                  <Field label="Vazifa nomi" htmlFor="owner-edit-title"><input id="owner-edit-title" className="input" required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
                  <Field label="Kategoriya"><div role="radiogroup" aria-label={t("Kategoriya")} className="flex flex-wrap gap-2">{categoryOptions.map((category) => <button key={category.id} type="button" role="radio" aria-checked={form.categoryId === category.id} onClick={() => setForm({ ...form, categoryId: category.id })} className={`chip !px-4 !py-2 ${form.categoryId === category.id ? "chip-active" : ""}`}><T>{category.name}</T></button>)}</div></Field>
                  <Field label="Vazifa tavsifi" htmlFor="owner-edit-description"><textarea id="owner-edit-description" className="input min-h-[120px] resize-y leading-relaxed" required maxLength={5000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>

                  <Field label="Kim kerak?">
                    <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label={t("Kim kerak?")}>
                      {GENDER_OPTIONS.map((gender) => <button key={gender} type="button" role="radio" aria-checked={form.gender === gender} onClick={() => setForm({ ...form, gender })} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[10px] border px-1 py-3 text-xs font-semibold transition sm:gap-2 sm:text-sm" style={form.gender === gender ? { background: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand)", boxShadow: "inset 0 0 0 0.5px var(--brand)" } : { background: "var(--bg-subtle)", borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>{gender === "mixed" ? <Users size={15} /> : <User2 size={15} />}<T>{GENDER_LABEL[gender]}</T></button>)}
                    </div>
                    <p className="mt-2 text-xs subtle"><T>«Aralash» tanlansa, e'lon barcha ishchilarga ko'rinadi.</T></p>
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Ish haqi (UZS)" htmlFor="owner-edit-price"><input id="owner-edit-price" type="text" inputMode="numeric" className="input" value={form.priceAmount === "" ? "" : fmtThousands(String(form.priceAmount))} onChange={(event) => { const digits = onlyDigits(event.target.value); setForm({ ...form, priceAmount: digits ? Number(digits) : "" }); }} placeholder={t("Kelishiladi")} /></Field>
                    <Field label="Ishchilar soni" htmlFor="owner-edit-workers">
                      <div className="input flex items-center gap-2 !p-1.5">
                        <button type="button" aria-label={t("Ishchilar sonini kamaytirish")} disabled={form.workersNeeded <= minWorkers} onClick={() => setForm({ ...form, workersNeeded: Math.max(minWorkers, form.workersNeeded - 1) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--brand)] transition hover:bg-[color:var(--brand-soft)] disabled:opacity-40"><Minus size={16} /></button>
                        <input id="owner-edit-workers" type="number" min={minWorkers} max={100} required className="min-w-0 flex-1 appearance-none bg-transparent text-center text-sm font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={form.workersNeeded || ""} onChange={(event) => setForm({ ...form, workersNeeded: Number(event.target.value) })} />
                        <button type="button" aria-label={t("Ishchilar sonini ko'paytirish")} disabled={form.workersNeeded >= 100} onClick={() => setForm({ ...form, workersNeeded: Math.min(100, form.workersNeeded + 1) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--brand)] transition hover:bg-[color:var(--brand-soft)] disabled:opacity-40"><Plus size={16} /></button>
                      </div>
                    </Field>
                  </div>

                  <Field label="Kiritilgan summa nimani bildiradi?">
                    <div role="radiogroup" aria-label={t("Kiritilgan summa nimani bildiradi?")} className="grid gap-2.5 sm:grid-cols-2">
                      {(["per_worker", "total"] as const).map((type) => {
                        const selected = form.pricingType === type;
                        return <button key={type} type="button" role="radio" aria-checked={selected} onClick={() => setForm({ ...form, pricingType: type })} className="flex gap-2.5 rounded-xl border p-3 text-left transition" style={selected ? { borderColor: "var(--brand)", background: "var(--brand-soft)", boxShadow: "inset 0 0 0 0.5px var(--brand)" } : { borderColor: "var(--border-strong)", background: "var(--bg-subtle)" }}>
                          <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border" style={{ borderColor: selected ? "var(--brand)" : "var(--border-strong)", background: selected ? "var(--brand)" : "var(--card)" }}>{selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
                          <span><span className="block text-sm font-bold" style={{ color: selected ? "var(--brand)" : "var(--text)" }}><T>{type === "per_worker" ? "Har bir ishchi uchun" : "Umumiy summa"}</T></span><span className="mt-0.5 block text-xs leading-relaxed subtle">{type === "per_worker" ? <><T>Har bir ishchiga alohida</T> {fmtSum(price)} <T>so'm to'lanadi</T></> : <>{fmtSum(price)} <T>so'm barcha ishchilarga bo'linadi</T></>}</span></span>
                        </button>;
                      })}
                    </div>
                  </Field>

                  <div className="flex items-start gap-2 rounded-xl p-3.5 text-[13px] font-semibold" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Info size={16} className="mt-0.5 shrink-0" /><span>{price ? <><T>Jami to'lanadigan summa</T>: {fmtSum(total)} <T>so'm</T> {form.pricingType === "total" ? <>(<T>Har bir ishchi uchun</T>: {fmtSum(perWorker)} <T>so'm</T>)</> : <>({fmtSum(perWorker)} × {workers} <T>ishchi</T>)</>}</> : <T>Ish haqi maydonini bo'sh qoldirsangiz, e'lon «Kelishiladi» sifatida saqlanadi.</T>}</span></div>

                  <Field label="Sana va vaqt" htmlFor="owner-edit-schedule"><input id="owner-edit-schedule" type="datetime-local" className="input" value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} /><p className="mt-1.5 text-xs subtle"><T>O'zbekiston vaqti. Yangi sana bugundan 3 kun ichida bo'lishi kerak.</T></p></Field>
                  {(form.workTimeTo || initialForm.current?.workTimeTo) && <Field label="Tugash vaqti" htmlFor="owner-edit-end"><input id="owner-edit-end" type="time" className="input sm:max-w-[240px]" value={form.workTimeTo} onChange={(event) => setForm({ ...form, workTimeTo: event.target.value })} /></Field>}

                  <Field label="Manzil" htmlFor="owner-edit-address">
                    <div className="relative"><input id="owner-edit-address" className="input !pr-10" maxLength={500} value={form.locationText} onChange={(event) => setForm({ ...form, locationText: event.target.value })} placeholder={[listing?.region, listing?.district].filter(Boolean).join(", ") || t("Manzilni kiriting")} /><MapPin size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 subtle" /></div>
                    <div className="mt-3">{showMap ? <MapPicker value={form.loc} height={220} onChange={(loc) => setForm((current) => current ? { ...current, loc, locationText: initialForm.current && sameEditLocation(current.loc, initialForm.current.loc) && current.locationText === initialForm.current.locationText ? "" : current.locationText } : current)} /> : <div className="flex min-h-[190px] flex-col items-center justify-center gap-3 rounded-xl p-5" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><MapIcon size={30} strokeWidth={1.8} /><button type="button" className="btn !bg-[color:var(--card)] !text-[color:var(--brand)] shadow-card" onClick={() => setShowMap(true)}><MapPin size={15} /><T>Xaritadan tanlash</T></button></div>}</div>
                  </Field>

                  <Field label="Aloqa telefon raqami"><PhoneInput className="sm:max-w-[280px]" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} /></Field>
                  <Field label="Rasmlar"><EditImages value={form.images} elonId={id} disabled={saving || !editable || deleteOpen} onChange={(images) => setForm((current) => current ? { ...current, images } : current)} onBusy={(value) => { uploadingRef.current = value; setUploading(value); }} onModeration={setModerationError} /><p className="mt-2 text-xs subtle"><T>JPG / PNG / WebP, har biri 8MB gacha. Maks 6 ta rasm.</T></p></Field>

                  <div className="grid gap-3 sm:grid-cols-[0.44fr_1fr]"><button type="button" onClick={returnToDetails} className="btn-secondary !py-3.5"><T>Bekor qilish</T></button><button type="submit" className="btn-primary !whitespace-normal !py-3.5">{saving && <Loader2 size={17} className="shrink-0 animate-spin" />}<T>{saving ? "Saqlanmoqda…" : "O'zgarishlarni saqlash"}</T></button></div>
                </fieldset>
                <div className="mt-7 flex flex-col items-start gap-4 border-t pt-4 sm:flex-row"><button type="button" disabled={busy || !listing || !isOwnerClosable(listing)} onClick={() => setDeleteOpen(true)} className="btn shrink-0 border border-[#ffc2bd] !bg-[#fff2f0] !text-[#ba1a1a] dark:border-red-900 dark:!bg-red-950/40 dark:!text-red-300"><T>E'lonni o'chirish</T></button><p className="text-xs leading-relaxed subtle"><T>O'chirilgan e'lon arxivda qoladi. Nomzod tasdiqlangan bo'lsa, avval ishni sabab ko'rsatib bekor qilish kerak.</T></p></div>
              </form>
            </>}
    </div>
    <ModerationModal error={moderationError} onClose={() => setModerationError(null)} />
    <OwnerListingActionDialog open={deleteOpen} elonId={id} onClose={() => setDeleteOpen(false)} onChanged={(updated) => { allowNavigation.current = true; setListing(updated); }} />
  </Shell>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="min-w-0"><label htmlFor={htmlFor} className="block text-[13px] font-semibold heading"><T>{label}</T></label><div className="mt-2">{children}</div></div>;
}

function Notice({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-start gap-2 rounded-xl p-3.5 text-[12.5px] font-semibold leading-relaxed ${className}`} style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}><Info size={15} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

/** Removing a thumbnail stages an edit; the live listing image is kept until save succeeds. */
function EditImages({ value, elonId, disabled, onChange, onBusy, onModeration }: { value: string[]; elonId: string; disabled: boolean; onChange: (value: string[]) => void; onBusy: (value: boolean) => void; onModeration: (error: APIError) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function upload(files: FileList | null) {
    if (!files?.length || busyRef.current || disabled) return;
    const available = 6 - value.length;
    if (available <= 0) return;
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    const next = [...value];
    try {
      if (files.length > available) setError("Maksimal 6 ta rasm qo'shish mumkin.");
      for (const file of Array.from(files).slice(0, available)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Faqat rasm fayllari qabul qilinadi (JPG, PNG, WebP)."); continue; }
        if (file.size > 8 * 1024 * 1024) { setError("Har bir rasm hajmi 8MB dan oshmasligi kerak."); continue; }
        try {
          const result = await uploadFile(file, "elon", { scope: elonId });
          if (!mounted.current) return;
          next.push(result.url);
          onChange([...next]);
        } catch (err: unknown) {
          if (!mounted.current) return;
          if (isModerationError(err)) { onModeration(err as APIError); break; }
          setError(errorMessage(err));
        }
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  }

  return <div>
    <div className="flex flex-wrap gap-3">
      {value.length < 6 && <button type="button" aria-label={t("Rasm qo'shish")} onClick={() => inputRef.current?.click()} disabled={disabled || busy} className="flex h-[112px] w-[112px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-xs font-semibold transition hover:opacity-80 disabled:opacity-50" style={{ background: "var(--bg-subtle)", borderColor: "var(--border-strong)", color: "var(--brand)" }}>{busy ? <Loader2 size={21} className="animate-spin" /> : <Plus size={22} />}<T>{busy ? "Yuklanmoqda…" : "Rasm qo'shish"}</T></button>}
      {value.map((url, index) => <div key={`${url}-${index}`} className="relative h-[112px] w-[112px] overflow-hidden rounded-xl border" style={{ background: "var(--brand-tint)", borderColor: "var(--border)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${t("E'lon rasmi")} ${index + 1}`} className="h-full w-full object-cover" />
        <button type="button" aria-label={`${t("Rasmni olib tashlash")} ${index + 1}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled || busy} className="absolute bottom-2 left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-white text-[#ba1a1a] shadow-pop disabled:opacity-50"><X size={15} /></button>
      </div>)}
    </div>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label={t("Rasmlar")} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
    {error && <p role="alert" className="mt-2 text-xs text-danger">{t(error)}</p>}
  </div>;
}
