/**
 * Backend API klienti.
 *
 * apps/web/lib/api.ts bilan bir xil shartnoma va xato modeli, lekin
 * Mini App uchun ikkita farq bilan:
 *   1. kirish `initData` orqali (loginWithInitData) — parol ham, kod ham
 *      kerak emas;
 *   2. 401 kelganda token tozalanadi va ilova qayta kirishga urinadi —
 *      Telegram'da "login sahifasi" degan tushuncha yo'q, foydalanuvchi
 *      allaqachon autentifikatsiyadan o'tgan.
 */

import { initData } from "./telegram";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string) || "http://localhost:8080";

export const AUTH_BOT_USERNAME: string =
  (import.meta.env.VITE_AUTH_BOT_USERNAME as string) || "Ishchi_bormi_auth_bot";

const ACCESS_KEY = "ib-miniapp-access";

export function getAccess(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    // Telegram'ning ba'zi ichki brauzerlarida localStorage bloklangan bo'lishi
    // mumkin — bunda sessiya faqat joriy ochilishda yashaydi, ilova baribir
    // ishlaydi (har safar initData bilan qaytadan kiradi).
    return memoryToken;
  }
}

let memoryToken: string | null = null;

export function setAccess(t: string | null) {
  memoryToken = t;
  try {
    if (t) localStorage.setItem(ACCESS_KEY, t);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* localStorage yo'q — memoryToken yetarli */
  }
}

export interface APIError {
  code: string;
  message: string;
  /** need_contact holatida backend qaytaradigan bot havolasi. */
  botUrl?: string;
  status?: number;
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const t = getAccess();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  Object.assign(headers, opts.headers || {});

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    // Tarmoq yo'q / server o'chiq / CORS. Xom TypeError o'rniga tushunarli
    // xato — UI uni "Qayta urinish" ekranida ko'rsatadi.
    const err: APIError = {
      code: "network",
      message: "Internetga ulanib bo'lmadi. Aloqangizni tekshirib, qayta urinib ko'ring.",
    };
    throw err;
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    // Sessiya tugagan yoki hisob o'chirilgan — saqlangan tokenni tashlaymiz,
    // shunda ilova qayta initData bilan kiradi.
    const disabled = res.status === 403 && data?.error?.code === "account_disabled";
    if (res.status === 401 || disabled) setAccess(null);

    const err: APIError = {
      ...(data?.error || { code: "http", message: `HTTP ${res.status}` }),
      botUrl: data?.botUrl,
      status: res.status,
    };
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, o?: any) => request<T>(p, { ...(o || {}), method: "GET" }),
  post: <T>(p: string, body?: any, o?: any) =>
    request<T>(p, {
      ...(o || {}),
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(p: string, body?: any, o?: any) =>
    request<T>(p, {
      ...(o || {}),
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  del: <T>(p: string, o?: any) => request<T>(p, { ...(o || {}), method: "DELETE" }),
};

/**
 * Fayl yuklash (multipart).
 *
 * `request` dan foydalanmaydi, chunki u JSON Content-Type qo'yadi — multipart'da
 * esa chegara satrini (boundary) brauzerning o'zi qo'yishi kerak, qo'lda
 * yozilgan sarlavha uni buzadi.
 */
export async function uploadFile(
  file: File,
  kind: "avatar" | "elon",
  signal?: AbortSignal,
): Promise<{ key: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);

  const headers: Record<string, string> = {};
  const t = getAccess();
  if (t) headers["Authorization"] = `Bearer ${t}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/uploads?kind=${kind}`, {
      method: "POST",
      body: fd,
      headers,
      signal,
    });
  } catch {
    throw { code: "network", message: "Rasm yuklanmadi — internetni tekshiring." } as APIError;
  }

  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    if (res.status === 401) setAccess(null);
    throw {
      ...(data?.error || { code: "upload_failed", message: "Rasm yuklanmadi." }),
      status: res.status,
    } as APIError;
  }
  return data as { key: string; url: string };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ── Kirish ────────────────────────────────────────────────────────────

