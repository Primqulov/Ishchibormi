"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Android'da ilova o'rnatilgan bo'lsa, foydalanuvchini vebdan ilovaga o'tkazadi.
 *
 * NEGA UMUMAN KERAK: Android App Links (AndroidManifest.xml, autoVerify) faqat
 * BOSILGAN havolada ishlaydi — Telegramdan, qidiruvdan, boshqa saytdan kelganda.
 * Foydalanuvchi manzilni brauzer satriga QO'LDA yozsa yoki xatcho'pdan kirsa,
 * Android ilovani ochmaydi. Bu komponent aynan o'sha bo'shliqni yopadi.
 *
 * QANDAY ISHLAYDI: `intent://` sxemasi bilan ilovani ochishga urinamiz va
 * `S.browser_fallback_url` beramiz. Ilova bo'lmasa Chrome hech qayerga
 * ketmaydi — foydalanuvchi shu sahifada qoladi. Ya'ni o'rnatmaganlar uchun
 * hech narsa o'zgarmaydi va hech qanday xato ko'rinmaydi.
 */

// Faqat AndroidManifest.xml da qamrab olingan yo'llar. Ro'yxat u yer bilan
// BIR XIL bo'lishi kerak: bu yerda ko'proq yo'l bo'lsa, ilova ochilmaydigan
// manzilga urinib, foydalanuvchini bekorga kutkazamiz.
const APP_PATHS = [/^\/$/, /^\/elonlar(\/|$)/, /^\/u\/[^/]+/];

// ATAYLAB QAMRALMAGAN (izohlar AndroidManifest.xml da batafsil):
//   /maxfiylik-siyosati, /delete-account — ilovaning o'zi bu sahifalarni
//     brauzerda ochadi; ilovaga qaytarsak tsikl hosil bo'ladi va Google Play
//     bu sahifalar vebda ochilishini talab qiladi.
//   /admin/* — admin panel faqat vebda.

const SESSION_KEY = "ib:app-redirect-tried";
const PACKAGE = "uz.ishchibormi.app";

export function OpenInApp() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Faqat Android. iOS'da Universal Links hali sozlanmagan, desktopda
    //    ilova umuman yo'q.
    const ua = navigator.userAgent || "";
    if (!/Android/i.test(ua)) return;

    // 2. Ilovaning o'z ichidagi WebView'dan kelgan bo'lsa, qayta ochmaymiz.
    if (/\bwv\b/.test(ua)) return;

    // 3. Qidiruv robotlariga tegmaymiz — indekslashga xalaqit bermasin.
    if (/bot|crawler|spider|googlebot|yandex/i.test(ua)) return;

    // 4. Chiqish yo'li: ?web=1 bilan kelgan foydalanuvchi ataylab veb
    //    versiyasini xohlaydi. Uni majburlamaymiz.
    const params = new URLSearchParams(window.location.search);
    if (params.get("web") === "1") {
      sessionStorage.setItem(SESSION_KEY, "1");
      return;
    }

    // 5. Seansda BIR MARTA. Aks holda ilovadan brauzerga qaytgan
    //    foydalanuvchi har sahifada yana ilovaga tortilib, qamalib qolardi.
    if (sessionStorage.getItem(SESSION_KEY)) return;

    // 6. Faqat ilova qamrab olgan yo'llar.
    if (!APP_PATHS.some((re) => re.test(pathname))) return;

    sessionStorage.setItem(SESSION_KEY, "1");

    const fallback = `${window.location.origin}${pathname}?web=1`;
    const intent =
      `intent://${window.location.host}${pathname}#Intent;` +
      `scheme=https;package=${PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(fallback)};end`;

    window.location.href = intent;
  }, [pathname]);

  return null;
}
