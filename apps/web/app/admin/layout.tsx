"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken, getAdminRole, AdminRole } from "@/lib/api";

// roles: which non-superadmin roles may see the item. undefined => everyone;
// [] => superadmin only. superadmin always sees everything.
const nav: { href: string; label: string; roles?: AdminRole[] }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Foydalanuvchilar", roles: ["moderator"] },
  { href: "/admin/elons", label: "E'lonlar", roles: ["moderator"] },
  { href: "/admin/applications", label: "Arizalar", roles: ["moderator"] },
  { href: "/admin/categories", label: "Turkumlar" },
  { href: "/admin/notifications", label: "Tarqatma", roles: [] },
  { href: "/admin/admins", label: "Adminlar", roles: [] },
  { href: "/admin/security", label: "Xavfsizlik" },
  { href: "/admin/audit", label: "Audit log", roles: ["moderator"] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Role is read on the client only (from the JWT). Kept in state so SSR and the
  // first client render agree (null), avoiding a hydration mismatch.
  const [role, setRole] = useState<AdminRole | null>(null);
  useEffect(() => {
    if (pathname !== "/admin/login" && !getAdminToken()) router.replace("/admin/login");
    setRole(getAdminRole() as AdminRole | null);
  }, [pathname, router]);
  if (pathname === "/admin/login") return <>{children}</>;
  const logout = async () => {
    // Audit yozuvi uchun backendga xabar beramiz (token stateless — baribir
    // client tomonda tozalanadi). Xato bo'lsa ham chiqishни davom ettiramiz.
    try { await api.post("/api/admin/logout", {}, { auth: "admin" } as any); } catch { /* ignore */ }
    setAdminToken(null);
    router.replace("/admin/login");
  };
  const canSee = (n: (typeof nav)[number]) =>
    role === "superadmin" || !n.roles || (role != null && n.roles.includes(role));
  return (
    <div className="min-h-screen p-3 sm:p-4">
      <div className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <aside className="card p-3 md:p-4 flex flex-col md:sticky md:top-4 md:h-[calc(100vh-2rem)]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <div className="heading font-bold">IB Admin</div>
              {role && <div className="text-xs text-[color:var(--text-muted)] capitalize">{role}</div>}
            </div>
            <button onClick={logout} className="btn-secondary btn-sm md:hidden">Chiqish</button>
          </div>
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto scroll-y-auto -mx-1 px-1 md:flex-1">
            {nav.filter(canSee).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${pathname === n.href ? "bg-brand-navy text-white" : "hover:bg-black/5"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <button onClick={logout} className="mt-4 btn-secondary w-full hidden md:block">Chiqish</button>
        </aside>
        <main className="grid gap-4 min-w-0">{children}</main>
      </div>
    </div>
  );
}
