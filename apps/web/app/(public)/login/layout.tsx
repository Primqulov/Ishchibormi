import type { Metadata } from "next";

// Login sahifasi qidiruvda indekslanmasligi kerak.
export const metadata: Metadata = {
  title: "Kirish",
  description: "Ishchi Bormi hisobingizga Telegram orqali xavfsiz kiring.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
