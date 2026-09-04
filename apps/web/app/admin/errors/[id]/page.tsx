import type { Metadata } from "next";
import XatolikBatafsil from "./XatolikBatafsil";

/**
 * "3.12.1 · Xatolik — batafsil" sahifasining SERVER qobig'i.
 *
 * # NEGA IKKI FAYL
 *
 * Bu sahifa dunyodagi eng maxfiy ma'lumotni ko'rsatadi: stack trace, so'rov
 * yo'llari, qurilma tavsifi, niqoblangan telefonlar. Bunday sahifa qidiruv
 * indeksiga tushmasligi kerak, `robots` esa faqat SERVER komponentidan
 * chiqarilishi mumkin (`"use client"` fayl `metadata` eksport qilolmaydi).
 *
 * `app/admin/layout.tsx` ning o'zi `"use client"`, lekin u `{children}` ni
 * oddiy prop sifatida chizadi — shu sababli uning OSTIDA server komponenti
 * turishi mumkin. Butun interaktiv qism `XatolikBatafsil` ichida.
 *
 * `title` ATAYLAB statik: xatolik matnini sarlavhaga qo'ysak, u brauzer
 * tarixiga, oyna nomiga va ekran ulashishda ko'rinadigan joyga tushardi.
 */
export const metadata: Metadata = {
  title: "Xatolik — Ishchi Bormi admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminXatolikBatafsilPage() {
  return <XatolikBatafsil />;
}
