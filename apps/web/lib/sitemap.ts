// Dinamik XML sitemap uchun reusable, tipli yordamchilar.
//
// Arxitektura millionlab e'longa tayyor — Sitemap Index modeli:
//   /sitemap.xml            → index (barcha bo'laklarni sanaydi)
//   /sitemaps/static.xml    → statik sahifalar
//   /sitemaps/jobs-1.xml..N → har biri <= JOBS_PER_SITEMAP ta faol e'lon
//
// Ma'lumot backend'ning yengil /api/elons/sitemap endpoint'idan (proyeksiya +
// katta sahifa) olinadi — har bo'lak bitta optimal so'rov, N+1 yo'q.
import { createHash } from "node:crypto";
import { SITE_URL, API_BASE } from "@/lib/seo";

// ---- Konstantalar (magic string/number yo'q) -----------------------------

/** Google bitta sitemap fayliga 50 000 URL limiti — chegara xavfsizligi uchun kam. */
export const JOBS_PER_SITEMAP = 45000;

/** ISR/cache muddati (sekund) — har so'rov API'ga urilmaydi (#7). */
export const SITEMAP_REVALIDATE = 300;

/** XML javob sarlavhalari (CDN/proxy uchun ham cache — frontend ISR bilan mos). */
export const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
export const SITEMAP_CACHE_CONTROL = `public, max-age=${SITEMAP_REVALIDATE}, stale-while-revalidate=${SITEMAP_REVALIDATE}`;
// Sitemap fayllarining o'zi qidiruv natijasida indekslanmasin (faqat crawl qilinsin).
export const SITEMAP_ROBOTS_TAG = "noindex";

// Statik sahifalar / sitemap-index uchun BARQAROR lastmod — jarayon (deploy)
// boshlanish vaqti. Har so'rovda `new Date()` ishlatilsa kontent va ETag o'zgarib
// ketadi; barqaror qiymat ETag/If-None-Match keshini to'g'ri ishlatadi.
export const DEPLOY_TIME = new Date();

/** Child sitemap yo'llari. */
export const STATIC_SITEMAP_PATH = "/sitemaps/static.xml";
export const jobsSitemapPath = (n: number): string => `/sitemaps/jobs-${n}.xml`;
/** jobs-<N>.xml nomidan N ni ajratib oladi (0 — noto'g'ri). */
export const parseJobsChunk = (chunk: string): number => {
  const m = /^jobs-(\d+)\.xml$/.exec(chunk);
  const n = m ? Number(m[1]) : 0;
  return Number.isInteger(n) && n >= 1 ? n : 0;
};

type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

type StaticPage = { path: string; changefreq: ChangeFreq; priority: number };

/** Ochiq statik sahifalar — yagona manba (DRY). */
export const STATIC_PAGES: readonly StaticPage[] = [
  { path: "/", changefreq: "daily", priority: 1.0 }, // bosh sahifa — 1.0 (#6)
  { path: "/biz-haqimizda", changefreq: "monthly", priority: 0.5 },
  { path: "/yordam", changefreq: "monthly", priority: 0.5 },
  { path: "/foydalanish-shartlari", changefreq: "yearly", priority: 0.5 },
  { path: "/maxfiylik-siyosati", changefreq: "yearly", priority: 0.5 },
  // Google Play talab qiladigan ochiq hisobni o'chirish sahifasi — indekslansin
  // ki, foydalanuvchi ilovasiz ham qidiruvdan topa olsin.
  { path: "/delete-account", changefreq: "yearly", priority: 0.5 },
] as const;

const JOB_CHANGE_FREQUENCY: ChangeFreq = "daily";
const JOB_PRIORITY = 0.8;

// ---- Turlar --------------------------------------------------------------

export type SitemapUrl = {
  loc: string;
  lastmod?: string | Date;
  changefreq?: ChangeFreq;
  priority?: number;
};

export type SitemapRef = { loc: string; lastmod?: string | Date };

/** Backend'dan keladigan yengil e'lon (faqat sitemap uchun kerakli maydonlar). */
export type SitemapElon = {
  id: string;
  updatedAt?: string;
  createdAt?: string;
  publishedAt?: string;
};

// ---- Ichki yordamchilar ---------------------------------------------------

