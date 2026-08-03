import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Maxfiylik siyosati",
  description: "Ishchi Bormi shaxsiy ma'lumotlarni qanday to'playdi, saqlaydi va himoya qiladi.",
  alternates: { canonical: "/maxfiylik-siyosati" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
