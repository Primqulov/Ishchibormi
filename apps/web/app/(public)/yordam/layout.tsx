import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yordam markazi",
  description:
    "Ishchi Bormi bo'yicha ko'p beriladigan savollar: ro'yxatdan o'tish, ariza berish, " +
    "ish qabul qilish, to'lov va xavfsizlik. Yordam kerakmi? Shu yerdan javob toping.",
  alternates: { canonical: "/yordam" },
  openGraph: { title: "Yordam markazi — Ishchi Bormi", url: "/yordam", type: "website" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
