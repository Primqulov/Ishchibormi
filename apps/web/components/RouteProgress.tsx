"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Sahifadan sahifaga o'tishda ekranning eng tepasida ko'rinadigan yupqa
 * yuklanish chizig'i (GitHub/YouTube'dagi kabi).
 *
 * NEGA KERAK: App Router'da havola bosilgandan keyin yangi sahifa serverdan
 * kelguncha ekranda HECH NARSA o'zgarmaydi. Sekin ulanishda bu "bosilmadimi?"
 * degan taassurot qoldiradi va foydalanuvchi havolani qayta bosadi. Chiziq
 * shu bo'shliqni to'ldiradi.
 *
 * NEGA KUTUBXONASIZ: `nprogress` va shunga o'xshashlar butun bir bog'liqlik,
 * o'z CSS fayli va App Router uchun alohida adapter talab qiladi — bularning
 * hammasi ~100 qator uchun. Loyihada bu yondashuv allaqachon bor (admin
 * paneldagi grafiklar ham tashqi kutubxonasiz, inline SVG).
 *
 * ## Navigatsiyani qanday sezamiz
 *
 * Next 14 App Router'da router hodisalari (`routeChangeStart` kabi) YO'Q —
 * ular Pages Router bilan birga olib tashlangan. Shuning uchun ikki tomondan
 * kuzatamiz:
 *
 *   BOSHLANISH — havola bosilishi (capture fazasida) va brauzerning
 *                orqaga/oldinga tugmasi (`popstate`).
 *   TUGASH     — `usePathname()` o'zgarishi, ya'ni yangi marshrut haqiqatan
 *                ekranga chiqqan payt.
 *
 * `useSearchParams()` ATAYLAB ishlatilmaydi. U ildiz layout'da chaqirilsa
 * butun sayt statik generatsiyadan chiqib ketadi (hozir 34 sahifa statik
 * quriladi) — bitta progress chizig'i uchun bu juda qimmat.
 *
 * ## Nimani qamramaydi
 *
 * Dasturiy navigatsiya (`router.push()`) chiziqni BOSHLAMAYDI: App Router uni
 * hech qanday kuzatiladigan hodisa bilan e'lon qilmaydi. Bu ataylab shunday
 * qoldirilgan — chiziqni navigatsiya tugagandan keyin ko'rsatish uni umuman
 * ko'rsatmaslikdan yomonroq, chunki u yakunlangan ishni "yuklanmoqda" deb
 * belgilardi. Saytdagi navigatsiyaning katta qismi baribir havola bosish.
 */

/** Chiziq paydo bo'lganda darhol shu yergacha sakraydi (%). */
const START_AT = 8;

/**
 * Navigatsiya tugamaguncha chiziq shu chegaradan oshmaydi (%).
 *
 * 100 ga yetkazib qo'yib bo'lmaydi: sahifa hali kelmagan bo'lsa, to'lgan
 * chiziq yolg'on gapiradi va foydalanuvchi ekran qotib qolgan deb o'ylaydi.
 */
const CEILING = 90;

/** Chegaraga yaqinlashish qadami (ms). */
const TICK_MS = 180;

/**
 * Chiziq kamida shuncha ko'rinib turadi (ms).
 *
 * Keshdagi sahifa 20 ms da ochiladi — chiziqni darhol yopsak, u ko'zga
 * chalinuvchi "chaqnash" bo'lib qolardi. Bu kechikish uni bir tekis
 * harakatga aylantiradi.
 */
const MIN_VISIBLE_MS = 260;

/** So'nish animatsiyasi (ms). */
const FADE_MS = 220;

/**
 * Zaxira: navigatsiya tugaganini bildiruvchi hech narsa kelmasa, chiziq
 * shundan keyin baribir yopiladi.
 *
 * Kerak, chunki bosilgan havola navigatsiyaga OLIB KELMASLIGI mumkin —
 * masalan server javob bermasa yoki marshrut o'sha sahifaning o'ziga
 * qaytarsa. Ekranda abadiy osilib qolgan chiziq eng yomon holat.
 */
