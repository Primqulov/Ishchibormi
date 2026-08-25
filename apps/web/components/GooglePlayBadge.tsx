"use client";
import { APP } from "@/lib/contact";
import { T } from "@/components/T";

/**
 * Google Play logotipi — to'rt rangli "play" uchburchagi.
 *
 * Rasm emas, inline SVG: har qanday o'lchamda aniq chiqadi, alohida so'rov
 * talab qilmaydi va sayt CSP'siga tegmaydi. Shakl A(yuqori) — B(quyi) burmasi
 * va Y(o'ng uch) uchburchagiga bo'lingan: chap ko'k, yuqori yashil, o'ng sariq
 * tilcha, quyi qizil — Google Play belgisidagi kabi.
 */
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" focusable="false">
      {/* Chap — burma (ko'k) */}
      <path d="M40 16 L300 256 L40 496 Z" fill="#00A0FF" />
      {/* Yuqori (yashil) */}
      <path d="M40 16 L368 189 L300 256 Z" fill="#00E676" />
      {/* O'ng tilcha (sariq) */}
      <path d="M368 189 L496 256 L368 323 L300 256 Z" fill="#FFCE00" />
      {/* Quyi (qizil) */}
      <path d="M300 256 L368 323 L40 496 Z" fill="#FF3A44" />
    </svg>
  );
}

/**
 * "Google Play'da yuklab olish" tugmasi.
 *
 * Google'ning rasmiy badge RASMI emas, o'z tugmamiz — rasmiy tasvirni
 * o'zgartirish/tarjima qilish brend qoidalariga zid, shuning uchun logotipni
 * o'zgarishsiz qoldirib, matnni o'z tilimizda yozamiz. Rasmiy badge kerak
 * bo'lsa: https://play.google.com/intl/en_us/badges/ dan yuklab, shu
 * komponentning ichini almashtiring — chaqiruv joylari o'zgarmaydi.
 *
 * [variant] fon rangiga qarab tanlanadi, mavzuga (light/dark) emas:
 *   "onSurface" — oq/och fon uchun qora tugma (mavzu bilan teskarilanadi);
 *   "onBrand"   — gradient/ko'k fon uchun doim oq tugma.
 * Ikkinchisi ATAYLAB mavzuga bog'liq emas: gradient bandning foni har ikkala
 * mavzuda ham to'q, ya'ni u yerda tugma doim oq bo'lishi kerak.
 */
export function GooglePlayBadge({
  variant = "onSurface",
  className = "",
}: {
  variant?: "onSurface" | "onBrand";
  className?: string;
}) {
  const skin =
    variant === "onBrand"
      ? "bg-white text-[#0B1C30] focus-visible:ring-white/50"
      : "bg-[#0B1C30] text-white dark:bg-white dark:text-[#0B1C30] focus-visible:ring-[color:var(--ring)]";

  return (
    <a
      href={APP.playStore}
      target="_blank"
      rel="noreferrer"
      className={
        "inline-flex items-center gap-3 rounded-xl px-5 py-3 transition " +
        "hover:-translate-y-0.5 hover:shadow-pop focus-visible:outline-none " +
        "focus-visible:ring-4 " +
        skin +
        " " +
        className
      }
      aria-label="Ishchi Bormi ilovasini Google Play'dan yuklab olish"
    >
      <PlayGlyph className="h-7 w-7 shrink-0" />
      <span className="flex flex-col text-left leading-none">
        {/* Saytning qolgan qismi kabi kirill yozuviga o'giriladi.
            "Google Play" esa ATAYLAB o'girilmaydi — u brend nomi. */}
        <span className="text-[10px] font-semibold uppercase tracking-[1.2px] opacity-70">
          <T>Yuklab oling</T>
        </span>
        <span className="mt-1 text-[17px] font-bold tracking-[-0.2px]">Google Play</span>
      </span>
    </a>
  );
}

export { PlayGlyph };
