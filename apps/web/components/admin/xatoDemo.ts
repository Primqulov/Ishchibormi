/**
 * "3.12 · Xatoliklar" oilasi uchun DEMO ma'lumot.
 *
 * # NEGA BU FAYL BOR
 *
 * Dizayn (Figma 3.12.1 va 3.12.3) tasdiqlanmaguncha backend ULANMAYDI.
 * Lekin ekranni ko'rish uchun ma'lumot kerak — bo'sh karkasda "Ta'sir
 * taqsimoti" ham, "AI uchun kontekst" ham hech narsa ko'rsatmaydi.
 * Shuning uchun bu yerda haqiqiy API javobining AYNAN o'zi shaklida
 * to'ldirilgan namunalar turadi.
 *
 * # ULANISH QANDAY BO'LADI
 *
 * Barcha obyektlar `lib/api.ts` dagi `AdminErrorDetail` / `AdminErrorGroup`
 * turlarida. Ya'ni backend ulanganda o'zgarish BITTA joyda:
 * `DEMO_YOQILGAN = false` va sahifadagi `demoBatafsil(...)` o'rniga
 * `api.get<AdminErrorDetail>("/api/admin/errors/" + id)`. Komponentlarga
 * umuman tegilmaydi — ular allaqachon shu turlar bilan ishlaydi.
 *
 * # NEGA DEMO KO'RINIB TURADI
 *
 * Sahifada doim sariq "Demo ma'lumot" yo'lagi chiqadi. Diagnostika
 * ekranida eng xavfli xato — o'ylab topilgan raqamni haqiqiy deb qabul
 * qilish: admin "46 hodisa" ni ko'rib, dasturchini yo'q xatolikni
 * qidirishga yuborishi mumkin. Shuning uchun yorliq ixtiyoriy emas.
 *
 * # NIQOBLASH
 *
 * `niqobla()` — serverdagi `internal/admin/errexport.go · maskSecrets` ning
 * qisqartirilgan nusxasi. U DEMO uchun: eksport matnida niqob qanday
 * ko'rinishini ko'rsatadi. HAQIQIY himoya serverda — matn tug'ilgan joyda
 * niqoblanadi va uni o'chiradigan parametr API'da umuman yo'q.
 */
import type {
  AdminErrorDetail,
  AdminErrorGroup,
  AdminErrorStats,
  XatoFoydalanuvchi,
  XatoHodisa,
  XatoKontekst,
  XatoKontekstKalit,
  XatoMasul,
  XatoNamuna,
  XatoQadam,
  XatoQurilma,
  XatoTasir,
  XatoUstun,
} from "@/lib/api";
import { DARAJA, HOLAT, MODUL, p2 } from "./xato";

/**
 * Bitta kalit: `true` qilinsa butun demo qatlami yoqiladi.
 *
 * Backend (`GET /api/admin/errors/...`) ishlab turgani uchun O'CHIRILGAN.
 * Yoqilgan bo'lsa, so'rov yiqilganda ekran o'ylab topilgan ma'lumotni
 * ko'rsatadi — dizayn ustida ishlashda qulay, lekin ishlaydigan panelda
 * xavfli: "46 ta hodisa" ni haqiqiy deb o'qigan admin bo'lmagan nosozlik
 * bo'yicha qaror qabul qiladi. Sariq ogohlantirish bor, lekin u
 * o'qilmasligi mumkin — shuning uchun sukut bo'yicha `false`.
 */
export const DEMO_YOQILGAN = false;

const DAQ = 60_000;
const SOAT = 60 * DAQ;
const KUN = 24 * SOAT;

const iso = (ms: number) => new Date(ms).toISOString();

/* ── Qurilmalar (Figma 3.12.3 · H) ────────────────────────────────────
   Uchta klient — uchta maydonlar to'plami, ustiga to'rtinchi "tor" holat.

   Bo'sh qoldirilgan maydonlar ATAYLAB, lekin har biri BOSHQA sabab bilan:
   "Qurilma va muhit" kartasi uchta sababni uchta boshqa so'z bilan yozadi
   (`xato.ts` · TEGISHSIZ / NOMALUM / YOQ). Demo shu uch yo'lni ham
   qamrashi kerak, aks holda kartaning shoxlanishi sinalmay qoladi:

   · iOS'da `apiLevel` yo'q → "—": bunday tushuncha mavjud emas.
   · Veb'da `ram`, `storage`, `battery` yo'q → "ma'lum emas": brauzer
     ularni standart yo'l bilan bermaydi.
   · `QURILMA_TOR` da yarmi yo'q → "aniqlanmagan": eski klient
     `X-Client-Device` sarlavhasini yubormaydi. Bu YAGONA tuzatiladigan
     holat, shuning uchun uni ekranda ko'rish muhim. */

const QURILMA_ANDROID: XatoQurilma = {
  platform: "android",
  brand: "Xiaomi",
  model: "Redmi Note 12",
  modelCode: "2201117TG",
  os: "Android",
  osVersion: "14",
  apiLevel: "34",
  appVersion: "1.4.2",
  build: "118",
  flutter: "3.35.1",
  dart: "3.9.0",
  screen: "1080 × 2400 · 2.75x",
  ram: "5.6 / 8.0 GB bo'sh",
  storage: "12.4 GB bo'sh",
  locale: "uz_UZ · Asia/Tashkent",
  network: "mobil (4G)",
  battery: "34% · quvvatlanmayapti",
  emulator: "yo'q · yo'q",
  orientation: "portret",
};

const QURILMA_IOS: XatoQurilma = {
  platform: "ios",
  brand: "Apple",
  model: "iPhone 13",
  modelCode: "iPhone14,5",
  os: "iOS",
  osVersion: "17.5.1",
  appVersion: "1.4.2",
  build: "118",
  flutter: "3.35.1",
  dart: "3.9.0",
  screen: "1170 × 2532 · 3.0x",
  ram: "2.1 / 4.0 GB bo'sh",
  storage: "34.8 GB bo'sh",
  locale: "uz_UZ · Asia/Tashkent",
  network: "Wi-Fi",
  battery: "78% · quvvatlanmoqda",
  emulator: "yo'q · yo'q",
  orientation: "portret",
};

const QURILMA_WEB: XatoQurilma = {
  platform: "web",
  brand: "Desktop",
  os: "Windows",
  osVersion: "11",
  appVersion: "1.4.2",
  build: "a1c3f9d",
  // Veb'da "ekran · oyna" ikkita o'lcham: monitor va brauzer oynasi.
  // Ikkinchisi muhim — javob beruvchi tartib (responsive) xatoliklari
  // aynan oyna kengligiga bog'lanadi.
  screen: "1920 × 1080 · oyna 1512 × 862",
  locale: "uz-UZ · Asia/Tashkent",
  network: "online (4g hint)",
  orientation: "landshaft",
  browser: "Chrome 128",
  engine: "Blink",
};

/**
 * ESKI klient: `X-Client-Device` sarlavhasini yubormaydi.
 *
 * Faqat platforma, OS va ilova versiyasi bor — ular `X-Client-Platform`
 * va `User-Agent` dan chiqadi (`pkg/httpx/platform.go`). Qolgan maydonlar
 * "aniqlanmagan" bo'lib chiqadi va bu ekranda KO'RINISHI kerak: shu
 * yozuv yig'ish zanjirining hali ulanmaganini bildiradi.
 */