export interface LoginResp {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/**
 * Telegram `initData` bilan kirish.
 *
 * Muvaffaqiyatli bo'lsa token saqlanadi. Foydalanuvchining telefoni hali
 * bog'lanmagan bo'lsa backend 409 `need_contact` qaytaradi — bu xato emas,
 * ro'yxatdan o'tish kerakligini bildiradi (App.tsx uni Register ekraniga
 * o'giradi).
 */
export async function loginWithInitData(): Promise<LoginResp> {
  const resp = await api.post<LoginResp>(
    "/api/auth/telegram/webapp",
    { initData: initData() },
    { auth: false },
  );
  setAccess(resp.accessToken);
  return resp;
}

/** OTP so'rash — telefoni hali bog'lanmagan foydalanuvchi uchun. */
export function requestOtp() {
  return api.post<{ tgToken: string; botUrl?: string; devCode?: string }>(
    "/api/auth/otp/request",
    {},
    { auth: false },
  );
}

/** OTP kodini tekshirish va sessiyani ochish. */
export async function verifyOtp(token: string, code: string): Promise<LoginResp> {
  const resp = await api.post<LoginResp>(
    "/api/auth/otp/verify",
    { token, code },
    { auth: false },
  );
  setAccess(resp.accessToken);
  return resp;
}

// ── Domen tiplari (backend javoblari bilan mos) ──────────────────────

export type ID = string;

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
  rating?: number;
  reviewsCount?: number;
  workerRating?: number;
  workerReviewsCount?: number;
  employerRating?: number;
  employerReviewsCount?: number;
  completedJobsCount: number;
  isPhoneVerified: boolean;
  isBlocked: boolean;
  onboardingCompleted?: boolean;
}

export interface Category {
  id: ID;
  name: string;
  slug: string;
  icon?: string;
  isActive: boolean;
  usageCount: number;
}

export type Gender = "male" | "female" | "mixed";
export const GENDER_LABEL: Record<Gender, string> = {
  male: "Erkaklar",
  female: "Ayollar",
  mixed: "Aralash",
};

export type ElonStatus =
  | "draft" | "recruiting" | "filled" | "in_progress"
  | "completed" | "cancelled" | "hidden";

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
  status: ElonStatus;
  acceptedCount: number;
  publishedAt?: string;
  createdAt: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  images?: string[];
}

export type ApplicationStatus =
  | "pending" | "accepted" | "rejected" | "cancelled" | "completed";

export interface Application {
  id: ID;
  elonId: ID;
  elonTitle: string;
  workerId: ID;
  employerId: ID;
  workerPhone: string;
  workerName?: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  peopleCount?: number;
  amount: number;
  isNegotiable: boolean;
  status: ApplicationStatus;
  employerConfirmedDone?: boolean;
  workerConfirmedDone?: boolean;
  cancelReason?: string;
  appliedAt: string;
  decidedAt?: string;
  completedAt?: string;
}

/** Feed javobi — backend `{items, page, limit, total}` qaytaradi. */
export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ── So'rovlar ─────────────────────────────────────────────────────────

export const FEED_PAGE_SIZE = 12;

export function fetchFeed(params: {
  q?: string;
  categoryId?: string;
  page?: number;
}): Promise<Paged<Elon>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.categoryId) qs.set("categoryId", params.categoryId);
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(FEED_PAGE_SIZE));
  return api.get<Paged<Elon>>(`/api/elons?${qs}`);
}

export const fetchCategories = () => api.get<Category[]>("/api/categories");
export const fetchElon = (id: string) => api.get<Elon>(`/api/elons/${id}`);
export const fetchMe = () => api.get<User>("/api/me");
export const fetchMyApplications = () => api.get<Application[]>("/api/my/applications");

