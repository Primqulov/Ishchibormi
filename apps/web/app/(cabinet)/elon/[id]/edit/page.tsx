"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Category, Elon, GENDER_LABEL, GENDER_OPTIONS } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { MapPicker, LatLng } from "@/components/ui/MapPicker";
import { T, useT } from "@/components/T";
import { fmtThousands, onlyDigits, fmtPhone } from "@/lib/format";

export default function EditElon() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const [e, setE] = useState<Elon | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [loc, setLoc] = useState<LatLng | null>(null);

  useEffect(() => {
    api.get<Elon>(`/api/elons/${id}`).then((el) => {
      setE(el);
      if (el.lat || el.lng) setLoc({ lat: el.lat || 0, lng: el.lng || 0 });
    });
    api.get<Category[]>("/api/categories").then(setCats);
  }, [id]);

  if (!e) return <div className="p-6">Yuklanmoqda…</div>;

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const price = e!.pricingType === "total" ? e!.priceAmount : e!.perWorkerAmount;
    await api.patch(`/api/elons/${e!.id}`, {
      title: e!.title, categoryId: e!.categoryId, description: e!.description,
      lat: loc?.lat || 0, lng: loc?.lng || 0,
      // Koordinata bo'lmasa eski viloyat/tumanni saqlab qolamiz.
      region: e!.region, district: e!.district,
      workersNeeded: e!.workersNeeded, gender: e!.gender || "mixed", pricingType: e!.pricingType,
      priceAmount: price,
      startDate: e!.startDate, workTimeFrom: e!.workTimeFrom, workTimeTo: e!.workTimeTo,
      contactPhone: e!.contactPhone ? fmtPhone(e!.contactPhone) : "",
    });
    router.push("/my-elons");
  }

  const priceField = e.pricingType === "total" ? e.priceAmount : e.perWorkerAmount;

  return (
    <Shell title="E'lonni tahrirlash">
      <form onSubmit={save} className="card p-6 grid gap-4 max-w-3xl">
        <input className="input" value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} placeholder={t("Sarlavha")} required />
        <select className="input" value={e.categoryId} onChange={(ev) => setE({ ...e, categoryId: ev.target.value })}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <textarea className="input min-h-[100px]" value={e.description} onChange={(ev) => setE({ ...e, description: ev.target.value })} required />

        <label className="block">
          <span className="text-sm font-medium"><T>Ish joyi (xaritadan belgilang)</T></span>
          <div className="mt-1"><MapPicker value={loc} onChange={setLoc} /></div>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium"><T>Ishchilar soni</T></span>
            <input className="input mt-1" type="number" min={1} inputMode="numeric"
              value={e.workersNeeded}
              onChange={(ev) => setE({ ...e, workersNeeded: Math.max(1, parseInt(ev.target.value || "1", 10) || 1) })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium"><T>Narx (so'm)</T></span>
            <input className="input mt-1" type="text" inputMode="numeric"
              value={priceField ? fmtThousands(String(priceField)) : ""}
              onChange={(ev) => {
                const n = Number(onlyDigits(ev.target.value)) || 0;
                setE(e.pricingType === "total" ? { ...e, priceAmount: n } : { ...e, perWorkerAmount: n });
              }} />
          </label>
        </div>

        <div className="block">
          <span className="text-sm font-medium"><T>Kimlar kerak</T></span>
          <div className="mt-1 flex flex-wrap gap-2">
            {GENDER_OPTIONS.map((g) => (
              <button key={g} type="button"
                onClick={() => setE({ ...e!, gender: g })}
                className={`chip ${(e!.gender || "mixed") === g ? "chip-active" : ""}`}>
                <T>{GENDER_LABEL[g]}</T>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium"><T>Aloqa telefon raqami</T></span>
          <input className="input mt-1 max-w-[260px]" inputMode="numeric"
            value={e.contactPhone || ""}
            onChange={(ev) => setE({ ...e, contactPhone: fmtPhone(ev.target.value) })}
            placeholder="+998 90 020 25 35" />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()} className="btn-secondary"><T>Bekor qilish</T></button>
          <button className="btn-primary"><T>Saqlash</T></button>
        </div>
      </form>
    </Shell>
  );
}
