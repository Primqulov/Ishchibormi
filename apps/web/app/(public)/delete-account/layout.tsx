import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hisobni o'chirish",
  description:
    "Ishchi Bormi hisobingizni qanday o'chirish mumkin, qaysi ma'lumotlar o'chadi, nima 90 kun saqlanadi va biz bilan qanday bog'lanish mumkin.",
  alternates: { canonical: "/delete-account" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
