import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Qidiruv robotlariga: ochiq sahifalarni indekslashga ruxsat, shaxsiy kabinet /
// admin / login / API yo'llarini bloklaymiz (ular indekslanmasligi kerak).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/dashboard",
          "/my-elons",
          "/process",
          "/history",
          "/notifications",
          "/feedback",
          "/profile",
          "/settings",
          "/onboarding",
          "/login",
          "/api/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
