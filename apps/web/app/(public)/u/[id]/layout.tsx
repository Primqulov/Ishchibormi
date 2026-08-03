import type { Metadata } from "next";
import { fetchPublicUser, SITE_NAME } from "@/lib/seo";

type Params = { params: { id: string } };

// Ochiq profil uchun dinamik metadata (foydalanuvchi ismi bilan).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const u = await fetchPublicUser(params.id);
  const name = u ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() : "";
  const title = name ? `${name} — ishchi profili` : "Foydalanuvchi profili";
  const bits = [
    u?.region ? String(u.region) : "",
  ].filter(Boolean);
  const description =
    (name ? `${name} — ` : "") +
    `${SITE_NAME} platformasidagi ishchi profili` +
    (bits.length ? `. ${bits.join(" · ")}` : "") + ".";
  return {
    title,
    description,
    alternates: { canonical: `/u/${params.id}` },
    openGraph: { title, description, url: `/u/${params.id}`, type: "profile" },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
