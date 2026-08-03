// Ish e'loni sahifasi (/elon/[id]) uchun dinamik SEO helper'lari.
//
// Barcha metadata FAQAT backend'dan keladigan e'lon ma'lumotlariga asoslanadi
// (lib/api.ts → Elon). Backend'da mavjud bo'lmagan maydonlar (validThrough,
// employmentType) TAXMIN QILINMAYDI va ishlatilmaydi.
//
// Bu modul mavjud SEO arxitekturasini (lib/seo.ts) qayta ishlatadi va butun
// metadata logikasini bitta joyda jamlaydi — DRY, tipli va scalable.
import { cache } from "react";
import type { Metadata } from "next";
import type { Elon } from "@/lib/api";
import { SITE_NAME, absUrl, fetchElon, OG_IMAGE } from "@/lib/seo";

// ---- Konstantalar --------------------------------------------------------

const MAX_TITLE_LEN = 60; // Google natijalarida title odatda ~60 belgigacha ko'rinadi.
const MAX_DESC_LEN = 160; // Meta description 140–160 belgi oralig'ida bo'lsin.
const BRAND_SUFFIX = ` | ${SITE_NAME}`; // " | Ishchi Bormi"
// Har bir e'lon uchun bir xil, ammo lead qismidan keyin keladigan CTA —
// snippet foydali bo'lsin va description uzunligi 140–160 ga yetsin.
const DESC_CTA =
  "Ishchi Bormi orqali batafsil ma'lumotni ko'ring va ish beruvchi bilan bevosita bog'laning.";

// ---- Ma'lumot yuklovchi (dedup) ------------------------------------------

// generateMetadata() va Page() bir renderда bitta e'lonni ikki marta so'raydi.
// React cache() bilan bitta so'rovga aylantiramiz (fetchElon o'zi ham 300s
// ISR-kesh qiladi — 1M+ sahifa uchun scalable).
export const getElon = cache(
  async (id: string): Promise<Elon | null> => (await fetchElon(id)) as Elon | null,
);

// ---- Kichik matn yordamchilari -------------------------------------------