export function applyToElon(elonId: string, body: { peopleCount?: number; message?: string }) {
  return api.post<Application>(`/api/elons/${elonId}/apply`, body);
}

export function cancelApplication(id: string) {
  return api.post<Application>(`/api/applications/${id}/cancel`, {});
}

// ── Bildirishnomalar ──────────────────────────────────────────────────

export interface RelatedEntity {
  type: string;
  id: ID;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  type: string;
  title: string;
  body: string;
  relatedEntity?: RelatedEntity;
  isRead: boolean;
  createdAt: string;
}

export const fetchNotifications = () =>
  api.get<AppNotification[]>("/api/notifications?limit=100");

export const markAllNotificationsRead = () =>
  api.post<{ ok: boolean }>("/api/notifications/read-all", {});

/** Bitta yozuvga tegishli o'qilmaganlarni belgilash (e'lon ochilganda). */
export const markNotificationsRead = (relatedIds: string[], relatedType?: string) =>
  api.post<{ ok: boolean }>("/api/notifications/read", { relatedIds, relatedType });

// ── Ish tarixi ────────────────────────────────────────────────────────

/** Yakunlangan / bekor qilingan / rad etilgan arizalar (ishchi va ish beruvchi). */
export const fetchHistory = () => api.get<Application[]>("/api/me/history");

// ── Profil ────────────────────────────────────────────────────────────

export interface MeUpdate {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  region?: string;
  district?: string;
  bio?: string;
  skills?: string[];
}

export const updateMe = (body: MeUpdate) => api.patch<User>("/api/me", body);

// ── E'lon yaratish / boshqarish ───────────────────────────────────────

/**
 * Ish sanasi eng ko'pi shuncha kun oldinga qo'yilishi mumkin.
 *
 * Backend'dagi `maxScheduleDays` bilan bir xil bo'lishi SHART
 * (apps/api/internal/elon/handler.go → validateStartDate). Mos kelmasa forma
 * foydalanuvchiga ruxsat bergan sanani server 400 bilan qaytaradi.
 * 3 = bugun, ertaga yoki indinga.
 */
export const MAX_SCHEDULE_DAYS = 3;

export interface ElonInput {
  title: string;
  categoryId: string;
  description: string;
  workersNeeded: number;
  pricingType: "per_worker" | "total" | "negotiable";
  priceAmount: number;
  startDate?: string;
  workTimeFrom?: string;
  workTimeTo?: string;
  contactPhone?: string;
  gender?: Gender;
  images?: string[];
  lat?: number;
  lng?: number;
  locationText?: string;
}

export const createElon = (body: ElonInput) => api.post<Elon>("/api/elons", body);

/** Mening e'lonlarim (faol + arxiv), eng yangisi birinchi. */
export const fetchMyElons = () => api.get<Elon[]>("/api/my/elons");

/** E'lonni bekor qilish — o'chirish emas, holati "cancelled" bo'ladi. */
export const cancelElon = (id: string) => api.post<Elon>(`/api/elons/${id}/cancel`, {});

// ── Xarita ────────────────────────────────────────────────────────────

/**
 * Xarita uchun e'lonlar — koordinatasi borlari.
 *
 * Feed'ning o'zi ishlatiladi (alohida endpoint yo'q), lekin kattaroq sahifa
 * bilan: xaritada bir vaqtning o'zida ko'proq pin ko'rinishi kerak, aks holda
 * uzoqlashtirilganda xarita deyarli bo'sh chiqadi.
 */
export async function fetchMapElons(categoryId?: string): Promise<Elon[]> {
  const qs = new URLSearchParams();
  if (categoryId) qs.set("categoryId", categoryId);
  qs.set("page", "1");
  qs.set("limit", "100");
  const res = await api.get<Paged<Elon>>(`/api/elons?${qs}`);
  return (res.items || []).filter(
    (e) => typeof e.lat === "number" && typeof e.lng === "number" && (e.lat !== 0 || e.lng !== 0),
  );
}
