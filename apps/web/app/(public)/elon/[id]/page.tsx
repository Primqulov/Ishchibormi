import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getElon,
  buildElonMetadata,
  buildJobPostingLd,
  notFoundMetadata,
} from "@/lib/elon-seo";
import ElonClient from "./elon-client";

type Params = { params: { id: string } };

// Har bir e'lon uchun dinamik SEO metadata (title/description/OG/Twitter/canonical/keywords).
// Butun logika lib/elon-seo.ts'da — bu yerda faqat yuklab, tayyor helper'ga uzatamiz.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const e = await getElon(params.id);
  if (!e) return notFoundMetadata();
  return buildElonMetadata(e, params.id);
}

export default async function Page({ params }: Params) {
  const e = await getElon(params.id);
  if (!/^[a-f0-9]{24}$/i.test(params.id)) notFound();
  // The server has no access to the browser's bearer session. An archived
  // listing is private, so let the authenticated client check owner access.
  // Missing public data already receives noindex metadata and no JobPosting.
  if (!e) return <ElonClient />;

  const jobPostingLd = buildJobPostingLd(e, params.id);
  // "<" ni escape qilamiz — tavsif matnida "</script>" bo'lsa ham xavfsiz bo'lsin.
  const ldJson = JSON.stringify(jobPostingLd).replace(/</g, "\\u003c");
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson }}
      />
      <ElonClient />
    </>
  );
}