const QURILMA_TOR: XatoQurilma = {
  platform: "android",
  os: "Android",
  osVersion: "13",
  appVersion: "1.4.1",
  build: "114",
  network: "mobil (4G)",
};

/* ── Yordamchilar ─────────────────────────────────────────────────── */

function soatlik(hozir: number, qiymatlar: number[]): XatoUstun[] {
  const b = new Date(hozir);
  b.setMinutes(0, 0, 0);
  const oxiri = b.getTime();
  const n = qiymatlar.length;
  return qiymatlar.map((v, i) => ({ at: iso(oxiri - (n - 1 - i) * SOAT), n: v }));
}

function cho_qqi(h: XatoUstun[]): XatoUstun {
  return h.reduce((eng, u) => (u.n > eng.n ? u : eng), h[0] ?? { at: iso(Date.now()), n: 0 });
}

/** Ulushlar ro'yxatini foiz bilan to'ldiradi (jami bo'yicha). */
function ulush(jami: number, juftlar: [string, number][]) {
  return juftlar.map(([key, n]) => ({ key, n, pct: Math.round((n / jami) * 100) }));
}

/* ── Namunalar ────────────────────────────────────────────────────── */

type Xom = {
  guruh: Omit<AdminErrorGroup, "firstSeenAt" | "lastSeenAt">;
  /** `hozir` dan necha millisekund oldin oxirgi hodisa bo'lgan. */
  oxirgi: number;
  /** `hozir` dan necha millisekund oldin birinchi hodisa bo'lgan. */
  birinchi: number;
  env: Record<string, string>;
  soatlar: number[];
  namuna?: (crash: number) => XatoNamuna;
  hodisalar: (hozir: number) => XatoHodisa[];
  tasir: XatoTasir;
  odamlar: XatoFoydalanuvchi[];
  namunaSoni: number;
  /**
   * `startedAt` dan keyin kelgan hodisalar soni (`AdminErrorDetail.sinceStarted`).
   *
   * Guruh maydoni EMAS, batafsil javobning maydoni — shuning uchun
   * `guruh` ichida emas, shu yerda turadi. Faqat "Bartaraf etilmoqda"
   * holatidagi kartada ko'rinadi (Figma 3.12.3 · J · "Boshlanganidan beri").
   */
  yangiHodisa?: number;
};

function qadamlar(crash: number): XatoQadam[] {
  return [
    { at: iso(crash - 20_000), kind: "nav", text: "Kirish tekshiruvi o'tdi · /admin/dashboard" },
    { at: iso(crash - 16_000), kind: "screen", text: "Foydalanuvchilar ro'yxati ochildi · /admin/users" },
    { at: iso(crash - 9_000), kind: "action", text: "Filtr qo'llandi · rol = ishchi" },
    { at: iso(crash - 5_000), kind: "request", text: "GET /api/admin/users (3-sahifa) → 200 · 412 ms" },
    { at: iso(crash - 2_000), kind: "action", text: "4-sahifa tugmasi bosildi" },
    { at: iso(crash - 300), kind: "request", text: "GET /api/admin/users (4-sahifa) → 500 · 4 812 ms" },
    { at: iso(crash - 150), kind: "response", text: 'Body: {"error":{"code":"internal","message":"…"}}' },
    { at: iso(crash), kind: "crash", text: "_TypeError — ilova yopildi" },
  ];
}

