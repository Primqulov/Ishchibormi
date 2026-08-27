"use client";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE || "ws://localhost:8080";

const ACCESS_KEY = "ib-access";
const ADMIN_KEY = "ib-admin";
// Legacy key: the refresh token used to be persisted here. The web app never
// calls the refresh endpoint — the access token TTL alone defines the session —
// so a long-lived refresh token sitting in localStorage was pure XSS attack
// surface (one XSS meant weeks of account access). We no longer store it and
// actively purge any leftover value from existing users' browsers via setAccess.
const LEGACY_REFRESH_KEY = "ib-refresh";

export function getAccess(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}
export function setAccess(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(ACCESS_KEY, t);
  else localStorage.removeItem(ACCESS_KEY);
  // Whenever the user's auth state changes (login, logout, 401), drop any
  // legacy refresh token that may still be stored from an older build.
  localStorage.removeItem(LEGACY_REFRESH_KEY);
}

export function setAdminToken(t: string | null) {
  if (typeof window === "undefined") return;
  // Admin sessions are deliberately tab-scoped and disappear when the browser
  // closes. This limits persistence of a privileged bearer token. Purge the
  // legacy localStorage copy during migration.
  localStorage.removeItem(ADMIN_KEY);
  if (t) sessionStorage.setItem(ADMIN_KEY, t);
  else sessionStorage.removeItem(ADMIN_KEY);
}
export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  localStorage.removeItem(ADMIN_KEY);
  return sessionStorage.getItem(ADMIN_KEY);
}

