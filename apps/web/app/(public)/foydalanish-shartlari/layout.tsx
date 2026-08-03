import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foydalanish shartlari",
  description: "Ishchi Bormi platformasidan foydalanish shartlari va qoidalari.",
  alternates: { canonical: "/foydalanish-shartlari" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
