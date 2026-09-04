"use client";
import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { HOSHIYA, IK, OCH_KUL } from "./ui";

/**
 * AdminOynaQobiq — oynaning KO'RINMAS qismi: qoplama, Escape, fokus tuzog'i,
 * orqa fonni aylanishdan to'xtatish va tashqariga bosib yopish.
 *
 * # NEGA KARKASDAN AJRATILGAN
 *
 * Figma'da admin oynasining karkasi bitta emas: 3.3a/3.5a oynalari 18 px
 * sarlavha va 28 px yopish tugmasi bilan, 3.7a (turkumlar) oynalari esa
 * 17 px sarlavha + ostida izoh + 32×32 yopish nishoni bilan chizilgan,
 * o'chirish kartasida esa boshida 44 px ikonka bor va yopish tugmasi umuman
 * yo'q. `AdminModal` ga har ko'rinish uchun bayroq qo'shish uni o'qib
 * bo'lmas holga keltirardi; karkasni sahifada qaytadan yozish esa fokus
 * tuzog'ini va Escape ishlovini nusxalashni talab qilardi — a11y va
 * xavfsizlik jihatidan eng yomon variant.
 *
 * Shu bois nazorat mantiqi shu yerda yagona qoladi, karkasni esa chaqiruvchi
 * chizadi. `AdminModal` — aynan shu qobiq ustidagi 3.3a karkasi.
 */
export function AdminOynaQobiq({
  open,
  onClose,
  title,
  maxWidth = "max-w-[435px]",
  radius = "rounded-2xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** `aria-label` uchun — ekran o'qigichi oynani nomi bilan e'lon qiladi. */
  title: string;
  /** Figma: 3.3a oynalari 435, 3.5a o'chirish 500, 3.7a oynalari 545 px. */
  maxWidth?: string;
  /** Figma: 3.3a — 16 px (rounded-2xl), 3.7a — 18 px. */
  radius?: string;
  children: React.ReactNode;
}) {
  const karta = useRef<HTMLDivElement | null>(null);

  /**
   * `onClose` ref ichida saqlanadi — bu ZARUR, bezak emas.
   *
   * Chaqiruvchi sahifalar uni joyida yozadi: `onClose={() => setBlockTarget(null)}`.
   * Bu har renderda YANGI funksiya. Quyidagi effekt uni bog'liqlik sifatida
   * olsa, sahifa har qayta chizilganda effekt to'liq tozalanib qaytadan
   * ishga tushadi. Tozalash fokusni oyna ortidagi tugmaga qaytaradi
   * (`oldiIsh?.focus?.()`), qayta ishga tushish esa oyna kartasiga oladi
   * (`karta.current?.focus()`).
   *
   * Oqibati: bloklash sababiga bitta harf yozilishi bilan — sabab matni
   * sahifa holatida turadi, ya'ni har harf sahifani qayta chizadi — fokus
   * textarea'dan uchib ketardi va keyingi harflar hech qayerga tushmasdi.
   *
   * Ref har renderda yangilanadi, lekin effektni qayta ishga tushirmaydi:
   * Escape bosilganda eng so'nggi funksiya chaqiriladi, fokus esa oyna
   * ochilganda BIR MARTA ko'chadi va yopilguncha joyida qoladi.
   */
  const yopish = useRef(onClose);
  useEffect(() => {
    yopish.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const oldiIsh = document.activeElement as HTMLElement | null;
    const kalit = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        yopish.current();
      }
    };
    window.addEventListener("keydown", kalit);
    // Sahifa orqada aylanib ketmasin.
    const oldiOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Fokus oynaga ko'chadi: aks holda Tab bosgan admin orqadagi jadval
    // tugmalariga tushib qolardi va ko'rinmayotgan tugmani bosardi.
    //
    // Lekin oyna ichidagi maydon `autoFocus` bilan fokusni allaqachon olgan
    // bo'lsa, uni tortib olmaymiz: React `autoFocus` ni commit paytida
    // qo'llaydi, bu effekt esa undan KEYIN ishlaydi — tekshiruvsiz kursor
    // maydondan chiqib ketardi.
    if (!karta.current?.contains(document.activeElement)) karta.current?.focus();
    return () => {
      window.removeEventListener("keydown", kalit);
      document.body.style.overflow = oldiOverflow;
      oldiIsh?.focus?.();
    };
    // Faqat `open` — `onClose` ataylab yo'q, sababi yuqorida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fokusni oyna ichida ushlab turamiz (oddiy tuzoq).
  const tab = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !karta.current) return;
    const nishon = karta.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nishon.length) return;
    const birinchi = nishon[0];
    const oxirgi = nishon[nishon.length - 1];
    if (e.shiftKey && document.activeElement === birinchi) {
      e.preventDefault();
      oxirgi.focus();
    } else if (!e.shiftKey && document.activeElement === oxirgi) {
      e.preventDefault();
      birinchi.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      // `mousedown` — `click` emas: oyna ichidan boshlanib tashqarida
      // tugagan tanlash (matnni belgilash) oynani yopib yubormasin.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={karta}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={tab}
        className={`w-full ${maxWidth} ${radius} bg-white outline-none`}
        style={{ boxShadow: `inset 0 0 0 1px ${HOSHIYA}, 0 18px 48px rgba(11, 28, 48, 0.18)` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Admin panel oynasi — Figma "3.3a · Foydalanuvchilar — oynalar va bo'sh holat".
 *
 * # NEGA `components/Modal.tsx` EMAS
 *
 * O'sha oyna ommaviy kabinet sahifalarida ishlatiladi va sayt brendi
 * uslubida chizilgan. Admin paneli boshqa palitrada, boshqa o'lchamlarda
 * (18 px sarlavha, 13 px ichki hoshiya, h36 tugmalar). Umumiy komponentni
 * qayta bo'yash kabinet sahifalarini ham o'zgartirib yuborardi.
 *
 * Karkas: sarlavha (px-5 py-13) → hoshiya → tana (p-20) → hoshiya →
 * oyoqcha (px-5 py-13, o'ngga tekislangan tugmalar).
 */
export function AdminModal({
  open,
  onClose,
  title,
  maxWidth = "max-w-[435px]",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Figma: bloklash/ochish oynalari 435, o'chirish oynasi 500 px. */
  maxWidth?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AdminOynaQobiq open={open} onClose={onClose} title={title} maxWidth={maxWidth}>
      <div className="flex items-center justify-between gap-3 px-5 py-[13px]">
        <h2 className="text-[18px] font-bold leading-6" style={{ color: IK }}>
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[#f4f6fc]"
          style={{ color: OCH_KUL }}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="h-px" style={{ background: HOSHIYA }} />
      <div className="p-5">{children}</div>
      {footer && (
        <>
          <div className="h-px" style={{ background: HOSHIYA }} />
          <div className="flex items-center justify-end gap-2 px-5 py-[13px]">{footer}</div>
        </>
      )}
    </AdminOynaQobiq>
  );
}