const XOM: Xom[] = [
  /* ── 1 · Figma 3.12.1 dagi asosiy namuna ─────────────────────────── */
  {
    guruh: {
      id: "err-2f91c4",
      fingerprint: "2f91c4d7a3b810e5",
      ref: "ERR-2F91C4",
      code: "flutter.uncaught_exception",
      module: "admin_app",
      severity: "critical",
      runtime: "Admin ilova",
      title: "Ilova ishdan chiqdi — ushlanmagan xato",
      where: "core/network/api_client.dart:292",
      message: "type 'Null' is not a subtype of type 'Map<String, dynamic>' in type cast",
      path: "/api/admin/users",
      lastDevice: "Xiaomi Redmi Note 12 · Android 14",
      lastAppVersion: "1.4.2 (118)",
      count: 46,
      usersCount: 5,
      status: "new",
      assignee: "Aziz Karimov · superadmin",
      activity: [],
    },
    oxirgi: 6 * DAQ,
    birinchi: 20 * KUN,
    // `version` ataylab yo'q: binar `-ldflags` siz yig'ilgan, panel buni
    // "aniqlanmagan" deb ko'rsatadi (Figma 3.12.1 · "Backend versiyasi").
    env: { appEnv: "production", server: "api-prod-01" },
    soatlar: [1, 0, 0, 1, 1, 1, 2, 4, 9, 5, 3, 2, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 0, 2],
    namuna: (crash) => ({
      at: iso(crash),
      device: QURILMA_ANDROID,
      deviceLabel: "Xiaomi Redmi Note 12 · Android 14",
      message: "type 'Null' is not a subtype of type 'Map<String, dynamic>' in type cast",
      stack: [
        "#0 ApiClient.get · core/network/api_client.dart:292:24",
        "#1 UsersRepository.fetchPage · data/users_repository.dart:64:18",
        "#2 UsersCubit.load · features/users/cubit/users_cubit.dart:41:22",
        "#3 _rootRunUnary · dart:async/zone.dart:1407:47",
        "#4 _FutureListener.handleValue · dart:async/future_impl.dart:158:18",
        "#5 Future._propagateToListeners · dart:async/future_impl.dart:842:45",
      ],
      steps: qadamlar(crash),
      method: "GET",
      path: "/api/admin/users",
      status: 500,
      durationMs: 2340,
      requestId: "01JK7QF3B8ZR4M",
      actor: "Aziz Karimov",
      actorRole: "superadmin",
    }),
    hodisalar: (h) => [
      { at: iso(h - 6 * DAQ), user: "Aziz Karimov", platform: "Android 14", app: "1.4.2 (118)", network: "4G", status: "500", durationMs: 4812, requestId: "01JK7QF3B8ZR4M" },
      { at: iso(h - 42 * DAQ), user: "#A1B2C3", platform: "Android 13", app: "1.4.2 (118)", network: "Wi-Fi", status: "500", durationMs: 3980, requestId: "01JK7Q8M2XV0PC" },
      { at: iso(h - 2 * SOAT), user: "Nodira Rasulova", platform: "Android 14", app: "1.4.2 (118)", network: "4G", status: "timeout", durationMs: 15000, requestId: "01JK7PZ4TR9HKD" },
      { at: iso(h - 5 * SOAT), user: "#7F30D1", platform: "Android 12", app: "1.4.1 (114)", network: "3G", status: "500", durationMs: 5210, requestId: "01JK7NC1WB6ELS" },
      { at: iso(h - 9 * SOAT), user: "Sardor Tursunov", platform: "iOS 17.5", app: "1.4.2 (118)", network: "Wi-Fi", status: "500", durationMs: 2740, requestId: "01JK7M0J5QA3ZT" },
    ],
    tasir: {
      brand: ulush(46, [["Xiaomi / Redmi", 19], ["Samsung", 14], ["Infinix", 5], ["Tecno", 4], ["Apple", 2], ["Boshqa", 2]]),
      os: ulush(46, [["Android 14", 24], ["Android 13", 13], ["Android 12", 7], ["iOS 17", 2]]),
      app: ulush(46, [["1.4.2 (118)", 36], ["1.4.1 (114)", 8], ["1.4.0 (109)", 2]]),
    },
    odamlar: [
      { id: "u1", label: "Aziz Karimov", sub: "superadmin · +998 90 ••• •• 42", count: 3, admin: true },
      { id: "u2", label: "Nodira Rasulova", sub: "moderator · +998 93 ••• •• 17", count: 1, admin: true },
      { id: "u3", label: "Sardor Tursunov", sub: "support · +998 97 ••• •• 05", count: 1, admin: true },
    ],
    namunaSoni: 20,
  },

  /* ── 2 · Bartaraf etilmoqda (Figma 3.12.3 · J) · veb klient ──────── */
  {
    guruh: {
      id: "err-7a3d18",
      fingerprint: "7a3d1893fe20cc41",
      ref: "ERR-7A3D18",
      code: "internal",
      module: "backend",
      severity: "high",
      runtime: "Backend",
      title: "Server ichki xatosi (500) — e'lon yaratishda",
      where: "internal/elon/service.go:214",
      message: "mongo: transaction aborted (WriteConflict) on elons.insert",
      path: "/api/elons",
      lastDevice: "Chrome 128 · Windows 11",
      lastAppVersion: "1.4.2 (a1c3f9d)",
      count: 128,
      usersCount: 31,
      status: "fixing",
      assignee: "Sardor Rasulov · admin",
      plannedVersion: "1.4.3",
      fixNote: "Tranzaksiyani qayta urinish bilan o'rash — WriteConflict vaqtinchalik.",
      activity: [],
    },
    oxirgi: 24 * DAQ,
    birinchi: 9 * KUN,
    env: { appEnv: "production", server: "api-prod-01", version: "1.4.2+a1c3f9d" },
    soatlar: [2, 1, 3, 2, 4, 6, 5, 7, 4, 3, 5, 6, 8, 5, 4, 3, 2, 4, 6, 7, 5, 3, 2, 1],
    namuna: (crash) => ({
      at: iso(crash),
      device: QURILMA_WEB,
      deviceLabel: "Chrome 128 · Windows 11",
      message: "mongo: transaction aborted (WriteConflict) on elons.insert",
      stack: [
        "goroutine 41 [running]:",
        "internal/elon.(*Service).Create · internal/elon/service.go:214",
        "internal/elon.(*Handler).PostElon · internal/elon/handler.go:88",
        "net/http.HandlerFunc.ServeHTTP · net/http/server.go:2171",
        "net/http.(*conn).serve · net/http/server.go:2012",
      ],
      steps: [
        { at: iso(crash - 26_000), kind: "nav", text: "Boshqaruv panelidan e'lonlarga o'tildi · /admin/elons" },
        { at: iso(crash - 12_000), kind: "screen", text: "E'lon yaratish oynasi ochildi · /admin/elons/yangi" },
        { at: iso(crash - 4_000), kind: "action", text: "«Saqlash» tugmasi bosildi" },
        { at: iso(crash - 200), kind: "request", text: "POST /api/elons → 500 · 1 890 ms" },
        { at: iso(crash), kind: "response", text: 'Body: {"error":{"code":"internal","message":"…"}}' },
      ],
      method: "POST",
      path: "/api/elons",
      status: 500,
      durationMs: 1890,
      requestId: "01JK7RB6QK2W8N",
      actor: "Nodira Rasulova",
      actorRole: "moderator",
    }),
    hodisalar: (h) => [
      { at: iso(h - 24 * DAQ), user: "Nodira Rasulova", platform: "Web · Chrome 128", app: "1.4.2 (a1c3f9d)", network: "online", status: "500", durationMs: 1890, requestId: "01JK7RB6QK2W8N" },
      { at: iso(h - 70 * DAQ), user: "#C4E10B", platform: "Android 14", app: "1.4.2 (118)", network: "4G", status: "500", durationMs: 2110, requestId: "01JK7R02HM4DYP" },
      { at: iso(h - 3 * SOAT), user: "#88AF2D", platform: "Web · Firefox 130", app: "1.4.2 (a1c3f9d)", network: "online", status: "500", durationMs: 1740, requestId: "01JK7PK9SD1TXA" },
      { at: iso(h - 6 * SOAT), user: "Aziz Karimov", platform: "Web · Chrome 128", app: "1.4.2 (a1c3f9d)", network: "online", status: "500", durationMs: 2980, requestId: "01JK7NN3GC7VQE" },
      { at: iso(h - 11 * SOAT), user: "#3B7C55", platform: "iOS 17.5", app: "1.4.2 (118)", network: "Wi-Fi", status: "500", durationMs: 1620, requestId: "01JK7KD8ZP0RUH" },
    ],
    tasir: {
      brand: ulush(128, [["Desktop / brauzer", 71], ["Samsung", 24], ["Xiaomi / Redmi", 18], ["Apple", 9], ["Boshqa", 6]]),
      os: ulush(128, [["Windows 11", 58], ["Android 14", 31], ["Android 13", 20], ["macOS 14", 11], ["iOS 17", 8]]),
      app: ulush(128, [["1.4.2 (a1c3f9d)", 84], ["1.4.2 (118)", 33], ["1.4.1 (114)", 11]]),
    },
    odamlar: [
      { id: "u2", label: "Nodira Rasulova", sub: "moderator · +998 93 ••• •• 17", count: 9, admin: true },
      { id: "u1", label: "Aziz Karimov", sub: "superadmin · +998 90 ••• •• 42", count: 6, admin: true },
      { id: "u9", label: "#C4E10B", sub: "foydalanuvchi · +998 91 ••• •• 30", count: 4 },
    ],
    namunaSoni: 20,
    yangiHodisa: 11,
  },

  /* ── 3 · Bartaraf etildi (Figma 3.12.3 · J) · iOS klient ─────────── */
  {
    guruh: {
      id: "err-9c42b7",
      fingerprint: "9c42b7115ad9006f",
      ref: "ERR-9C42B7",
      code: "otp_send_failed",
      module: "external",
      severity: "medium",
      runtime: "OTP bot",
      title: "OTP kodi foydalanuvchiga yetmadi",
      where: "internal/otp/sender.go:96",
      message: "eskiz: 429 too many requests (daily quota exceeded)",
      path: "/api/auth/otp",
      lastDevice: "Apple iPhone 13 · iOS 17.5.1",
      lastAppVersion: "1.4.2 (118)",
      count: 74,
      usersCount: 62,
      status: "resolved",
      assignee: "Sardor Rasulov · admin",
      // `plannedVersion` yopilgan guruhda ham qoladi: tuzatish qaysi
      // versiyaga REJALASHTIRILGANI va qaysinisida CHIQQANI ikki xil
      // savol (rejadan kechikish shu ikkisidan ko'rinadi).
      plannedVersion: "1.4.3",
      fixedVersion: "1.4.3 (121)",
      closedVersion: "1.4.3",
      resolvedBy: "Sardor Rasulov · admin",
      fixNote: "Ikkinchi provayderga avtomatik o'tish qo'shildi.",
      activity: [],
    },
    // Oxirgi hodisa 7 kun oldin, yopilishi esa undan bir kun keyin:
    // "Tekshiruv" qatori shu ikki sanadan "7 kundan beri takrorlanmadi"
    // ni hisoblaydi (Figma 3.12.3 · J namunasi).
    oxirgi: 7 * KUN,
    birinchi: 26 * KUN,
    env: { appEnv: "production", server: "api-prod-02", version: "1.4.3+d90f21c" },
    soatlar: new Array(24).fill(0),
    namuna: (crash) => ({
      at: iso(crash),
      device: QURILMA_IOS,
      deviceLabel: "Apple iPhone 13 · iOS 17.5.1",
      message: "eskiz: 429 too many requests (daily quota exceeded)",
      stack: [
        "internal/otp.(*Sender).Send · internal/otp/sender.go:96",
        "internal/auth.(*Service).RequestOTP · internal/auth/service.go:141",
        "internal/auth.(*Handler).PostOTP · internal/auth/handler.go:52",
      ],
      // Uchinchi qatordagi `+9989*****42` — DEMO emas, `errlog.maskPhone`
      // natijasining aynan o'zi. Qadamlar kartasi ostidagi "matn
      // niqoblanadi" degan izoh shu qatorda ko'rinib turishi kerak, aks
      // holda uni tekshirib bo'lmaydigan va'da deb o'qish mumkin.
      steps: [
        { at: iso(crash - 21_000), kind: "nav", text: "Ilova ochildi · boshlang'ich ekran" },
        { at: iso(crash - 8_000), kind: "screen", text: "Kirish oynasi ochildi · /kirish" },
        { at: iso(crash - 3_000), kind: "action", text: "Telefon kiritildi (+9989*****42), «Kod olish» bosildi" },
        { at: iso(crash - 200), kind: "request", text: "POST /api/auth/otp → 502 · 920 ms" },
        { at: iso(crash), kind: "response", text: 'Body: {"error":{"code":"bad_gateway","message":"…"}}' },
      ],
      method: "POST",
      path: "/api/auth/otp",
      status: 502,
      durationMs: 920,
      requestId: "01JK4T7XH0N5BF",
    }),
    hodisalar: (h) => [
      { at: iso(h - 7 * KUN), user: "#5D91A0", platform: "iOS 17.5", app: "1.4.2 (118)", network: "Wi-Fi", status: "502", durationMs: 920, requestId: "01JK4T7XH0N5BF" },
      { at: iso(h - 7 * KUN - 40 * DAQ), user: "#0F62B8", platform: "Android 13", app: "1.4.2 (118)", network: "4G", status: "502", durationMs: 1040, requestId: "01JK4SPA6M2YRW" },
      { at: iso(h - 8 * KUN), user: "#E27744", platform: "Android 14", app: "1.4.2 (118)", network: "4G", status: "502", durationMs: 880, requestId: "01JK4QB1KZ8CVN" },
    ],
    tasir: {
      brand: ulush(74, [["Samsung", 26], ["Xiaomi / Redmi", 21], ["Apple", 15], ["Infinix", 7], ["Boshqa", 5]]),
      os: ulush(74, [["Android 14", 31], ["Android 13", 22], ["iOS 17", 15], ["Android 12", 6]]),
      app: ulush(74, [["1.4.2 (118)", 61], ["1.4.1 (114)", 10], ["1.4.0 (109)", 3]]),
    },
    odamlar: [
      { id: "u21", label: "#5D91A0", sub: "foydalanuvchi · +998 94 ••• •• 88", count: 3 },
      { id: "u22", label: "#0F62B8", sub: "foydalanuvchi · +998 99 ••• •• 12", count: 2 },
      { id: "u23", label: "#E27744", sub: "foydalanuvchi · +998 88 ••• •• 61", count: 2 },
    ],
    namunaSoni: 12,
  },

  /* ── 4 · Qayta paydo bo'ldi — TIZIM qo'ygan holat ────────────────── */
  {
    guruh: {
      id: "err-5e10aa",
      fingerprint: "5e10aa4b7c33ef92",
      ref: "ERR-5E10AA",
      code: "db_unavailable",
      module: "db",
      severity: "critical",
      baseSeverity: "high",
      runtime: "Backend",
      title: "Ma'lumotlar bazasiga ulanib bo'lmadi",
      where: "internal/store/mongo.go:58",
      message: "server selection timeout: no reachable servers",
      path: "/api/elons",
      lastDevice: "Chrome 128 · Windows 11",
      lastAppVersion: "1.4.3 (a1c3f9d)",
      count: 19,
      usersCount: 19,
      status: "regressed",
      assignee: "Jasur Umarov · superadmin",
      // Regressiya kartasi uchta savolga javob beradi: qaysi versiyada
      // YOPILGAN edi (`closedVersion`), qachon qaytdi (`reopenedAt` —
      // quyida `qur` da hisoblanadi) va qaysi versiyada qaytdi
      // (`lastAppVersion`). Build raqami ataylab boshqa: yopilishi
      // mobil relizda, qaytishi esa veb build'da ko'rilgan.
      plannedVersion: "1.4.2",
      fixedVersion: "1.4.2 (118)",
      closedVersion: "1.4.2 (118)",
      resolvedBy: "Sardor Rasulov · admin",
      fixNote: "Ulanish hovuzi kattalashtirildi, timeout 30 s ga ko'tarildi.",
      activity: [],
    },
    oxirgi: 51 * DAQ,
    birinchi: 34 * KUN,
    env: { appEnv: "production", server: "api-prod-01", version: "1.4.3+d90f21c" },
    soatlar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 4, 4, 3],
    namuna: (crash) => ({
      at: iso(crash),
      device: QURILMA_WEB,
      deviceLabel: "Chrome 128 · Windows 11",
      message: "server selection timeout: no reachable servers",
      stack: [
        "internal/store.(*Mongo).Ping · internal/store/mongo.go:58",
        "internal/elon.(*Repo).List · internal/elon/repo.go:73",
        "internal/elon.(*Handler).GetElons · internal/elon/handler.go:41",
      ],
      // So'rov va javob orasidagi 30 soniya — `durationMs` ning o'zi.
      // Qadamlar kartasida bu ko'zga tashlanadi: foydalanuvchi yarim
      // daqiqa kutgan va shundan keyingina xatolik ko'rgan.
      steps: [
        { at: iso(crash - 47_000), kind: "nav", text: "Bosh sahifadan e'lonlarga o'tildi · /elonlar" },
        { at: iso(crash - 44_000), kind: "screen", text: "E'lonlar ro'yxati ochildi · /elonlar" },
        { at: iso(crash - 32_000), kind: "action", text: "«Yangilash» tugmasi bosildi" },
        { at: iso(crash - 30_000), kind: "request", text: "GET /api/elons → 503 · 30 000 ms" },
        { at: iso(crash), kind: "response", text: 'Body: {"error":{"code":"server_unavailable","message":"…"}}' },
      ],
      method: "GET",
      path: "/api/elons",
      status: 503,
      durationMs: 30000,
      requestId: "01JK7RC0PB9JMX",
    }),
    hodisalar: (h) => [
      { at: iso(h - 51 * DAQ), user: "#22B0C9", platform: "Web · Chrome 128", app: "1.4.3 (a1c3f9d)", network: "online", status: "503", durationMs: 30000, requestId: "01JK7RC0PB9JMX" },
      { at: iso(h - 58 * DAQ), user: "#6A31F2", platform: "Android 14", app: "1.4.3 (121)", network: "4G", status: "503", durationMs: 30000, requestId: "01JK7R9E4L0KTD" },
      { at: iso(h - 66 * DAQ), user: "#91DE07", platform: "Web · Safari 17", app: "1.4.3 (a1c3f9d)", network: "online", status: "503", durationMs: 30000, requestId: "01JK7R4W8S6NHA" },
    ],
    tasir: {
      brand: ulush(19, [["Desktop / brauzer", 11], ["Samsung", 4], ["Xiaomi / Redmi", 3], ["Apple", 1]]),
      os: ulush(19, [["Windows 11", 9], ["Android 14", 6], ["macOS 14", 2], ["iOS 17", 2]]),
      app: ulush(19, [["1.4.3 (a1c3f9d)", 12], ["1.4.3 (121)", 7]]),
    },
    odamlar: [
      { id: "u31", label: "#22B0C9", sub: "foydalanuvchi · +998 90 ••• •• 74", count: 2 },
      { id: "u32", label: "#6A31F2", sub: "foydalanuvchi · +998 93 ••• •• 09", count: 2 },
    ],
    namunaSoni: 8,
  },

  /* ── 5 · Kuzatilmoqda · qurilma ma'lumoti YO'Q (bo'sh holat) ────── */
  {
    guruh: {
      id: "err-1d77e2",
      fingerprint: "1d77e2c0aa54bb31",
      ref: "ERR-1D77E2",
      code: "job_panic",
      module: "jobs",
      severity: "high",
      runtime: "Fon jarayoni",
      title: "Kechalik hisobot jarayoni uzildi",
      where: "internal/jobs/report.go:132",
      message: "runtime error: index out of range [7] with length 5",
      count: 7,
      usersCount: 0,
      status: "watching",
      note: "Har kecha 03:00 da takrorlanmoqda, foydalanuvchiga ta'siri yo'q.",
      activity: [],
    },
    oxirgi: 11 * SOAT,
    birinchi: 6 * KUN,
    env: { appEnv: "production", server: "api-prod-01", version: "1.4.2+a1c3f9d" },
    soatlar: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    // `namuna` YO'Q: fon jarayonida mijoz ham, qurilma ham bo'lmaydi.
    // Ekran buni "qurilma ma'lumoti yozilmagan" deb ko'rsatishi kerak.
    hodisalar: (h) => [
      { at: iso(h - 11 * SOAT), platform: "Server", status: "panic" },
      { at: iso(h - 35 * SOAT), platform: "Server", status: "panic" },
    ],
    tasir: { brand: [], os: [], app: [] },
    odamlar: [],
    namunaSoni: 0,
  },

  /* ── 6 · E'tiborsiz qoldirilgan — sabab MAJBURIY ─────────────────── */
  {
    guruh: {
      id: "err-b83f09",
      fingerprint: "b83f0977e1c2d485",
      ref: "ERR-B83F09",
      code: "image_upload_timeout",
      module: "external",
      severity: "low",
      runtime: "Backend",
      title: "Rasm yuklashda tashqi xotira javob bermadi",
      where: "internal/media/upload.go:77",
      message: "s3: request timeout after 20s",
      path: "/api/media",
      lastDevice: "Samsung Galaxy A54 · Android 13",
      lastAppVersion: "1.4.1 (114)",
      count: 3,
      usersCount: 3,
      status: "ignored",
      ignoreReason: "Provayder tomonidagi vaqtinchalik uzilish — 12.08 da hal qilingan, bizning kodga tegishli emas.",
      activity: [],
    },
    oxirgi: 19 * KUN,
    birinchi: 21 * KUN,
    env: { appEnv: "production", server: "api-prod-02", version: "1.4.1+7bd0e12" },
    soatlar: new Array(24).fill(0),
    // Namuna ESKI klientdan (`QURILMA_TOR`): brend, model, RAM va batareya
    // yo'q. Bu demoning yagona "aniqlanmagan" holati — karta bo'sh
    // maydonni "—" yoki "ma'lum emas" dan farqli so'z bilan yozishi shu
    // guruhda ko'rinadi (Figma 3.12.3 · H · ichki eslatma).
    //
    // `steps` ham ataylab yo'q: eski klient breadcrumb yubormaydi. Ya'ni
    // NAMUNA BOR, lekin qadamlar yo'q — "Xatolikdan oldingi qadamlar"
    // kartasining tushuntirish matni aynan shu guruhda sinaladi
    // (5-guruhda esa namunaning o'zi yo'q, u boshqa yo'l).
    namuna: (crash) => ({
      at: iso(crash),
      device: QURILMA_TOR,
      message: "s3: request timeout after 20s",
      stack: [
        "internal/media/upload.go:77 · uploadObject",
        "internal/media/handler.go:41 · (*Handler).Create",
        "net/http.HandlerFunc.ServeHTTP",
      ],
      method: "POST",
      path: "/api/media",
      status: 504,
      durationMs: 20_000,
      requestId: "01JK4H2R7Y5MPD",
      actor: "#DD40A1",
      actorRole: "foydalanuvchi",
    }),
    hodisalar: (h) => [
      { at: iso(h - 19 * KUN), user: "#DD40A1", platform: "Android 13", app: "1.4.1 (114)", network: "4G", status: "timeout", durationMs: 20000 },
    ],
    tasir: {
      brand: ulush(3, [["Samsung", 2], ["Xiaomi / Redmi", 1]]),
      os: ulush(3, [["Android 13", 2], ["Android 12", 1]]),
      app: ulush(3, [["1.4.1 (114)", 3]]),
    },
    odamlar: [{ id: "u41", label: "#DD40A1", sub: "foydalanuvchi · +998 97 ••• •• 26", count: 3 }],
    namunaSoni: 3,
  },
];

