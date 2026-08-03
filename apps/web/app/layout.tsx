import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_OG_DESCRIPTION,
  SITE_KEYWORDS,
  OG_IMAGE,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
} from "@/lib/seo";
import { CONTACT, SOCIAL_SAMEAS } from "@/lib/contact";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: "/" },
  // Favicon / apple-touch-icon / shortcut — public/ fayllaridan (Metadata API).
  // Head'da dublikat bo'lmasligi uchun app/*.png|ico file-convention'lari olib
  // tashlangan; barcha ikonkalar shu yagona `icons` konfiguratsiyasidan chiqadi.
  // Barcha ikonkalar rasmiy app-ikonasidan generatsiya qilingan (public/).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/favicon-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Windows plitka (legacy Edge/IE) — rasmiy ikonadan.
  other: {
    "msapplication-TileColor": "#0F1F56",
    "msapplication-TileImage": "/mstile-150x150.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "uz_UZ",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_OG_DESCRIPTION,
    // Telegram/Facebook/LinkedIn ulashuv rasmi (metadataBase → absolyut URL).
    images: [
      { url: OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT, alt: SITE_NAME, type: "image/png" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_OG_DESCRIPTION,
    // X (Twitter) ulashuv rasmi — OG bilan bir xil (metadataBase → absolyut URL).
    images: [OG_IMAGE],
  },
  category: "business",
  formatDetection: { telephone: true },
};

// Next 15: themeColor/colorScheme viewport export'ida bo'lishi kerak (metadata
// emas). Bu `<meta name="theme-color">` teglarini beradi — mobil brauzer paneli
// va PWA ranggi manifest theme_color bilan mos (#0F1F56 — brend ko'k).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F1F56" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
  colorScheme: "light dark",
};

// Google uchun tashkilot ma'lumoti (aloqa + ijtimoiy tarmoq profillari).
const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/favicon-512x512.png`,
  image: `${SITE_URL}/favicon-512x512.png`,
  email: CONTACT.email,
  telephone: CONTACT.phoneHref.replace("tel:", ""),
  contactPoint: [
    {
      "@type": "ContactPoint",
      telephone: CONTACT.phoneHref.replace("tel:", ""),
      email: CONTACT.email,
      contactType: "customer support",
      areaServed: "UZ",
      availableLanguage: ["uz", "ru"],
    },
  ],
  sameAs: SOCIAL_SAMEAS,
};

// Sayt/brend darajasidagi ma'lumot — Google saytni nomi bilan tanishi uchun.
const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "uz",
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([organizationLd, websiteLd]).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
