import { SITE_URL } from "@/lib/seo";
import {
  buildSitemapIndex,
  fetchActiveElonTotal,
  jobSitemapCount,
  jobsSitemapPath,
  STATIC_SITEMAP_PATH,
  SITEMAP_REVALIDATE,
  sitemapResponse,
  DEPLOY_TIME,
  type SitemapRef,
} from "@/lib/sitemap";

// Sitemap index 300s ISR bilan cache'lanadi — har so'rov backend'ga urilmaydi (#7).
export const revalidate = SITEMAP_REVALIDATE;

// /sitemap.xml — sitemap INDEX. Statik sitemap + jobs-1..N ni sanaydi.
// Backend ishlamasa total=0 bo'ladi va kamida /sitemaps/static.xml qaytadi (#10).
export async function GET(req: Request): Promise<Response> {
  const total = await fetchActiveElonTotal();

  const refs: SitemapRef[] = [{ loc: `${SITE_URL}${STATIC_SITEMAP_PATH}`, lastmod: DEPLOY_TIME }];
  const chunks = jobSitemapCount(total);
  for (let n = 1; n <= chunks; n++) {
    refs.push({ loc: `${SITE_URL}${jobsSitemapPath(n)}`, lastmod: DEPLOY_TIME });
  }

  return sitemapResponse(buildSitemapIndex(refs), req);
}