const collapse = (s?: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Matnni so'z chegarasida `max` belgigача qisqartiradi. */
function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** Matnni tozalab, `max` belgidan oshsa so'z chegarasida kesib "…" qo'yadi. */
function clampText(s: string, max: number): string {
  const t = collapse(s);
  if (t.length <= max) return t;
  const base = truncateWords(t, max - 1).replace(/[\s.,;:·—–-]+$/, "");
  return `${base}…`;
}

const uniq = (arr: (string | undefined)[]): string[] =>
  [...new Set(arr.map((x) => collapse(x)).filter(Boolean))];

// ---- E'londan chiqariladigan bo'laklar -----------------------------------

/** Title uchun asosiy joy nomi (viloyat yoki shahar). */
function primaryLocation(e: Elon): string {
  return collapse(e.region) || collapse(e.district);
}

/** Description/keywords uchun to'liq joy nomi ("Viloyat, Tuman"). */
function fullLocation(e: Elon): string {
  return [collapse(e.region), collapse(e.district)].filter(Boolean).join(", ");
}

/** Narx ma'lumoti — pricingType'ga qarab (per_worker/total/negotiable). */
function priceInfo(e: Elon): { amount: number; negotiable: boolean; text: string } {
  const negotiable = e.pricingType === "negotiable";
  const amount = Number(e.perWorkerAmount || e.priceAmount || 0);
  const text = negotiable
    ? "Kelishilgan narx"
    : amount > 0
      ? `${amount.toLocaleString("ru-RU")} so'm`
      : "";
  return { amount, negotiable, text };
}

// ---- Title / Description / Keywords ---------------------------------------

/**
 * "{Ish turi} — {Joy} | Ishchi Bormi" — 60 belgidan oshmaydi.
 * Sig'masa avval joy, keyin ish turi qisqartiriladi (brend doim qoladi).
 */
export function buildTitle(e: Elon): string {
  const job = collapse(e.title) || "Ish e'loni";
  const loc = primaryLocation(e);
  const withLoc = loc ? `${job} — ${loc}` : job;
  if ((withLoc + BRAND_SUFFIX).length <= MAX_TITLE_LEN) return withLoc + BRAND_SUFFIX;
  if ((job + BRAND_SUFFIX).length <= MAX_TITLE_LEN) return job + BRAND_SUFFIX;
  const room = MAX_TITLE_LEN - BRAND_SUFFIX.length - 1; // "…" uchun -1
  return `${truncateWords(job, room)}…${BRAND_SUFFIX}`;
}

/**
 * Har bir e'lon uchun o'ziga xos description (140–160 belgi maqsad).
 * Lead sifatida e'lonning haqiqiy tavsifidan foydalanadi (takror bo'lmasin),
 * so'ng joy + narx faktlari va CTA qo'shiladi, 160 belgigача qisqartiriladi.
 */
export function buildDescription(e: Elon): string {
  const loc = fullLocation(e);
  const { text: price } = priceInfo(e);
  const lead = collapse(e.description) || `${collapse(e.title)}${loc ? ` — ${loc}` : ""}`;

  let s = lead;
  if (s && !/[.!?…]$/.test(s)) s += ".";
  const facts = [loc, price].filter(Boolean).join(" · ");
  if (facts) s += ` ${facts}.`;
  s += ` ${DESC_CTA}`;
  return clampText(s, MAX_DESC_LEN);
}

/** E'lon ma'lumotidan avtomatik keywords ro'yxati. */
export function buildKeywords(e: Elon): string[] {
  return uniq([
    e.categoryName,
    collapse(e.title),
    "ishchi kerak",
    e.region,
    e.district,
    "kunlik ish",
    "mardikor",
    SITE_NAME,
  ]);
}

/** OG/Twitter rasmlari — e'lon rasmlari yoki zaxira OGimg. */
function ogImages(e: Elon): string[] {
  const imgs = (e.images ?? []).filter(Boolean);
  return imgs.length ? imgs.slice(0, 4) : [absUrl(OG_IMAGE)];
}

// ---- Metadata ------------------------------------------------------------

/** Bitta e'lon uchun to'liq Next.js Metadata (title/description/OG/Twitter/canonical/keywords). */
export function buildElonMetadata(e: Elon, id: string): Metadata {
  const title = buildTitle(e);
  const description = buildDescription(e);
  const path = `/elon/${id}`;
  const url = absUrl(path);
  const images = ogImages(e);
  return {
    // absolute — root layout'dagi "%s — Ishchi Bormi" shablonini chetlab o'tadi
    // (brend title ichida allaqachon bor, ikki marta qo'shilmasin).
    title: { absolute: title },
    description,
    keywords: buildKeywords(e),
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: SITE_NAME,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [images[0]],
    },
  };
}

/** E'lon topilmaganда — indekslanmaydi, canonical berilmaydi (noto'g'ri URL bo'lmasin). */
export function notFoundMetadata(): Metadata {
  return {
    title: { absolute: `E'lon topilmadi${BRAND_SUFFIX}` },
    description: "Bu e'lon topilmadi yoki o'chirilgan bo'lishi mumkin.",
    robots: { index: false, follow: false },
  };
}

// ---- JobPosting JSON-LD ---------------------------------------------------

/**
 * JobPosting structured data — FAQAT mavjud maydonlar bilan.
 * validThrough/employmentType backend'da yo'q → qo'shilmaydi.
 */
export function buildJobPostingLd(e: Elon, id: string): Record<string, unknown> {
  const address: Record<string, unknown> = { "@type": "PostalAddress", addressCountry: "UZ" };
  if (collapse(e.region)) address.addressRegion = collapse(e.region);
  if (collapse(e.district)) address.addressLocality = collapse(e.district);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: collapse(e.title),
    description: collapse(e.description) || collapse(e.title),
    identifier: { "@type": "PropertyValue", name: SITE_NAME, value: id },
    datePosted: e.publishedAt || e.createdAt,
    hiringOrganization: {
      "@type": "Organization",
      name: collapse(e.ownerName) || SITE_NAME,
    },
    jobLocation: { "@type": "Place", address },
    // Ariza saytda bevosita topshiriladi (/elon/{id} → apply oqimi).
    directApply: true,
    url: absUrl(`/elon/${id}`),
  };

  // baseSalary ATAYLAB chiqarilmaydi: backend'da narx davri (unitText — kunlik/
  // soatlik/bir martalik) uchun maydon yo'q. Google baseSalary uchun to'g'ri
  // unitText talab qiladi; taxminiy qiymat qo'shgandan ko'ra umuman bermaymiz.
  // (pricingType per_worker|total|negotiable — narx davri emas, taqsimot turi.)

  return ld;
}
