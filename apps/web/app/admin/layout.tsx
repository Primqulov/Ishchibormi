"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileText,
  Inbox,
  Layers2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { api, getAdminToken, setAdminToken, getAdminRole, adminRefresh, AdminRole } from "@/lib/api";

// Figma "1.2 / 3.2 · Desktop karkas" ranglari. Admin paneli o'z palitrasida
// chizilgan (ko'k #004ac6, sayt brendi #0038d8 emas), shuning uchun rang
// qiymatlari kirish sahifasidagi kabi to'g'ridan-to'g'ri yozilgan.
const KO_K = "#004ac6";
const IK = "#0b1c30";
const KUL = "#434655";
const OCH_KUL = "#737686";
const HOSHIYA = "#eaecf2";
const HOSHIYA_QUYUQ = "#c3c6d7";

// roles: which non-superadmin roles may see the item. undefined => everyone;
// [] => superadmin only. superadmin always sees everything.
const nav: { href: string; label: string; icon: typeof Users; roles?: AdminRole[] }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Foydalanuvchilar", icon: Users, roles: ["moderator"] },
  { href: "/admin/elons", label: "E'lonlar", icon: FileText, roles: ["moderator"] },
  { href: "/admin/applications", label: "Arizalar", icon: Inbox, roles: ["moderator"] },
  { href: "/admin/categories", label: "Turkumlar", icon: Layers2 },
  { href: "/admin/notifications", label: "Tarqatma", icon: Megaphone, roles: [] },
  { href: "/admin/admins", label: "Adminlar", icon: UserCheck, roles: [] },
  { href: "/admin/security", label: "Xavfsizlik", icon: ShieldCheck },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, roles: ["moderator"] },
  // Xatoliklar jurnali stack trace, endpoint nomlari va modul tuzilishini
  // ochadi — support darajasidan yuqorida (backend ham `RequireRole("moderator")`).
  { href: "/admin/errors", label: "Xatoliklar", icon: TriangleAlert, roles: ["moderator"] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Role is read on the client only (from the JWT). Kept in state so SSR and the
  // first client render agree (null), avoiding a hydration mismatch.
  const [role, setRole] = useState<AdminRole | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Access token sessionStorage'da yashaydi, ya'ni brauzer yopilganda
      // yo'qoladi. Lekin sessiyaning uzoq muddatli qismi — HttpOnly
      // cookie'dagi refresh token — tirik bo'lishi mumkin. Shuning uchun
      // login sahifasiga otishdan OLDIN bir marta uni so'rab ko'ramiz.
      // Aynan shu qadam "brauzerni yopib ochsam, yana paroldan boshlayapman"
      // holatini yo'q qiladi.
      if (pathname !== "/admin/login" && !getAdminToken()) {
        const restored = await adminRefresh();
        if (cancelled) return;
        if (!restored) {
          router.replace("/admin/login");
          return;
        }
      }
      if (!cancelled) setRole(getAdminRole() as AdminRole | null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);
  if (pathname === "/admin/login") return <>{children}</>;
  const logout = async () => {
    // Audit yozuvi uchun backendga xabar beramiz (token stateless — baribir
    // client tomonda tozalanadi). Xato bo'lsa ham chiqishni davom ettiramiz.
    try { await api.post("/api/admin/logout", {}, { auth: "admin" } as any); } catch { /* ignore */ }
    setAdminToken(null);
    router.replace("/admin/login");
  };
  const canSee = (n: (typeof nav)[number]) =>
    role === "superadmin" || !n.roles || (role != null && n.roles.includes(role));
  const korinadi = nav.filter(canSee);
  return (
    <div className="min-h-screen p-3 sm:p-4" style={{ background: "#f8f9ff" }}>
      {/* Figma karkasi: 1440 kenglik, 16 hoshiya, 240 lik yon menyu, 16 tirqish. */}
      <div className="mx-auto max-w-[1440px] grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <aside
          className="ib-anim ib-anim-fade flex flex-col gap-4 rounded-2xl bg-white px-[14px] py-[18px] md:sticky md:top-4 md:h-[calc(100vh-2rem)]"
          style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[18px] font-bold leading-6" style={{ color: IK }}>IB Admin</div>
              {role && (
                <div className="text-[11px] font-medium leading-[14px]" style={{ color: OCH_KUL }}>
                  {role}
                </div>
              )}
            </div>
            <button
              onClick={logout}
              className="rounded-lg px-3 py-2 text-[13px] font-semibold md:hidden"
              style={{ color: KUL, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
            >
              Chiqish
            </button>
          </div>

          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 scroll-y-auto md:flex-1 md:flex-col md:overflow-y-auto">
            {korinadi.map((n, i) => {
              const faol = pathname === n.href;
              const Ikon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={faol ? "page" : undefined}
                  className={`ib-anim ib-anim-nav flex h-10 shrink-0 items-center gap-[10px] whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors ${
                    faol ? "font-semibold text-white" : "font-medium hover:bg-[#f4f6fc]"
                  }`}
                  style={{
                    // Har bir band navbat bilan chapdan sirg'alib chiqadi
                    // (vaqt chizig'i: 0.06 s → 0.52 s, davomiyligi 0.26 s).
                    animationDelay: `${(0.05 + i * 0.026).toFixed(3)}s`,
                    background: faol ? KO_K : undefined,
                    color: faol ? undefined : KUL,
                  }}
                >
                  <Ikon size={18} style={{ color: faol ? "#ffffff" : OCH_KUL }} aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={logout}
            className="hidden h-10 w-full items-center justify-center gap-2 rounded-lg bg-white text-[13px] font-semibold transition-colors hover:bg-[#f4f6fc] md:flex"
            style={{ color: KUL, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
          >
            <LogOut size={16} aria-hidden />
            Chiqish
          </button>
        </aside>
        <main className="grid min-w-0 gap-4">{children}</main>
      </div>
    </div>
  );
}
