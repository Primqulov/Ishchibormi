import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME} — kunlik ish va ishchi bozori`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "portrait",
    background_color: "#F6F7FB",
    theme_color: "#0F1F56",
    lang: "uz",
    dir: "ltr",
    categories: ["business", "productivity"],
    // Barchasi rasmiy app-ikonasidan generatsiya qilingan.
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
