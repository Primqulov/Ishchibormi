import type { Elon, Gender } from "@/lib/api";
import type { LatLng } from "@/components/ui/MapPicker";
import { fmtPhone, phoneDigits } from "@/lib/format";

export type OwnerEditForm = {
  title: string;
  categoryId: string;
  description: string;
  gender: Gender;
  priceAmount: number | "";
  pricingType: "per_worker" | "total";
  workersNeeded: number;
  schedule: string;
  workTimeTo: string;
  locationText: string;
  loc: LatLng | null;
  contactPhone: string;
  images: string[];
};

/** Match the API's Asia/Tashkent wall-clock schedule, without shifting an ISO date. */
export function editSchedule(listing: Elon): string {
  const date = listing.startDate?.slice(0, 10) || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const embeddedTime = listing.startDate?.slice(11, 16);
  const time = embeddedTime && /^\d{2}:\d{2}$/.test(embeddedTime)
    ? embeddedTime
    : listing.workTimeFrom || "00:00";
  return `${date}T${time}`;
}

export function ownerEditForm(listing: Elon): OwnerEditForm {
  return {
    title: listing.title,
    categoryId: listing.categoryId,
    description: listing.description,
    gender: listing.gender || "mixed",
    priceAmount: listing.pricingType === "negotiable"
      ? ""
      : listing.pricingType === "total" ? listing.priceAmount : listing.perWorkerAmount,
    pricingType: listing.pricingType === "total" ? "total" : "per_worker",
    workersNeeded: listing.workersNeeded,
    schedule: editSchedule(listing),
    workTimeTo: listing.workTimeTo || "",
    locationText: listing.locationText || [listing.region, listing.district].filter(Boolean).join(", "),
    loc: Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && (listing.lat || listing.lng)
      ? { lat: listing.lat!, lng: listing.lng! }
      : null,
    contactPhone: listing.contactPhone || "",
    images: [...(listing.images || [])],
  };
}

export function sameEditLocation(first: LatLng | null, second: LatLng | null): boolean {
  return first === second || (!!first && !!second && first.lat === second.lat && first.lng === second.lng);
}

/** Compare fields an upsert would replace, including values hidden by form defaults. */
export function sameOwnerEditBaseline(first: Elon, second: Elon): boolean {
  const snapshot = (listing: Elon) => ({
    ...ownerEditForm(listing),
    rawStartDate: listing.startDate || "",
    rawWorkTimeFrom: listing.workTimeFrom || "",
    rawLocationText: listing.locationText || "",
    locationUrl: listing.locationUrl || "",
    region: listing.region || "",
    district: listing.district || "",
    lat: listing.lat || 0,
    lng: listing.lng || 0,
    rawPricingType: listing.pricingType,
    totalAmount: listing.priceAmount,
    perWorkerAmount: listing.perWorkerAmount,
  });
  return JSON.stringify(snapshot(first)) === JSON.stringify(snapshot(second));
}

/** The API also supports full upserts: keep untouched optional values verbatim. */
export function ownerEditPayload(form: OwnerEditForm, original: Elon) {
  const initial = ownerEditForm(original);
  const locationChanged = !sameEditLocation(form.loc, initial.loc);
  const scheduleChanged = form.schedule !== initial.schedule;
  const price = form.priceAmount === "" ? 0 : form.priceAmount;
  return {
    title: form.title.trim(),
    categoryId: form.categoryId,
    description: form.description.trim(),
    gender: form.gender,
    workersNeeded: form.workersNeeded,
    pricingType: price === 0 ? "negotiable" : form.pricingType,
    priceAmount: price,
    startDate: scheduleChanged ? form.schedule.slice(0, 10) : original.startDate || "",
    workTimeFrom: scheduleChanged ? form.schedule.slice(11, 16) : original.workTimeFrom || "",
    workTimeTo: form.workTimeTo,
    locationText: form.locationText === initial.locationText ? original.locationText || "" : form.locationText.trim(),
    lat: locationChanged ? form.loc?.lat || 0 : original.lat || 0,
    lng: locationChanged ? form.loc?.lng || 0 : original.lng || 0,
    locationUrl: locationChanged ? "" : original.locationUrl || "",
    region: locationChanged ? "" : original.region || "",
    district: locationChanged ? "" : original.district || "",
    contactPhone: form.contactPhone === initial.contactPhone
      ? original.contactPhone || ""
      : phoneDigits(form.contactPhone) ? fmtPhone(form.contactPhone) : "",
    // An empty array intentionally removes every image. Storage cleanup happens
    // on the server only after this listing update has succeeded.
    images: [...form.images],
  };
}

export function ownerEditValidation(form: OwnerEditForm, original: Elon, now = new Date()): string | null {
  if (!form.title.trim() || !form.description.trim() || !form.categoryId) {
    return "Vazifa nomi, kategoriya va tavsifini to'ldiring.";
  }
  if ([...form.title.trim()].length > 160 || [...form.description.trim()].length > 5000) {
    return "Vazifa nomi 160, tavsifi 5000 belgidan oshmasligi kerak.";
  }
  if (!Number.isInteger(form.workersNeeded) || form.workersNeeded < 1 || form.workersNeeded > 100) {
    return "Ishchilar soni 1 dan 100 gacha bo'lishi kerak.";
  }
  if (form.workersNeeded < original.acceptedCount) {
    return "Ishchilar soni qabul qilingan kishilar sonidan kam bo'la olmaydi.";
  }
  if (form.priceAmount !== "" && (!Number.isSafeInteger(form.priceAmount) || form.priceAmount < 0 || form.priceAmount > 1_000_000_000_000)) {
    return "Ish haqini to'g'ri kiriting.";
  }
  if (form.contactPhone !== (original.contactPhone || "") && phoneDigits(form.contactPhone).length !== 9) {
    return "Aloqa telefon raqamini to'liq kiriting.";
  }
  if (form.locationText.trim().length > 500) {
    return "Manzil 500 belgidan oshmasligi kerak.";
  }
  if (form.images.length > 6) return "Maksimal 6 ta rasm qo'shish mumkin.";
  if (form.loc && (!Number.isFinite(form.loc.lat) || !Number.isFinite(form.loc.lng) || Math.abs(form.loc.lat) > 90 || Math.abs(form.loc.lng) > 180)) {
    return "Iltimos, ish joyini xaritadan belgilang.";
  }
  if (form.schedule !== editSchedule(original)) {
    const chosen = new Date(`${form.schedule}:00+05:00`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.schedule) || !Number.isFinite(chosen.getTime())) {
      return "Boshlanish sanasi va vaqtini kiriting.";
    }
    const earliest = new Date(now.getTime() + 60 * 60 * 1000);
    earliest.setSeconds(0, 0);
    if (chosen < earliest) return "Ish boshlanish vaqti hozirgi vaqtdan kamida 1 soat keyin bo'lishi kerak.";
    const lastDate = new Date(now.getTime() + 2 * 86400000 + 5 * 3600000).toISOString().slice(0, 10);
    if (form.schedule.slice(0, 10) > lastDate) return "Ish boshlanish sanasi bugundan 3 kun ichida bo'lishi kerak.";
  }
  return null;
}