// downloadAdminCsv triggers a browser download of an admin CSV export. The admin
// JWT goes in the Authorization header (fetch + blob), never in the URL —
// query-string tokens end up in proxy access logs and browser history.
export async function downloadAdminCsv(path: string, params?: URLSearchParams) {
  if (typeof document === "undefined") return;
  const qs = params && params.toString() ? `?${params}` : "";
  try {
    const res = await fetch(`${API_BASE}${path}${qs}`, {
      headers: { Authorization: `Bearer ${getAdminToken() || ""}` },
    });
    if (!res.ok) throw new Error(`export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // /api/admin/export/users.csv -> users.csv
    a.download = path.split("/").pop() || "export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("CSV export:", e);
    alert("Eksport muvaffaqiyatsiz. Qayta urinib ko'ring.");
  }
}

// getAdminRole decodes the role claim from the stored admin JWT so the UI can
// hide sections a role can't use (RBAC is still enforced server-side).
export function getAdminRole(): string | null {
  const t = getAdminToken();
  if (!t) return null;
  try {
    const part = t.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

export interface APIError {
  code: string;
  message: string;
  /**
   * Backend'ning strukturali qo'shimchasi (error.details). Moderatsiya rad
   * etganda modal oyna shundan sabab va ogohlantirishni alohida oladi:
   * { reason, warning?, strikes?, strikeLimit?, bannedUntil? }
   */
  details?: Record<string, any>;
}

function connectionError(): APIError {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  return offline
    ? {
        code: "offline",
        message:
          "Internet aloqasi yo'q. Tarmoqni tekshirib, qayta urinib ko'ring.",
      }
    : {
        code: "server_unavailable",
        message:
          "Server vaqtincha ishlamayapti. Internetingiz ishlayapti — birozdan so'ng qayta urinib ko'ring.",
      };
}

function responseError(status: number, data: any): APIError {
  if (status >= 500) {
    return {
      code: "server_error",
      message:
        "Serverda vaqtinchalik xatolik bor. Birozdan so'ng qayta urinib ko'ring.",
    };
  }

  const backendError = data?.error;
  if (
    backendError &&
    typeof backendError.code === "string" &&
    typeof backendError.message === "string"
  ) {
    // Business errors keep their stable code so forms can show a helpful local
    // message. Callers must not display raw technical response bodies.
    return backendError as APIError;
  }

  return {
    code: "request_failed",
    message:
      "So'rovni bajarib bo'lmadi. Ma'lumotlarni tekshirib, qayta urinib ko'ring.",
  };
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: "user" | "admin" | "none" } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Foydalanuvchi qaysi klientdan foydalanayotganini backend shu
    // sarlavhadan biladi (admin panelidagi platforma statistikasi).
    // User-Agent yetarli emas: uni kengaytmalar o'zgartiradi va mobil
    // ilovadagi WebView ham brauzer UA'sini yuboradi.
    "X-Client-Platform": "web",
  };
  const auth = opts.auth ?? "user";
  if (auth === "user") {
    const t = getAccess();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  } else if (auth === "admin") {
    const t = getAdminToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  Object.assign(headers, opts.headers || {});

  // fetch() server topilmaganda (backend o'chiq, CORS, oflayn) xom
  // `TypeError: Failed to fetch` tashlaydi — bu Next.js dev'da "Unhandled
  // Runtime Error" overlay'i bo'lib chiqadi. navigator.onLine orqali haqiqiy
  // oflayn holatni online qurilmadagi backend nosozligidan ajratamiz.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    throw connectionError();
  }

  const text = await res.text();
  // Javob JSON bo'lmasligi mumkin (masalan proksi 502 HTML sahifasi) — parse
  // xatosi butun so'rovni yiqitmasin.
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    // Sessiya tugagan yoki token yaroqsiz (401) — saqlangan foydalanuvchi
    // tokenlarini tozalaymiz. Shunda ilova "kirgan" holatda qotib qolmaydi
    // va foydalanuvchi qaytadan login qilishga yo'naltiriladi.
    //
    // 403 account_disabled ham xuddi shunday: hisob boshqa qurilmada (masalan
    // ilovada) o'chirilgan yoki bloklangan bo'lsa, JWT hali "yaroqli" ko'rinadi
    // — faqat backend uni rad etadi. Tokenni tozalamasak brauzer o'zini
    // "kirgan" deb hisoblab qolaveradi: landing'dagi "Kirish" tugmasi /login
    // o'rniga /dashboard'ga olib boradi va Shell'ning redirect qorovuli
    // (getAccess() hali ham to'la) hech qachon ishlamaydi.
    const disabled =
      res.status === 403 && data?.error?.code === "account_disabled";
    if ((res.status === 401 || disabled) && auth === "user") {
      setAccess(null);
    }
    // Admin JWT ham xuddi shunday eskirishi mumkin (masalan lokal backend
    // qayta ishga tushganda boshqa secret bilan). Token shunchaki mavjudligi
    // admin kirganini anglatmaydi: 401 da uni darhol tozalab, qayta login
    // qilishga yo'naltiramiz. Aks holda panel har bir amalni "invalid token"
    // bilan rad etib, foydalanuvchini kirgan holatda qotirib qo'yadi.
    if (res.status === 401 && auth === "admin") {
      setAdminToken(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/admin/login") {
        window.location.replace("/admin/login?session=expired");
      }
    }
    throw responseError(res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, opts?: any) => request<T>(p, { ...(opts || {}), method: "GET" }),
  post: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(p: string, opts?: any) => request<T>(p, { ...(opts || {}), method: "DELETE" }),
};

// ----- domain types -----
export type ID = string;

/**
 * Backend biladigan klientlar (Go: httpx.Platform*). Ro'yxat YOPIQ —
 * backend klient yuborgan qiymatni shu to'plamga keltiradi.
 */
export type ClientPlatform = "web" | "android" | "ios" | "unknown";

/** Panelda ko'rsatiladigan tartib — hisobotlarda ham shu ketma-ketlik. */
export const CLIENT_PLATFORMS: ClientPlatform[] = ["web", "android", "ios", "unknown"];

const PLATFORM_LABELS: Record<ClientPlatform, string> = {
  web: "Veb",
  android: "Android",
  ios: "iOS",
  // "Noma'lum" — bu funksiyadan oldin ro'yxatdan o'tganlar va sarlavha
  // yubormaydigan eski ilova versiyalari. Ataylab ko'rsatiladi: yashirilsa
  // ustunlar yig'indisi jami foydalanuvchiga teng kelmasdi.
  unknown: "Noma'lum",
};

/** Platforma kodini panelda ko'rsatiladigan nomga aylantiradi. */
export function platformLabel(p?: string | null): string {
  return PLATFORM_LABELS[(p || "unknown") as ClientPlatform] ?? p ?? "Noma'lum";
}

export interface User {
  id: ID;
  telegramId?: number;
  phone: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  region?: string;
  district?: string;
  bio?: string;
  skills?: string[];
  completedJobsCount: number;
  isPhoneVerified: boolean;
  isBlocked: boolean;
  /**
   * Avtomatik moderatsiya bloki tugash vaqti (ISO). Bloklanmagan
   * foydalanuvchida umuman kelmaydi.
   *
   * Saqlashda `isBlocked` dan alohida — oqibati boshqacha: qo'lda qo'yilgan
   * blok ochilguncha turadi, bu esa muddati tugagach o'z-o'zidan kuchini
   * yo'qotadi. LEKIN panelda ikkalasi BITTA holat sifatida ko'rsatiladi
   * (`isUserBlocked`): admin uchun "bloklanganmi?" degan savolga ikkita
   * javob bo'lishi mumkin emas.
   */
  moderationBannedUntil?: string;
  /** Nega bloklangan — admin yozgan matn yoki avtomatik blok jumlasi. */
  blockReason?: string;
  /** Blokni kim qo'ygan. */
  blockSource?: "admin" | "moderation";
  /** Qachon bloklangan (ISO). */
  blockedAt?: string;
  /** Bloklagan admin id'si (faqat qo'lda blokda). */
  blockedBy?: string;
  /**
   * Ro'yxatdan o'tgan payt ishlatilgan klient. Bu funksiya qo'shilishidan
   * oldin ro'yxatdan o'tganlarda umuman kelmaydi — `platformLabel` uni
   * "Noma'lum" deb ko'rsatadi.
   */
  signupPlatform?: ClientPlatform;
  /** Oxirgi so'rov qaysi klientdan kelgan. */
  lastPlatform?: ClientPlatform;
  /** `lastPlatform` qachon yozilgan (ISO). */
  lastSeenAt?: string;
  /**
   * Hisob qachon yaratilgan — foydalanuvchi BIRINCHI marta ro'yxatdan
   * o'tgan payt (ISO). Backend uni `$setOnInsert` bilan yozadi, ya'ni
   * keyingi loginlar uni o'zgartirmaydi.
   *
   * Ixtiyoriy deb belgilangan, chunki bu tur ommaviy profil javobida ham
   * ishlatiladi — u yerda sana yuborilmaydi.
   */
  createdAt?: string;
  langPref?: "latin" | "cyrillic";
  themePref?: "light" | "dark";
  onboardingCompleted?: boolean;
}
/**
 * Moderatsiya bloki HOZIR kuchdami.
 *
 * Muddati o'tgan blok blok emas: backend ham shu qoidaga amal qiladi
 * (`RequireActiveUser` sanani solishtiradi), shuning uchun UI eskirgan
 * blokni "bloklangan" deb ko'rsatmasligi kerak.
 */
export function moderationBanUntil(u: Pick<User, "moderationBannedUntil">): Date | null {
  if (!u.moderationBannedUntil) return null;
  const d = new Date(u.moderationBannedUntil);
  return d.getTime() > Date.now() ? d : null;
}

/**
 * Foydalanuvchi bloklanganmi — manbasidan qat'i nazar.
 *
 * Panelda blok bitta tushuncha. Ikkita alohida belgi (qo'lda / avtomatik)
 * adminni chalg'itardi: "Faol" deb turgan foydalanuvchi aslida ilovaga kira
 * olmasligi mumkin edi.
 */
export function isUserBlocked(u: Pick<User, "isBlocked" | "moderationBannedUntil">): boolean {
  return !!u.isBlocked || !!moderationBanUntil(u);
}

/** Blok manbasi — inson o'qiy oladigan nom. */
export function blockSourceLabel(u: Pick<User, "isBlocked" | "moderationBannedUntil" | "blockSource">): string {
  if (moderationBanUntil(u)) return "Avtomatik (nomaqbul kontent)";
  if (u.isBlocked) return u.blockSource === "moderation" ? "Moderatsiya" : "Admin qarori";
  return "";
}

export interface Category {
  id: ID;
  name: string;
  slug: string;
  /** Public http(s) URL of the category icon (SVG or raster). */
  icon?: string;
  isSystemDefault?: boolean;
  isActive: boolean;
  /** Hozir feedda ko'rinib turgan (faol, vaqti o'tmagan) e'lonlar soni. */
  activeCount: number;
  /**
   * Tarixan joylangan e'lonlar soni. Ommaviy `/api/categories` javobida u
   * `activeCount` bilan bir xil qiymatga ega; tarixiy jami faqat admin
   * endpointidan keladi. Yangi kodda `activeCount` ishlatilsin.
   */
  usageCount: number;
  createdAt?: string;
}
// Ish e'loni kimlar uchun: erkaklar / ayollar / aralash.
export type Gender = "male" | "female" | "mixed";
export const GENDER_LABEL: Record<Gender, string> = {
  male: "Erkaklar",
  female: "Ayollar",
  mixed: "Aralash",
};
// Feed filtri va formalar uchun tartib (aralash — standart).
export const GENDER_OPTIONS: Gender[] = ["male", "female", "mixed"];

export interface Elon {
  id: ID;
  ownerId: ID;
  title: string;
  categoryId: ID;
  categoryName: string;
  description: string;
  locationUrl?: string;
  locationText?: string;
  lat?: number;
  lng?: number;
  region?: string;
  district?: string;
  workersNeeded: number;
  pricingType: "per_worker" | "total" | "negotiable";
  priceAmount: number;
  perWorkerAmount: number;
  startDate?: string;
  workTimeFrom?: string;
  workTimeTo?: string;
  contactPhone?: string;
  gender?: Gender;
  status: "draft" | "recruiting" | "filled" | "in_progress" | "completed" | "cancelled" | "hidden";
  acceptedCount: number;
  publishedAt?: string;
  createdAt: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  images?: string[];
}
export interface Application {
  id: ID;
  elonId: ID;
  elonTitle: string;
  workerId: ID;
  employerId: ID;
  workerPhone: string;
  workerName?: string;
  workerAvatarUrl?: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  peopleCount?: number;
  amount: number;
  isNegotiable: boolean;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "completed";
  employerConfirmedDone?: boolean;
  workerConfirmedDone?: boolean;
  cancelledBy?: string;
  cancelReason?: string;
  appliedAt: string;
  decidedAt?: string;
  completedAt?: string;
}
export interface Notification {
  id: ID;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  relatedEntity?: { type: string; id: ID };
}
export interface Feedback {
  id: ID;
  userId: ID;
  userName?: string;
  userPhone?: string;
  type: "suggestion" | "complaint";
  subject?: string;
  message: string;
  status: "open" | "resolved";
  createdAt: string;
}
// ----- admin types -----
export type AdminRole = "superadmin" | "moderator" | "support";

export interface Admin {
  id: ID;
  username: string;
  name?: string;
  role: AdminRole;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

export interface AdminAudit {
  id: ID;
  adminId: ID;
  adminName?: string;
  action: string;
  target?: string;
  detail?: string;
  createdAt: string;
}

export interface Broadcast {
  id: ID;
  title: string;
  body: string;
  region?: string;
  activeOnly: boolean;
  sentCount: number;
  status: "scheduled" | "sending" | "done";
  scheduledAt?: string;
  createdAt: string;
}

// Paged is the shape every admin list endpoint returns.
export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface DashboardStats {
  users: number;
  activeUsers: number;
  blockedUsers: number;
  todayUsers: number;
  elons: number;
  recruitingElons: number;
  filledElons: number;
  todayElons: number;
  completed: number;
  openReports: number;
  openFeedback: number;
  /**
   * Platforma bo'yicha foydalanuvchilar — OXIRGI ISHLATILGAN klient
   * bo'yicha ("hozir nimadan foydalanadi"). Ro'yxatdan o'tish taqsimoti
   * `AdminStats.platforms.signup` da.
   */
  webUsers: number;
  androidUsers: number;
  iosUsers: number;
  unknownPlatformUsers: number;
}

export interface DayPoint { date: string; count: number; }
export interface NameCount { name: string; count: number; }
/**
 * Platforma taqsimoti ikki kesimda. Ikkalasi kerak, chunki boshqa savolga
 * javob beradi: `signup` — o'sish qaysi kanaldan kelayotgani, `active` —
 * qaysi klientni rivojlantirish kerakligi. Vebdan ro'yxatdan o'tib ilovaga
 * ko'chgan oqim faqat shu ikkisi solishtirilganda ko'rinadi.
 */
export interface PlatformStats {
  signup: NameCount[];
  active: NameCount[];
  /** `active` necha kunlik oyna bo'yicha hisoblangani. */
  activeWindowDays: number;
}

export interface AdminStats {
  userGrowth: DayPoint[];
  elonGrowth: DayPoint[];
  funnel: Record<string, number>;
  topCategories: NameCount[];
  regions: NameCount[];
  platforms: PlatformStats;
}
