"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, LayoutDashboard } from "lucide-react";

export default function NotFound() {
  // Admin panelda bo'lsak — admin bosh sahifasiga; aks holda saytning asosiy
  // sahifasiga qaytaramiz. Tugmalar shu kontekstga qarab farqlanadi.
  const pathname = usePathname() || "";
  const isAdmin = pathname.startsWith("/admin");

  return (
    <main className="relative min-h-screen overflow-hidden grid place-items-center px-6 text-center">
      {/* Fon — pulslanuvchi brand shakllar */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="nf-blob nf-blob-1" />
        <div className="nf-blob nf-blob-2" />
        <div className="nf-blob nf-blob-3" />
      </div>

      <div className="flex flex-col items-center gap-6 animate-fade-in">
        {/* Suzuvchi 404 */}
        <div className="relative select-none">
          <div className="nf-float text-[7rem] sm:text-[10rem] font-black leading-none tracking-tight nf-gradient">
            404
          </div>
          {/* Aylanuvchi kompas — "yo'lni yo'qotdik" */}
          <div className="absolute -top-2 -right-2 sm:top-2 sm:right-2 grid h-12 w-12 sm:h-16 sm:w-16 place-items-center rounded-2xl nf-spin"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <Compass className="h-7 w-7 sm:h-9 sm:w-9" />
          </div>
        </div>

        <div className="animate-slide-up">
          <h1 className="text-2xl sm:text-3xl font-extrabold heading tracking-tight">
            Sahifa topilmadi
          </h1>
          <p className="mt-2 text-sm sm:text-base max-w-md mx-auto text-[color:var(--text-muted)]">
            Kechirasiz, siz izlagan sahifa mavjud emas yoki ko'chirilgan bo'lishi mumkin.
            Keling, sizni asosiy sahifaga qaytaramiz.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 animate-slide-up">
          {isAdmin ? (
            <Link href="/admin" className="btn-primary gap-2 px-5 py-2.5">
              <LayoutDashboard size={18} /> Admin bosh sahifasiga qaytish
            </Link>
          ) : (
            <Link href="/" className="btn-primary gap-2 px-5 py-2.5">
              <Home size={18} /> Asosiy sahifaga qaytish
            </Link>
          )}
        </div>
      </div>

      {/* Sahifaga xos animatsiyalar */}
      <style>{`
        .nf-gradient {
          background-image: linear-gradient(120deg, var(--brand), var(--accent, #4F6CC0), var(--brand));
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: nf-shine 4s linear infinite;
        }
        @keyframes nf-shine { to { background-position: 200% center; } }

        .nf-float { animation: nf-float 4s ease-in-out infinite; }
        @keyframes nf-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }

        .nf-spin { animation: nf-spin 9s linear infinite; }
        @keyframes nf-spin { to { transform: rotate(360deg); } }

        .nf-blob {
          position: absolute;
          border-radius: 9999px;
          filter: blur(60px);
          opacity: 0.5;
          background: var(--brand);
          animation: nf-drift 12s ease-in-out infinite;
        }
        .nf-blob-1 { width: 320px; height: 320px; top: 8%;  left: 12%; }
        .nf-blob-2 { width: 260px; height: 260px; bottom: 10%; right: 14%; animation-delay: -4s; background: var(--accent, #4F6CC0); }
        .nf-blob-3 { width: 200px; height: 200px; top: 42%; left: 46%; animation-delay: -8s; opacity: 0.35; }
        @keyframes nf-drift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(30px, -24px) scale(1.08); }
          66%      { transform: translate(-24px, 20px) scale(0.94); }
        }

        @media (prefers-reduced-motion: reduce) {
          .nf-gradient, .nf-float, .nf-spin, .nf-blob { animation: none; }
        }
      `}</style>
    </main>
  );
}