/* ── Amallar tarixi ───────────────────────────────────────────────────
   Tasma har bir yozuv uchun alohida yozilmaydi: u holatdan KELIB CHIQADI.
   Shunda demo ichida qarama-qarshilik bo'lmaydi — "Yangi" deb turgan
   guruh tarixida "hal qilindi" yozuvi paydo bo'lmaydi. */
function tarix(
  g: AdminErrorGroup,
  birinchiMs: number,
  oxirgiMs: number,
  halMs: number | null,
  qaytdiMs: number | null,
): AdminErrorGroup["activity"] {
  const a: NonNullable<AdminErrorGroup["activity"]> = [
    { kind: "status", text: "Yangi guruh ochildi — birinchi hodisa qayd etildi", at: iso(birinchiMs) },
  ];
  if (g.severity === "critical" || g.severity === "high") {
    a.push({
      kind: "telegram",
      text: "Telegram'ga yuborildi — #dev-alerts kanali · avtomatik qoida (Kritik yoki Yuqori + 10 dan ortiq hodisa)",
      at: iso(birinchiMs + 2 * DAQ),
    });
  }
  if (g.status === "watching" || g.status === "fixing" || g.status === "resolved" || g.status === "regressed") {
    a.push({ kind: "status", text: "Yangi → Kuzatilmoqda deb belgilandi", actor: "Aziz Karimov · superadmin", at: iso(birinchiMs + 3 * SOAT) });
  }
  if (g.assignee && g.status !== "new") {
    a.push({ kind: "assign", text: `Mas'ul biriktirildi — ${g.assignee}`, actor: "Aziz Karimov · superadmin", at: iso(birinchiMs + 4 * SOAT) });
  }
  if (g.status === "fixing" || g.status === "resolved" || g.status === "regressed") {
    a.push({ kind: "status", text: "Kuzatilmoqda → Bartaraf etilmoqda", actor: g.assignee ?? "Aziz Karimov · superadmin", at: iso(birinchiMs + 2 * KUN) });
  }
  if (halMs !== null) {
    a.push({ kind: "status", text: `Bartaraf etildi${g.fixedVersion ? ` — ${g.fixedVersion} versiyasida` : ""}`, actor: g.resolvedBy ?? g.assignee, at: iso(halMs) });
  }
  if (qaytdiMs !== null) {
    a.push({ kind: "regressed", text: "Qayta paydo bo'ldi — yopilgandan keyin yana takrorlandi, muhimlik bir pog'ona ko'tarildi", at: iso(qaytdiMs) });
  }
  if (g.status === "ignored") {
    a.push({ kind: "status", text: `E'tiborsiz qoldirildi — ${g.ignoreReason ?? ""}`, actor: "Aziz Karimov · superadmin", at: iso(oxirgiMs + 1 * KUN) });
  }
  if (g.note) {
    a.push({ kind: "note", text: `Izoh: «${g.note}»`, actor: "Aziz Karimov · superadmin", at: iso(oxirgiMs - 30 * DAQ) });
  }
  if (g.fixNote) {
    a.push({ kind: "note", text: `Izoh: «${g.fixNote}»`, actor: g.assignee ?? "Aziz Karimov · superadmin", at: iso(oxirgiMs - 15 * DAQ) });
  }
  return a.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

/* ── Yig'ish va kesh ──────────────────────────────────────────────────
   Kesh ATAYLAB: `hozir` ro'yxat sahifasida har 30 soniyada yangilanadi.
   Kesh bo'lmasa har yangilanishda butun to'plam qaytadan tug'ilardi va
   obyekt identifikatorlari almashib, React butun jadvalni qayta chizardi.
   Birinchi chaqiruv KLIENT tomonida bo'ladi (`useEffect`), shuning uchun
   SSR bilan farq va gidratsiya ogohlantirishi yuzaga kelmaydi. */
let kesh: AdminErrorDetail[] | null = null;

function qur(hozir: number): AdminErrorDetail[] {
  return XOM.map((x) => {
    const oxirgiMs = hozir - x.oxirgi;
    const birinchiMs = hozir - x.birinchi;
    // Vaqtlar ketma-ketligi MANTIQIY bo'lishi shart. "Bartaraf etildi"
    // sanasi oxirgi hodisadan KEYIN turadi — aks holda ekranda "yopilgan,
    // lekin keyin yana kelgan" holat chiqadi, u esa `regressed` degani.
    const halMs =
      x.guruh.status === "resolved"
        ? oxirgiMs + 1 * KUN
        : x.guruh.status === "regressed"
          ? oxirgiMs - 2 * KUN
          : null;
    const qaytdiMs = x.guruh.status === "regressed" ? oxirgiMs - 20 * DAQ : null;
    const guruh: AdminErrorGroup = {
      ...x.guruh,
      firstSeenAt: iso(birinchiMs),
      lastSeenAt: iso(oxirgiMs),
      startedAt: x.guruh.plannedVersion || x.guruh.status === "fixing" ? iso(birinchiMs + 2 * KUN) : undefined,
      resolvedAt: halMs !== null ? iso(halMs) : undefined,
      reopenedAt: qaytdiMs !== null ? iso(qaytdiMs) : undefined,
    };
    guruh.activity = tarix(guruh, birinchiMs, oxirgiMs, halMs, qaytdiMs);
    const hourly = soatlik(hozir, x.soatlar);
    return {
      group: guruh,
      env: x.env,
      hourly,
      peak: cho_qqi(hourly),
      recent: x.hodisalar(hozir),
      sample: x.namuna?.(oxirgiMs),
      impact: x.tasir,
      users: x.odamlar,
      samplesTotal: x.namunaSoni,
      // `startedAt` bo'lmagan guruhda son ham BO'LMASLIGI kerak: "0 ta
      // yangi hodisa" hech narsa boshlanmagan joyda yolg'on tinchlik
      // beradi, "aniqlanmagan" esa haqiqatni aytadi.
      sinceStarted: guruh.startedAt ? x.yangiHodisa : undefined,
    };
  });
}

/** Butun demo to'plami. Birinchi chaqiruvdagi `hozir` bo'yicha tug'iladi. */
export function demoHammasi(hozir: number): AdminErrorDetail[] {
  if (!kesh) kesh = qur(hozir);
  return kesh;
}

/** Ro'yxat sahifasi uchun — faqat guruhlar. */
export function demoGuruhlar(hozir: number): AdminErrorGroup[] {
  return demoHammasi(hozir).map((d) => d.group);
}

/**
 * URL'dagi `id` bo'yicha yozuvni topadi.
 *
 * Topilmasa `null` QAYTMAYDI: demo rejimida har qanday id ko'rsatiladigan
 * yozuvga aylanadi (ro'yxatda haqiqiy backend ma'lumoti bo'lishi mumkin,
 * lekin batafsil ekran hali ulanmagan). Tanlov `id` dan barqaror
 * hisoblanadi — bir xil qatorni bosganda har safar bir xil yozuv chiqadi.
 */
export function demoBatafsil(id: string, hozir: number): AdminErrorDetail {
  const hammasi = demoHammasi(hozir);
  const kalit = id.trim().toLowerCase();
  const topildi = hammasi.find((d) => d.group.id.toLowerCase() === kalit || d.group.ref.toLowerCase() === kalit);
  if (topildi) return topildi;
  let h = 0;
  for (let i = 0; i < kalit.length; i++) h = (h * 31 + kalit.charCodeAt(i)) >>> 0;
  return hammasi[h % hammasi.length];
}

/**
 * Mas'ul tanlash ro'yxati (`GET /api/admin/errors/assignees` ning demo o'rni).
 *
 * Ro'yxat TOR: support roli yo'q. Mas'ul biriktirish "bu odam xatolikni
 * ko'radi" degani, xatoliklar jurnali esa `RequireRole("moderator")`
 * ostida — ko'ra olmaydigan odamni mas'ul qilib bo'lmaydi.
 */
export const DEMO_MASULLAR: XatoMasul[] = [
  { id: "a1", label: "Aziz Karimov", role: "superadmin" },
  { id: "a2", label: "Sardor Rasulov", role: "moderator" },
  { id: "a3", label: "Nodira Rasulova", role: "moderator" },
  { id: "a4", label: "Jasur Umarov", role: "superadmin" },
];

export function demoStat(hozir: number): AdminErrorStats {
  const g = demoGuruhlar(hozir);
  const ochiq = g.filter((x) => x.status === "new" || x.status === "watching" || x.status === "fixing" || x.status === "regressed");
  const kunlik = g.filter((x) => hozir - Date.parse(x.lastSeenAt) < KUN);
  return {
    open: ochiq.length,
    critical: ochiq.filter((x) => x.severity === "critical").length,
    events24h: kunlik.reduce((s, x) => s + Math.min(x.count, 60), 0),
    users24h: kunlik.reduce((s, x) => s + x.usersCount, 0),
    resolved7d: g.filter((x) => x.status === "resolved").length,
    generatedAt: Math.floor(hozir / 1000),
  };
}

/* ── Niqoblash (serverdagi `maskSecrets` ning demo nusxasi) ─────────── */

const NIQOB = "‹niqoblangan›";

export function niqobla(s: string): string {
  if (!s) return "";
  return s
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(\.[A-Za-z0-9_-]+)?/g, NIQOB)
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${NIQOB}`)
    .replace(
      /\b(password|passwd|pwd|token|access_token|refresh|refresh_token|secret|apikey|api_key|authorization|otp|otp_code|totp)\b"?\s*[:=]\s*"?[^\s",;})\]]+/gi,
      `$1: ${NIQOB}`,
    )
    .replace(/\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, "+998 •• ••• •• ••")
    .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.$2.•••.•••")
    .replace(/\b\d{9,}\b/g, "•••");
}

/* ── AI uchun kontekst (Figma 3.12.3 · L) ─────────────────────────────
   Matn serverdagi `internal/admin/errexport.go` bilan BIR XIL tartibda
   yig'iladi: sarlavha → tavsif qatorlari → bo'limlar. Backend ulanganda
   `GET /api/admin/errors/{id}/context` shu matnning o'zini qaytaradi va
   ekran o'zgarmaydi. */

const YOQ_QIY = "aniqlanmagan";

function qiy(v?: string): string {
  return v && v.trim() !== "" ? v : YOQ_QIY;
}

/** Bo'sh bo'laklarni tashlab qo'shadi: "Chrome 128 · " kabi dumaloq qolmaydi. */
function birik(sep: string, ...qismlar: (string | undefined)[]): string {
  return qismlar.map((q) => (q ?? "").trim()).filter(Boolean).join(sep);
}

function qavs(v?: string): string {
  return v && v.trim() !== "" ? `(${v})` : "";
}

function vaqtMatn(s?: string): string {
  if (!s) return YOQ_QIY;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return YOQ_QIY;
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** `errlog.DeviceLabel` ning nusxasi. */
export function qurilmaYorliq(d?: XatoQurilma): string {
  if (!d) return "";
  const nom = birik(" ", d.brand, d.model) || (d.browser ?? "");
  const os = birik(" ", d.os, d.osVersion);
  if (nom && os) return `${nom} · ${os}`;
  return nom || os || d.platform || "";
}

/**
 * `errexport.deviceWithCode` ning nusxasi — yorliqqa model KODINI qo'shadi.
 *
 * NEGA kod yorliqning oxiriga emas, nom bo'lagining ortiga qo'yiladi:
 * yorliq ichida OS allaqachon bor ("nom · OS versiya"), kod esa apparat
 * variantini bildiradi va u nomga tegishli. Oxiriga qo'yilsa "… · Android 14
 * (2201117TG)" chiqib, kod OS versiyasiga tegishli bo'lib ko'rinardi.
 *
 * Nom umuman bo'lmaganda (brauzer yoki faqat platforma ma'lum) kod oxirida
 * qoladi — uni bog'laydigan boshqa bo'lak yo'q.
 */
function qurilmaKodBilan(d?: XatoQurilma): string {
  const yorliq = qurilmaYorliq(d);
  const kod = qavs(d?.modelCode);
  if (!yorliq || !kod) return yorliq;
  const nom = birik(" ", d?.brand, d?.model);
  if (nom && yorliq.startsWith(nom)) return `${nom} ${kod}${yorliq.slice(nom.length)}`;
  return `${yorliq} ${kod}`;
}

/**
 * `errexport.emulatorLabel` ning nusxasi: bitta maydon, ikki xil sarlavha.
 *
 * NEGA platformaga qarab: iOS hodisasida "Root" so'zi noto'g'ri — u yerda
 * tushuncha "Jailbreak" deb ataladi va mos kelmagan atama kontekstni
 * o'qiyotgan odamni ham, AI'ni ham chalg'itadi.
 */
function emulyatorNomi(platform?: string): string {
  return (platform ?? "").trim().toLowerCase() === "ios" ? "Simulyator · Jailbreak" : "Emulyator · Root";
}

const KOD_REF = /[\w./\\-]+\.(dart|go|ts|tsx|js|jsx|kt|swift):\d+/;

/** `errexport.codeCtxLines` — sarlavhadagi diapazonning yarim kengligi. */
const KOD_ATROF = 3;

/**
 * `errexport.codeTitle` ning nusxasi: "Tegishli kod (api_client.dart:289-295)".
 *
 * NEGA diapazon sarlavhada: AI'ga bitta qator emas, uning ATROFI kerak —
 * o'zgaruvchi yuqorida e'lon qilinadi, tekshiruv esa pastda bo'ladi. Manzil
 * topilmasa sarlavha o'zgarishsiz qoladi: taxminiy diapazon yozgandan ko'ra
 * hech narsa yozmaslik to'g'ri.
 */
function kodSarlavha(g: AdminErrorGroup, s?: XatoNamuna): string {
  const asos = "Tegishli kod";
  let ref = KOD_REF.exec(g.where ?? "")?.[0] ?? "";
  if (!ref) {
    // Stekning BIRINCHI kadri — xato tug'ilgan joy; keyingilari chaqiruvchilar.
    for (const qator of s?.stack ?? []) {
      const m = KOD_REF.exec(qator)?.[0];
      if (m) {
        ref = m;
        break;
      }
    }
  }
  const i = ref.lastIndexOf(":");
  if (i < 0) return asos;
  const n = Number.parseInt(ref.slice(i + 1), 10);
  if (!Number.isFinite(n) || n <= 0) return asos;
  // Fayl nomi qisqartiriladi (faqat oxirgi bo'lak): to'liq yo'l sarlavhani
  // ikki qatorga bo'lib tashlaydi, u esa bo'limning O'ZIDA to'liq turadi.
  let fayl = ref.slice(0, i);
  const j = Math.max(fayl.lastIndexOf("/"), fayl.lastIndexOf("\\"));
  if (j >= 0) fayl = fayl.slice(j + 1);
  if (!fayl) return asos;
  const dan = Math.max(1, n - KOD_ATROF);
  return `${asos} (${fayl}:${dan}-${n + KOD_ATROF})`;
}

function qadamNomi(k: XatoQadam["kind"]): string {
  const m: Record<XatoQadam["kind"], string> = {
    nav: "navigatsiya",
    screen: "ekran",
    action: "amal",
    request: "so'rov",
    response: "javob",
    crash: "CRASH",
  };
  return m[k] ?? k;
}

type Bolim = { title: string; lines: string[] };

function bolimlar(d: AdminErrorDetail, yoq: Set<XatoKontekstKalit>): Bolim[] {
  const g = d.group;
  const s = d.sample;
  const dev = s?.device;
  const out: Bolim[] = [];

  if (yoq.has("device")) {
    // Qurilma va OS BITTA qatorda (serverdagi `deviceLines` bilan bir xil):
    // yorliq ichida OS allaqachon bor, ortidan yana "OS: …" yozilsa AI'ga
    // bir xil ma'lumot ikki marta borardi va belgi/token sanog'i behuda
    // oshardi. Tekshiruv yorliqning MAZMUNIDA: takror rostdan bo'lganda
    // qator tushadi, brauzer yoki faqat platforma ma'lum bo'lgan hodisada
    // esa "OS:" qatori joyida qoladi.
    const osMatn = birik(" ", dev?.os, dev?.osVersion);
    const api = dev?.apiLevel ? `(API ${dev.apiLevel})` : "";
    const qurilma = qurilmaKodBilan(dev);
    const l = [`Ilova: ${qiy(birik(" ", dev?.appVersion, qavs(dev?.build)))}`];
    if (osMatn && qurilma.includes(osMatn)) {
      l.push(`Qurilma: ${birik(" ", qurilma, api)}`);
    } else {
      l.push(`Qurilma: ${qiy(qurilma)}`, `OS: ${qiy(birik(" ", osMatn, api))}`);
    }
    if (dev?.browser || dev?.platform === "web") l.push(`Brauzer: ${qiy(birik(" · ", dev?.browser, dev?.engine))}`);
    if (dev?.flutter || dev?.dart) l.push(`Flutter/Dart: ${qiy(birik(" / ", dev?.flutter, dev?.dart))}`);
    // Ekran va RAM bitta qatorda: ikkisi ham "qurilma qanchalik kuchsiz"
    // degan bitta savolga javob beradi va OOM yoki rasm hajmi bilan
    // bog'liq xatolikda faqat yonma-yon turganda ma'no chiqaradi.
    let ekran = `Ekran: ${qiy(dev?.screen)}`;
    const ram = (dev?.ram ?? "").trim();
    if (ram) ekran += ` · RAM ${ram}`;
    l.push(ekran);
    // Quyidagi maydonlar SHARTLI. Ular faqat mijoz `X-Client-Device`
    // sarlavhasini yuborganda ma'lum bo'ladi, ya'ni ko'pincha bo'sh.
    // Bo'shini "aniqlanmagan" deb yozish kontekstni uzaytirardi, AI'ga esa
    // hech narsa bermasdi — shu sababli `qiy()` emas, qatorning O'ZI
    // tashlab yuboriladi.
    const xotira = (dev?.storage ?? "").trim();
    if (xotira) l.push(`Xotira: ${xotira}`);
    l.push(`Tarmoq: ${qiy(dev?.network)}`, `Til: ${qiy(dev?.locale)}`);
    const batareya = (dev?.battery ?? "").trim();
    if (batareya) l.push(`Batareya: ${batareya}`);
    const emul = (dev?.emulator ?? "").trim();
    if (emul) l.push(`${emulyatorNomi(dev?.platform)}: ${emul}`);
    const yonalish = (dev?.orientation ?? "").trim();
    if (yonalish) l.push(`Orientatsiya: ${yonalish}`);
    // Server qatori: host · muhit · backend build. Host BIRINCHI turadi,
    // chunki bir necha nusxa ishlaganda "xatolik hammasidami yoki
    // bittasidami" savoliga faqat mashina nomi javob beradi; APP_ENV va
    // build esa "qaysi kod ishlagan" savolini yopadi.
    l.push(`Server: ${qiy(d.env.server)} · APP_ENV=${qiy(d.env.appEnv)} · backend build: ${qiy(d.env.version)}`);
    if (g.plannedVersion) l.push(`Rejalashtirilgan tuzatish versiyasi: ${g.plannedVersion}`);
    if (g.fixedVersion) l.push(`Avval tuzatilgan versiya: ${g.fixedVersion}`);
    out.push({ title: "Muhit", lines: l });
  }

  if (yoq.has("stack")) {
    const l: string[] = [];
    const xabar = niqobla(g.message || s?.message || "");
    if (xabar) l.push(xabar);
    if (s?.stack?.length) l.push(...s.stack.map(niqobla));
    out.push({ title: "Xato matni va stack trace", lines: l.length ? l : [YOQ_QIY] });
  }

  if (yoq.has("code")) {
    const korilgan = new Set<string>();
    const l: string[] = [];
    const qosh = (v?: string) => {
      const t = (v ?? "").trim();
      if (!t || korilgan.has(t)) return;
      korilgan.add(t);
      l.push(t);
    };
    qosh(g.where);
    for (const qator of s?.stack ?? []) {
      if (l.length >= 4) break;
      qosh(KOD_REF.exec(qator)?.[0]);
    }
    if (l.length === 0) l.push(YOQ_QIY);
    else l.push("(fayl mazmuni serverda saqlanmaydi — yuqoridagi manzillarni repozitoriydan oching)");
    out.push({ title: kodSarlavha(g, s), lines: l });
  }

  if (yoq.has("request")) {
    let bosh = birik(" ", s?.method, s?.path || g.path || YOQ_QIY);
    if (s?.status) bosh += ` → ${s.status}`;
    if (s?.durationMs) bosh += ` · ${s.durationMs} ms`;
    out.push({
      title: "So'rov",
      lines: [
        qiy(bosh),
        `request_id: ${qiy(s?.requestId)}`,
        `guruh ID: ${g.ref} · fingerprint: ${g.fingerprint.slice(0, 12)}`,
        "IP va to'liq telefon yig'ilmaydi (jurnalda ham yo'q)",
      ],
    });
  }

  if (yoq.has("steps")) {
    const l = (s?.steps ?? []).map((q) => {
      const t = new Date(q.at);
      return `${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())} ${qadamNomi(q.kind)} ${niqobla(q.text)}`;
    });
    out.push({
      title: "Xatolikdan oldingi qadamlar",
      lines: l.length ? l : ["qadamlar yozib olinmagan (mijoz breadcrumb yubormagan)"],
    });
  }

  out.push({
    title: "Kutilgan xulq",
    lines: [
      "So'rov muvaffaqiyatli bajarilishi yoki xato foydalanuvchiga tushunarli xabar bilan qaytishi kerak edi; ilova ishdan chiqmasligi kerak.",
    ],
  });
  out.push({
    title: "Savol",
    lines: [
      "Shu xatolikning sababi nimada va uni qanday tuzatish kerak? Tuzatishni qaysi faylning qaysi qatorida qilish kerakligini ko'rsat.",
    ],
  });
  return out;
}

/** Qaysi kalitlar hozir mavjud emas (dizaynda kulrang ko'rsatilgan). */
export const KONTEKST_YOQ: XatoKontekstKalit[] = ["serverlog", "similar"];

export function demoKontekst(
  d: AdminErrorDetail,
  format: "md" | "json" | "txt",
  include: XatoKontekstKalit[],
): XatoKontekst {
  const g = d.group;
  const bor = include.filter((k) => !KONTEKST_YOQ.includes(k));
  const yoq = include.filter((k) => KONTEKST_YOQ.includes(k));
  const head = `Xatolik: ${g.code} (${g.ref})`;
  const subtitle = [
    birik(" · ", `Muhimlik: ${DARAJA[g.severity]?.nomi ?? g.severity}`, `Holat: ${HOLAT[g.status]?.nomi ?? g.status}`, g.assignee ? `Mas'ul: ${g.assignee}` : ""),
    `Birinchi: ${vaqtMatn(g.firstSeenAt)} · Oxirgi: ${vaqtMatn(g.lastSeenAt)} · ${g.count} hodisa / ${g.usersCount} foydalanuvchi`,
  ];
  if (g.title) subtitle.push(`Sarlavha: ${niqobla(g.title)}`);
  if (g.runtime || g.module) subtitle.push(`Manba: ${birik(" · ", g.runtime, MODUL[g.module] ?? g.module)}`);

  const sections = bolimlar(d, new Set(bor));
  let text: string;
  if (format === "json") {
    text = JSON.stringify({ head, subtitle, sections }, null, 2);
  } else {
    const md = format === "md";
    const q: string[] = [md ? `# ${head}` : head.toUpperCase(), ...subtitle];
    for (const s of sections) {
      q.push("", md ? `## ${s.title}` : s.title.toUpperCase(), ...s.lines);
    }
    text = `${q.join("\n")}\n`;
  }
  const chars = Array.from(text).length;
  return {
    format,
    text,
    chars,
    tokens: Math.floor((chars + 3) / 4),
    masked: true,
    include: bor,
    unavailable: yoq,
    filename: `${g.ref}-${g.code}.${format}`,
  };
}
