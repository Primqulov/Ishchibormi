"use client";
import { AlertTriangle } from "lucide-react";
import { T } from "@/components/T";
import { SOCIAL } from "@/lib/contact";

/**
 * Figma "03 · Bosh sahifa → Banner/TestRejimi": amber eslatma — platforma
 * hozircha test rejimida ishlayotgani haqida.
 *
 * ATAYLAB Shell'da emas, faqat bosh sahifada chiziladi: eslatma kirish
 * nuqtasida bir marta ko'rinishi kerak, har bir sahifada takrorlanib bezor
 * qilmasligi kerak. Dizaynda ham u faqat "Bosh sahifa" freymida bor.
 *
 * Ranglar `--accent-soft` / `--accent-text` orqali olinadi — shu sababli
 * qorong'i mavzuda ham o'zi moslashadi (globals.css dagi `.dark` bloki).
 *
 * Test bosqichi tugagach: dashboard/page.tsx dagi `<TestModeBanner />`
 * qatorini va shu faylni o'chirish kifoya.
 */
export function TestModeBanner() {
  // `role="status"` ATAYLAB qo'yilmagan: u aria-live="polite" +
  // aria-atomic="true" degani, ya'ni ichidagi matn o'zgarsa — butun blok
  // qaytadan o'qib beriladi. Bu blok esa doimiy, statik eslatma; lekin <T>
  // tufayli Lotin/Kirill almashtirilganda uning matni o'zgaradi. Natijada
  // sarlavhadagi LangMenu'dan skriptni almashtirgan ekran o'qiruvchi
  // foydalanuvchi hech so'ramagan holda butun eslatmani qaytadan eshitardi.
  // Eslatma sahifaning birinchi elementi — odatdagi o'qishda u baribir
  // birinchi bo'lib o'qiladi.
  return (
    <section
      className="flex items-start sm:items-center gap-3 rounded-xl px-[18px] py-3.5"
      style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
    >
      <AlertTriangle size={18} aria-hidden className="mt-[2px] sm:mt-0 shrink-0" />

      <div className="min-w-0 flex-1 flex flex-col gap-[3px]">
        <div className="text-[14px] font-semibold leading-5">
          <T>Platforma test rejimida ishlamoqda</T>
        </div>
        {/* Bot manzili <T> ichida, lekin <a> elementi sifatida — <T> faqat
            matn bo'laklarini o'giradi, element bolalarini tegmasdan o'tkazadi.
            Shu sababli "@Ishchi_bormi_support" kirillchaga aylanib ketmaydi. */}
        <p className="text-[13px] leading-[18px]">
          <T>
            Ba'zi funksiyalar hali cheklangan va ma'lumotlar o'zgarishi mumkin. Xatolik sezsangiz,{" "}
            <a
              href={SOCIAL.support.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2 transition hover:opacity-80"
            >
              {SOCIAL.support.label}
            </a>{" "}
            ga yozing — tuzatamiz.
          </T>
        </p>
      </div>

      <span
        className="shrink-0 mt-[1px] sm:mt-0 inline-flex items-center rounded-full px-2.5 py-[5px] text-[10px] font-bold uppercase tracking-[0.4px]"
        style={{ background: "var(--card)" }}
      >
        <T>Test rejimi</T>
      </span>
    </section>
  );
}
