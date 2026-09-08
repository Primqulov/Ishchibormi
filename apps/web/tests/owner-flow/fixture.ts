import { expect, type Page, type Route, type TestInfo } from "@playwright/test";
import type { Application, Elon } from "../../lib/api";

export const OWNER = "111111111111111111111111";
export const WORKER = "222222222222222222222222";
export const LISTING = "333333333333333333333333";
export const CATEGORY = "444444444444444444444444";
export const OTHER_CATEGORY = "555555555555555555555555";
export const TITLE = "Kvartira tozalash uchun yordamchi kerak";

type Call = { method: string; path: string; query: string; body: Record<string, unknown> | undefined };

export class OwnerFixture {
  listing: Elon;
  applications: Application[];
  calls: Call[] = [];
  unexpected: string[] = [];
  userId = OWNER;
  patchFailure = false;
  cancelFailureAfterCommit = false;
  acceptAtCancellation = false;
  applicationReadFailure = false;
  listingReadFailure = false;
  failReadsAfterCancellation = false;
  cancelResponseGate: Promise<void> | null = null;
  patchResponseGate: Promise<void> | null = null;
  authenticated = true;

  constructor(count = 7) {
    const tomorrow = new Date(Date.now() + 86400000 + 5 * 3600000).toISOString().slice(0, 10);
    this.listing = {
      id: LISTING, ownerId: OWNER, title: TITLE, categoryId: CATEGORY, categoryName: "Tozalash",
      description: "3 xonali kvartirani chuqur tozalash kerak. Barcha tozalash vositalari va jihozlari joyida mavjud — o'zingiz bilan hech narsa olib kelish shart emas.\n\nIsh hajmi: oshxona, 2 ta yotoqxona, mehmonxona, 2 ta sanuzel va balkon. Deraza oynalarini ham yuvish kerak. Taxminan 4 soat vaqt talab qilinadi.",
      locationText: "Chilonzor tumani, 12-mavze", locationUrl: "", region: "Toshkent", district: "Chilonzor",
      workersNeeded: 1, pricingType: "per_worker", priceAmount: 200000, perWorkerAmount: 200000,
      startDate: `${tomorrow}T14:00:00`, workTimeFrom: "14:00", workTimeTo: "18:00", contactPhone: "+998901234567",
      gender: "mixed", status: "recruiting", acceptedCount: 0, viewsCount: 184, ownerName: "Javohir Aliyev",
      publishedAt: new Date(Date.now() - 2 * 86400000).toISOString(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      updatedAt: new Date().toISOString(), images: [],
    };
    this.applications = Array.from({ length: count }, (_, i) => this.application(i));
  }

  application(index: number): Application {
    return {
      id: (100 + index).toString(16).padStart(24, "0"), elonId: LISTING, elonTitle: TITLE,
      workerId: (200 + index).toString(16).padStart(24, "0"), employerId: OWNER,
      workerPhone: `+9989011111${String(index).padStart(2, "0")}`,
      workerName: ["Mahmud Sobirov", "Rustam Qodirov", "Nilufar Karimova"][index % 3],
      workerRating: [4.9, 4.7, 5][index % 3], workerReviewsCount: 14 + index,
      peopleCount: 1, amount: 200000, isNegotiable: false, status: "pending",
      appliedAt: new Date(Date.now() - (index + 2) * 3600000).toISOString(),
    };
  }

  get writes() { return this.calls.filter((call) => call.method !== "GET" && call.method !== "OPTIONS"); }
  get patches() { return this.calls.filter((call) => call.method === "PATCH"); }
  get cancellations() { return this.calls.filter((call) => call.path.endsWith("/cancel") && call.method === "POST"); }

  confirmCandidate() {
    this.listing.status = "filled";
    this.listing.acceptedCount = 1;
    if (this.applications.length === 0) this.applications.push(this.application(0));
    this.applications[0].status = "accepted";
    this.applications.slice(1).forEach((application) => { application.status = "rejected"; });
  }

  async install(page: Page) {
    await page.addInitScript(({ authenticated }) => {
      if (authenticated) localStorage.setItem("ib-access", "owner-flow-local-fixture");
      else localStorage.removeItem("ib-access");
      localStorage.setItem("theme", "light");
      localStorage.setItem("ib-script", JSON.stringify({ state: { script: "latin" }, version: 0 }));
    }, { authenticated: this.authenticated });

    await page.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      // No requests can reach production, map providers or other accounts.
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
      if (url.pathname.startsWith("/api/")) return this.api(route, url.pathname);
      if (url.port === "4318" && url.pathname.startsWith("/fixtures/")) {
        return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#d4e3ff"/><path d="M50 105V55h60v50zm7-8 15-20 14 12 10-14 8 22" fill="none" stroke="#0038d8" stroke-width="4"/></svg>' });
      }
      return route.continue();
    });
  }

  async api(route: Route, path: string) {
    const request = route.request();
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    const query = new URL(request.url()).search;
    this.calls.push({ method, path, query, body });
    const reply = (data: unknown, status = 200) => route.fulfill({ status, json: data, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3105", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" } });
    if (method === "OPTIONS") return reply({});
    if (path === "/api/me") return reply({ id: this.userId, firstName: "Javohir", lastName: "Aliyev", phone: "+998901234567", onboardingCompleted: true, completedJobsCount: 48, isPhoneVerified: true, isBlocked: false, createdAt: this.listing.createdAt });
    if (path === "/api/categories") return reply([{ id: CATEGORY, name: "Tozalash" }, { id: OTHER_CATEGORY, name: "Yuk tashish" }]);
    if (path === "/api/notifications") return reply(this.applications.slice(0, 3).map((application, i) => ({ id: (300 + i).toString(16).padStart(24, "0"), type: "new_application", title: "Yangi ariza", body: TITLE, isRead: false, relatedEntity: { type: "application", id: application.id }, createdAt: application.appliedAt })));
    if (path === "/api/notifications/read") return reply({ ok: true });
    if (path === "/api/my/elons/applications") {
      if (this.applicationReadFailure) return reply({ error: { code: "internal", message: "Arizalarni yuklab bo'lmadi." } }, 500);
      const params = new URLSearchParams(query);
      const limit = Math.min(500, Math.max(1, Number(params.get("limit") || 200)));
      const page = Math.max(1, Number(params.get("page") || 1));
      const grouped: Record<string, Application[]> = {};
      if (this.userId === OWNER) {
        this.applications.slice((page - 1) * limit, page * limit).forEach((application) => {
          (grouped[application.elonId] ||= []).push(application);
        });
      }
      return reply(grouped);
    }
    if (path === "/api/my/elons") {
      const start = this.listing.startDate ? Date.parse(this.listing.startDate) : Number.POSITIVE_INFINITY;
      const archived = ["cancelled", "completed"].includes(this.listing.status) || start < Date.now() - 6 * 3600000;
      return reply({ drafts: [], active: archived ? [] : [this.listing], archived: archived ? [this.listing] : [] });
    }
    if (path === "/api/my/applications" || path === "/api/my/history" || path === "/api/history") return reply([]);
    if (path.startsWith("/api/users/")) return reply({ id: path.split("/").pop(), firstName: "Mahmud", lastName: "Sobirov", workerRating: 4.9, workerReviewsCount: 14, completedJobsCount: 48 });
    if (path === `/api/elons/${LISTING}` && method === "GET") {
      if (this.listingReadFailure) return reply({ error: { code: "internal", message: "E'lonni yuklab bo'lmadi." } }, 500);
      if (this.listing.status === "cancelled" && (this.userId !== OWNER || !request.headers().authorization)) return reply({ error: { code: "not_found", message: "E'lon topilmadi." } }, 404);
      return reply(this.listing);
    }
    if (path === `/api/elons/${LISTING}` && method === "PATCH") {
      if (this.patchFailure) return reply({ error: { code: "internal", message: "Saqlash amalga oshmadi. Qayta urinib ko'ring." } }, 500);
      this.listing = { ...this.listing, ...body, updatedAt: new Date().toISOString() } as Elon;
      if (body?.categoryId === OTHER_CATEGORY) this.listing.categoryName = "Yuk tashish";
      if (this.listing.pricingType === "per_worker") {
        this.listing.perWorkerAmount = Number(body?.priceAmount);
        this.listing.priceAmount = this.listing.perWorkerAmount * this.listing.workersNeeded;
      } else this.listing.perWorkerAmount = Math.floor(this.listing.priceAmount / this.listing.workersNeeded);
      if (this.patchResponseGate) await this.patchResponseGate;
      return reply(this.listing);
    }
    if (path === `/api/elons/${LISTING}/cancel` && method === "POST") {
      if (this.acceptAtCancellation) { this.confirmCandidate(); this.acceptAtCancellation = false; }
      if (this.listing.acceptedCount > 0 && !body?.reason) return reply({ error: { code: "cancellation_required", message: "Nomzod tanlangan. Sabab bilan bekor qiling." } }, 409);
      this.listing = { ...this.listing, status: "cancelled", cancelledAt: new Date().toISOString(), cancelReason: String(body?.reason || "E'lon egasi tomonidan o'chirildi") };
      this.applications.forEach((application) => { if (["pending", "accepted"].includes(application.status)) application.status = "cancelled"; });
      if (this.failReadsAfterCancellation) this.listingReadFailure = true;
      if (this.cancelResponseGate) await this.cancelResponseGate;
      if (this.cancelFailureAfterCommit) return reply({ error: { code: "owner_cleanup_pending", message: "Arizalar yangilanmoqda." } }, 503);
      return reply(body?.intent === "delete" ? { ok: true } : this.listing);
    }
    this.unexpected.push(`${method} ${path}`);
    return reply({ error: { code: "fixture_missing", message: `Unmocked ${method} ${path}` } }, 404);
  }

  async assertClean() { expect(this.unexpected, "All API requests must use explicit local fixtures").toEqual([]); }
}

export async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: await page.getByRole("dialog").count() === 0, animations: "disabled" });
  await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: "image/png" });
}

export async function openDetails(page: Page, fixture: OwnerFixture) {
  await page.goto(`/elon/${LISTING}`);
  await expect(page.getByRole("heading", { name: fixture.listing.title, exact: true })).toBeVisible();
}

export async function openDelete(page: Page) {
  await page.getByRole("button", { name: "E'lonni o'chirish", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "E'lonni o'chirasizmi?", exact: true })).toBeVisible();
  return dialog;
}
