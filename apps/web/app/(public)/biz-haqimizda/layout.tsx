import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Biz haqimizda",
  description:
    "Ishchi Bormi — O'zbekistondagi ishonchli kunlik ish va mardikor platformasi. " +
    "Vazifamiz: ish beruvchi va ishchini vositachilarsiz, xavfsiz va tez bog'lash.",
  alternates: { canonical: "/biz-haqimizda" },
  openGraph: { title: "Biz haqimizda — Ishchi Bormi", url: "/biz-haqimizda", type: "website" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