function abs(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sana → W3C Datetime (ISO). Noto'g'ri bo'lsa undefined. */
function toW3C(d?: string | Date): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

// ---- XML quruvchilar ------------------------------------------------------

/** <urlset> — sahifalar ro'yxati. */
export function buildUrlset(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const lm = toW3C(u.lastmod);
      return (
        "  <url>\n" +
        `    <loc>${xmlEscape(u.loc)}</loc>\n` +
        (lm ? `    <lastmod>${lm}</lastmod>\n` : "") +
        (u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>\n` : "") +
        (u.priority != null ? `    <priority>${u.priority.toFixed(1)}</priority>\n` : "") +
        "  </url>"
      );
    })
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (body ? body + "\n" : "") +
    "</urlset>\n"
  );
}

/** <sitemapindex> — child sitemap'lar ro'yxati. */
export function buildSitemapIndex(items: SitemapRef[]): string {
  const body = items
    .map((s) => {
      const lm = toW3C(s.lastmod);
      return (
        "  <sitemap>\n" +
        `    <loc>${xmlEscape(s.loc)}</loc>\n` +
        (lm ? `    <lastmod>${lm}</lastmod>\n` : "") +
        "  </sitemap>"
      );
    })
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (body ? body + "\n" : "") +
    "</sitemapindex>\n"
  );
}

// ---- HTTP javobi (barcha sitemap route'lari uchun yagona manba) -----------

/**
 * Sitemap XML javobini standart headerlar bilan quradi:
 *   Content-Type, Cache-Control, X-Robots-Tag: noindex, ETag.
 * `If-None-Match` ETag'ga mos kelsa — 304 (bandwidth tejaladi).
 */
export function sitemapResponse(body: string, req?: Request): Response {
  const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
  const headers: Record<string, string> = {
    "Content-Type": XML_CONTENT_TYPE,
    "Cache-Control": SITEMAP_CACHE_CONTROL,
    "X-Robots-Tag": SITEMAP_ROBOTS_TAG,
    ETag: etag,
  };
  if (req?.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}

// ---- Yozuv yasovchilar ----------------------------------------------------

/** Statik sahifa yozuvlari. lastmod — deploy vaqti (barqaror, hardcode emas). */
export function staticUrls(lastmod: Date): SitemapUrl[] {
  return STATIC_PAGES.map((p) => ({
    loc: abs(p.path),
    lastmod,
    changefreq: p.changefreq,
    priority: p.priority,
  }));
}

/** Bitta e'lon yozuvi. lastmod = updatedAt || createdAt (#4). */
export function jobUrl(e: SitemapElon): SitemapUrl {
  return {
    loc: `${SITE_URL}/elon/${e.id}`,
    lastmod: e.updatedAt || e.createdAt || e.publishedAt,
    changefreq: JOB_CHANGE_FREQUENCY,
    priority: JOB_PRIORITY,
  };
}

// ---- Backend so'rovlari (xato bo'lsa null/[] — sitemap 500 bermaydi, #10) --

type SitemapApiPage = { items: SitemapElon[]; total: number; page: number; limit: number };

async function fetchSitemapPage(page: number, limit: number): Promise<SitemapApiPage | null> {
  try {
    const res = await fetch(`${API_BASE}/api/elons/sitemap?page=${page}&limit=${limit}`, {
      next: { revalidate: SITEMAP_REVALIDATE },
    });
    if (!res.ok) return null;
    return (await res.json()) as SitemapApiPage;
  } catch {
    return null;
  }
}

/** Faol e'lonlar umumiy soni — nechta jobs-sitemap kerakligini aniqlash uchun. */
export async function fetchActiveElonTotal(): Promise<number> {
  const p = await fetchSitemapPage(1, 1);
  return p?.total ?? 0;
}

/** jobs-<n>.xml uchun faol e'lonlar — bitta optimal so'rov (#9). */
export async function fetchJobsSitemapPage(n: number): Promise<SitemapElon[]> {
  if (n < 1) return [];
  const p = await fetchSitemapPage(n, JOBS_PER_SITEMAP);
  return p?.items ?? [];
}

/** Faol e'lonlar soniga qarab kerakli jobs-sitemap bo'laklari soni. */
export function jobSitemapCount(total: number): number {
  return total > 0 ? Math.ceil(total / JOBS_PER_SITEMAP) : 0;
}
