import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/seo";
import LandingClient from "./landing-client";

// Bosh sahifa — canonical va title'ni belgilaydi. Open Graph / Twitter (rasm bilan)
// root layout'dan meros qilib olinadi, shuning uchun bu yerda qayta e'lon qilinmaydi.
export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

// Bosh sahifa uchun tuzilmali ma'lumot (JSON-LD): tashkilot + veb-sayt qidiruvi.
// Bu Google'ga sayt nomi, logotipi va ichki qidiruvni tushunishga yordam beradi.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      areaServed: { "@type": "Country", name: "Uzbekistan" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "uz",
      publisher: { "@id": `${SITE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function Page() {
  return (
    <>
      {/* Kontent statik bo'lsa ham "<" ni escape qilamiz — boshqa JSON-LD
          joylari bilan bir xil qoida, dinamik maydon qo'shilsa ham xavfsiz. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LandingClient />
    </>
  );
}
