import {
  buildUrlset,
  staticUrls,
  jobUrl,
  fetchJobsSitemapPage,
  parseJobsChunk,
  SITEMAP_REVALIDATE,
  sitemapResponse,
  DEPLOY_TIME,
} from "@/lib/sitemap";

// Child sitemap'lar 300s ISR bilan cache'lanadi (#7).
export const revalidate = SITEMAP_REVALIDATE;

// /sitemaps/static.xml    → statik sahifalar
// /sitemaps/jobs-<N>.xml  → N-bo'lakdagi faol e'lonlar (bitta optimal so'rov)
// Backend xato bo'lsa bo'sh, ammo valid <urlset> qaytadi — 500 bermaydi (#10).
export async function GET(
  req: Request,
  { params }: { params: { chunk: string } },
): Promise<Response> {
  const { chunk } = params;

  if (chunk === "static.xml") {
    return sitemapResponse(buildUrlset(staticUrls(DEPLOY_TIME)), req);
  }

  const n = parseJobsChunk(chunk);
  if (n >= 1) {
    const jobs = await fetchJobsSitemapPage(n);
    return sitemapResponse(buildUrlset(jobs.map(jobUrl)), req);
  }

  return new Response("Not found", { status: 404 });
}