const SAFETY_MS = 8000;

export function RouteProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Barcha taymerlar ref'da: ular render'lar orasida saqlanishi va komponent
  // yo'q qilinganda tozalanishi kerak.
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedAt = useRef(0);
  const running = useRef(false);

  const clearTimers = useCallback(() => {
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const finish = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    clearTimers();

    // Chiziq juda tez yo'qolib qolmasin — MIN_VISIBLE_MS ni to'ldiramiz.
    const elapsed = Date.now() - startedAt.current;
    const hold = Math.max(0, MIN_VISIBLE_MS - elapsed);

    timers.current.push(
      setTimeout(() => {
        setProgress(100);
        timers.current.push(
          setTimeout(() => {
            setVisible(false);
            // Keyingi navigatsiya noldan boshlansin. So'nish tugagandan
            // KEYIN nolga qaytaramiz, aks holda chiziq yopilayotib orqaga
            // sirg'alib ketardi.
            timers.current.push(setTimeout(() => setProgress(0), FADE_MS));
          }, FADE_MS),
        );
      }, hold),
    );
  }, [clearTimers]);

  const start = useCallback(() => {
    // Ketma-ket bosilgan ikkita havola chiziqni qaytadan boshlamasin —
    // birinchisi tugagunicha u shunchaki davom etadi.
    if (running.current) return;
    running.current = true;
    startedAt.current = Date.now();
    clearTimers();
    setVisible(true);
    setProgress(START_AT);

    // Chegaraga eksponensial yaqinlashish: boshida tez, oxiriga borib
    // sekinlashadi. Bu haqiqiy yuklanishga o'xshaydi va CEILING dan
    // oshmaydi.
    tick.current = setInterval(() => {
      setProgress((p) => (p >= CEILING ? p : p + (CEILING - p) * 0.12));
    }, TICK_MS);

    timers.current.push(setTimeout(finish, SAFETY_MS));
  }, [clearTimers, finish]);

  // ── Navigatsiya boshlanishi ────────────────────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Faqat oddiy chap tugma. Ctrl/Cmd/Shift bilan bosilgan havola yangi
      // oynada ochiladi, ya'ni JORIY sahifa hech qayerga ketmaydi.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.defaultPrevented) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      if (!anchor.getAttribute("href")) return;
      // Yuklab olish havolasi va yangi oynada ochiladiganlar navigatsiya emas.
      if (anchor.hasAttribute("download")) return;
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;

      let url: URL;
      try {
        url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      } catch {
        return; // mailto:, tel:, intent: — brauzer o'zi hal qiladi
      }
      // Tashqi sayt: brauzerning o'z yuklanish indikatori ishlaydi va bu
      // komponent baribir yo'q qilinadi.
      if (url.origin !== window.location.origin) return;
      // Faqat langar (#bo'lim) — sahifa almashmaydi, sakrash bo'ladi.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      start();
    }

    // Capture fazasi: yo'lda `stopPropagation()` chaqiradigan komponent bo'lsa,
    // bubbling'da bu hodisani umuman ko'rmay qolardik.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, [start]);

  // ── Navigatsiya tugashi ────────────────────────────────────────────────
  // Yangi marshrut ekranga chiqdi. Birinchi render'da `running` false, ya'ni
  // bu hech narsa qilmaydi.
  useEffect(() => {
    finish();
  }, [pathname, finish]);

  // Komponent yo'q qilinganda osilib qolgan taymer qolmasin.
  useEffect(() => clearTimers, [clearTimers]);

  if (!visible && progress === 0) return null;

  return (
    <div
      // Bezak elementi: ekran o'quvchiga aytadigan yangi ma'lumot yo'q va har
      // navigatsiyada e'lon qilinsa faqat shovqin bo'lardi.
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
    >
      <div
        className="route-progress-bar h-full bg-[color:var(--brand)]"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  );
}
