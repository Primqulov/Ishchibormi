import { expect, test } from "@playwright/test";
import { capture, CATEGORY, LISTING, openDelete, openDetails, OwnerFixture, TITLE, WORKER } from "./fixture";

test("owner sees applications and saves a prefilled edit back to refreshed details", async ({ page }, info) => {
  const fixture = new OwnerFixture();
  await fixture.install(page);
  await openDetails(page, fixture);
  await expect(page.getByText("MENING E'LONIM", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Arizalarni ko'rish/ })).toHaveAttribute("href", `/process?tab=employer&elon=${LISTING}`);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ariza yuborish", exact: true })).toHaveCount(0);
  await capture(page, info, "owner-detail");
  await page.getByRole("link", { name: "Tahrirlash", exact: true }).click();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await expect(page.getByRole("radio", { name: "Tozalash", exact: true })).toBeChecked();
  await expect(page.getByLabel("Ish haqi (UZS)", { exact: true })).toHaveValue("200 000");
  await expect(page.getByText(/7 ta faol ariza yuborilgan/)).toBeVisible();
  await capture(page, info, "owner-edit");
  await page.getByLabel("Vazifa nomi", { exact: true }).fill("Kvartirani tozalash — yangilangan e'lon");
  await page.getByLabel("Ish haqi (UZS)", { exact: true }).fill("240000");
  await page.getByLabel("Manzil", { exact: true }).fill("Chilonzor tumani, 13-mavze");
  await page.getByRole("button", { name: "O'zgarishlarni saqlash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kvartirani tozalash — yangilangan e'lon", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("O'zgarishlar saqlandi");
  expect(fixture.patches).toHaveLength(1);
  expect(fixture.patches[0].body).toMatchObject({ categoryId: CATEGORY, priceAmount: 240000, locationText: "Chilonzor tumani, 13-mavze" });
  await fixture.assertClean();
});

test("delete cancel preserves listing, confirmation archives it and owner can open archive", async ({ page }, info) => {
  const fixture = new OwnerFixture();
  await fixture.install(page);
  await openDetails(page, fixture);
  let dialog = await openDelete(page);
  await expect(dialog).toContainText("7 ta ariza avtomatik bekor qilinadi");
  await capture(page, info, "delete-confirmation");
  await dialog.getByRole("button", { name: "Bekor qilish", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(fixture.cancellations).toHaveLength(0);
  dialog = await openDelete(page);
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "E'lon o'chirildi", exact: true })).toBeVisible();
  await capture(page, info, "delete-success");
  expect(fixture.cancellations).toHaveLength(1);
  expect(fixture.cancellations[0].body).toEqual({ intent: "delete" });
  await dialog.getByRole("button", { name: "Arxivni ko'rish", exact: true }).click();
  await expect(page).toHaveURL(/\/my-elons\?tab=cancelled$/);
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
  await capture(page, info, "owner-list-archive");
  await page.getByRole("link", { name: TITLE, exact: true }).click();
  await expect(page.getByRole("heading", { name: TITLE, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tahrirlash", exact: true })).toBeDisabled();
  expect(fixture.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  await fixture.assertClean();
});

test("edit danger zone uses the same zero-application confirmation", async ({ page }) => {
  const fixture = new OwnerFixture(0);
  await fixture.install(page);
  await page.goto(`/elon/${LISTING}/edit`);
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await expect(page.getByText(/ta faol ariza yuborilgan/)).toHaveCount(0);
  const dialog = await openDelete(page);
  await expect(dialog).toContainText("Bu amalni qaytarib bo'lmaydi.");
  await expect(dialog).not.toContainText("ariza avtomatik");
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "E'lon o'chirildi", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "E'lonlarimga qaytish", exact: true }).click();
  await expect(page).toHaveURL(/\/my-elons$/);
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toHaveCount(0);
  expect(fixture.cancellations).toHaveLength(1);
  await fixture.assertClean();
});

test("confirmed candidate blocks deletion and cancellation requires a saved reason", async ({ page }, info) => {
  const fixture = new OwnerFixture();
  fixture.confirmCandidate();
  await fixture.install(page);
  await openDetails(page, fixture);
  await page.getByRole("button", { name: "E'lonni o'chirish", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "E'lonni o'chirib bo'lmaydi", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Mahmud Sobirov");
  await capture(page, info, "delete-blocked");
  await dialog.getByRole("button", { name: "Ishni bekor qilish", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Ishni bekor qilish", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox").fill("    ");
  await expect(dialog.getByRole("button", { name: "Ishni bekor qilish", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox").fill("Ish boshqa kunga ko'chirildi");
  await dialog.getByRole("button", { name: "Ishni bekor qilish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Ish bekor qilindi", exact: true })).toBeVisible();
  expect(fixture.cancellations[0].body).toEqual({ reason: "Ish boshqa kunga ko'chirildi" });
  expect(fixture.listing.cancelReason).toBe("Ish boshqa kunga ko'chirildi");
  await fixture.assertClean();
});

test("changed application count requires confirming the refreshed impact", async ({ page }) => {
  const fixture = new OwnerFixture(1);
  await fixture.install(page);
  await openDetails(page, fixture);
  const dialog = await openDelete(page);
  await expect(dialog).toContainText("1 ta ariza avtomatik");
  fixture.applications.push(fixture.application(1));
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog).toContainText("2 ta ariza avtomatik");
  expect(fixture.cancellations).toHaveLength(0);
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "E'lon o'chirildi", exact: true })).toBeVisible();
  expect(fixture.cancellations).toHaveLength(1);
  await fixture.assertClean();
});

test("acceptance after final client checks is recovered from the server conflict", async ({ page }) => {
  const fixture = new OwnerFixture(1);
  fixture.acceptAtCancellation = true;
  await fixture.install(page);
  await openDetails(page, fixture);
  const dialog = await openDelete(page);
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "E'lonni o'chirib bo'lmaydi", exact: true })).toBeVisible();
  expect(fixture.listing.status).toBe("filled");
  await expect(dialog.getByRole("button", { name: "Ishni bekor qilish", exact: true })).toBeEnabled();
  await fixture.assertClean();
});

test("PATCH errors keep user edits and untouched legacy fields survive retry", async ({ page }) => {
  const fixture = new OwnerFixture(0);
  Object.assign(fixture.listing, { startDate: "2020-08-02T14:00:00+05:00", lat: 41.285, lng: 69.203, locationUrl: "https://maps.google.com/?q=41.285,69.203", images: ["http://127.0.0.1:4318/fixtures/listing.svg"] });
  const original = structuredClone(fixture.listing);
  fixture.patchFailure = true;
  await fixture.install(page);
  await page.goto(`/elon/${LISTING}/edit`);
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await page.getByLabel("Vazifa nomi", { exact: true }).fill("Saqlanadigan yangi sarlavha");
  await page.getByRole("button", { name: "O'zgarishlarni saqlash", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Serverda vaqtinchalik xatolik" })).toBeVisible();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue("Saqlanadigan yangi sarlavha");
  expect(fixture.listing.title).toBe(TITLE);
  fixture.patchFailure = false;
  await page.getByRole("button", { name: "O'zgarishlarni saqlash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saqlanadigan yangi sarlavha", exact: true })).toBeVisible();
  expect(fixture.patches).toHaveLength(2);
  expect(fixture.patches[1].body).toMatchObject({ startDate: original.startDate, workTimeFrom: original.workTimeFrom, workTimeTo: original.workTimeTo, lat: original.lat, lng: original.lng, locationUrl: original.locationUrl, images: original.images, contactPhone: original.contactPhone });
  await fixture.assertClean();
});

test("worker view has no owner actions and direct edit access is refused", async ({ page }) => {
  const fixture = new OwnerFixture();
  fixture.userId = WORKER;
  await fixture.install(page);
  await openDetails(page, fixture);
  await expect(page.getByRole("button", { name: "Ariza yuborish", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tahrirlash", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "E'lonni o'chirish", exact: true })).toHaveCount(0);
  await page.goto(`/elon/${LISTING}/edit`);
  await expect(page.getByRole("alert").filter({ hasText: "faqat e'lon egasi" })).toBeVisible();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveCount(0);
  expect(fixture.patches).toHaveLength(0);
  expect(fixture.cancellations).toHaveLength(0);
  await fixture.assertClean();
});

test("listing card edit and overflow delete entries reach guarded owner flows", async ({ page }, info) => {
  const fixture = new OwnerFixture();
  await fixture.install(page);
  await page.goto("/my-elons");
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
  await capture(page, info, "owner-list");
  await page.getByRole("link", { name: "Tahrirlash", exact: true }).first().click();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await page.getByRole("button", { name: "Bekor qilish", exact: true }).click();
  await expect(page.getByRole("heading", { name: TITLE, exact: true })).toBeVisible();
  await page.goto("/my-elons");
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "E'lon amallari", exact: true }).click();
  await page.getByRole("menuitem", { name: "E'lonni o'chirish", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "E'lonni o'chirasizmi?", exact: true })).toBeVisible();
  await fixture.assertClean();
});

test("mobile owner detail edit and confirmation fit a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const fixture = new OwnerFixture();
  await fixture.install(page);
  await openDetails(page, fixture);
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noOverflow();
  await capture(page, info, "owner-detail-mobile");
  const dialog = await openDelete(page);
  await noOverflow();
  await capture(page, info, "delete-mobile");
  await dialog.getByRole("button", { name: "Bekor qilish", exact: true }).click();
  await page.getByRole("link", { name: "Tahrirlash", exact: true }).click();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await noOverflow();
  await capture(page, info, "owner-edit-mobile");
  await fixture.assertClean();
});

test("retry recovers a committed cancellation after both immediate verification reads fail", async ({ page }) => {
  const fixture = new OwnerFixture(1);
  fixture.cancelFailureAfterCommit = true;
  fixture.failReadsAfterCancellation = true;
  await fixture.install(page);
  await openDetails(page, fixture);
  const dialog = await openDelete(page);
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Amalni bajarib bo'lmadi", exact: true })).toBeVisible();
  expect(fixture.listing.status).toBe("cancelled");
  const attemptIndex = fixture.calls.findIndex((call) => call.path.endsWith("/cancel"));
  expect(fixture.calls.slice(attemptIndex + 1).filter((call) => call.path === `/api/elons/${LISTING}` && call.method === "GET").length).toBeGreaterThanOrEqual(2);
  fixture.listingReadFailure = false;
  await dialog.getByRole("button", { name: "Qayta urinish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "E'lon o'chirildi", exact: true })).toBeVisible();
  await expect(dialog).toContainText("biroz vaqt olishi mumkin");
  expect(fixture.cancellations).toHaveLength(1);
  await dialog.getByRole("button", { name: "Arxivni ko'rish", exact: true }).click();
  await expect(page).toHaveURL(/\/my-elons\?tab=cancelled$/);
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
  await fixture.assertClean();
});

test("successful delayed cancellation cannot publish an old owner's success after session changes", async ({ page }) => {
  const fixture = new OwnerFixture(1);
  let release!: () => void;
  fixture.cancelResponseGate = new Promise<void>((resolve) => { release = resolve; });
  await fixture.install(page);
  await openDetails(page, fixture);
  const dialog = await openDelete(page);
  await dialog.getByRole("button", { name: "Ha, o'chirish", exact: true }).click();
  await expect.poll(() => fixture.cancellations.length).toBe(1);
  await page.evaluate(() => localStorage.setItem("ib-access", "different-local-session"));
  fixture.userId = WORKER;
  release();
  await expect(dialog.getByRole("heading", { name: "Amalni bajarib bo'lmadi", exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Hisob o'zgardi");
  await expect(dialog.getByRole("heading", { name: "E'lon o'chirildi", exact: true })).toHaveCount(0);
  // The successful response must not replace the previous listing cache or
  // trigger an owner-listing invalidation under this different session.
  await dialog.getByRole("button", { name: "Yopish", exact: true }).click();
  await expect(page.getByRole("link", { name: "Tahrirlash", exact: true })).toBeVisible();
  expect(fixture.cancellations).toHaveLength(1);
  await fixture.assertClean();
});

test("older listing's accepted candidate beyond page one still blocks deletion", async ({ page }) => {
  const fixture = new OwnerFixture(501);
  fixture.applications.slice(0, 500).forEach((application) => { application.elonId = "666666666666666666666666"; });
  fixture.applications[500].status = "accepted";
  // An old denormalized count cannot override the real accepted application.
  fixture.listing.acceptedCount = 0;
  fixture.listing.status = "recruiting";
  await fixture.install(page);
  await openDetails(page, fixture);
  await page.getByRole("button", { name: "E'lonni o'chirish", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "E'lonni o'chirib bo'lmaydi", exact: true })).toBeVisible();
  expect(fixture.calls.some((call) => call.path === "/api/my/elons/applications" && new URLSearchParams(call.query).get("page") === "2")).toBe(true);
  expect(fixture.cancellations).toHaveLength(0);
  await fixture.assertClean();
});

test("expired open listing remains archived and two-worker wage stays per worker", async ({ page }) => {
  const fixture = new OwnerFixture(0);
  Object.assign(fixture.listing, { startDate: "2020-08-02T14:00:00+05:00", workersNeeded: 2, priceAmount: 400000, perWorkerAmount: 200000 });
  await fixture.install(page);
  await page.goto("/my-elons");
  await expect(page.getByText("Hozircha e'lon yo'q", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Arxiv/ }).click();
  const card = page.getByRole("article");
  await expect(card.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
  await expect(card).toContainText("Muddati o'tgan");
  await expect(card.getByText("200 000", { exact: true })).toBeVisible();
  await expect(card.getByText("400 000", { exact: true })).toHaveCount(0);
  await expect(card).toContainText("Har bir ishchi uchun");
  await fixture.assertClean();
});

test("delayed edit response cannot publish success into a changed session", async ({ page }) => {
  const fixture = new OwnerFixture(0);
  let release!: () => void;
  fixture.patchResponseGate = new Promise<void>((resolve) => { release = resolve; });
  await fixture.install(page);
  await page.goto(`/elon/${LISTING}/edit`);
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await page.getByLabel("Vazifa nomi", { exact: true }).fill("Saqlangan lekin boshqa sessiyadagi e'lon");
  await page.getByRole("button", { name: "O'zgarishlarni saqlash", exact: true }).click();
  await expect.poll(() => fixture.patches.length).toBe(1);
  await page.evaluate(() => localStorage.setItem("ib-access", "changed-edit-session"));
  fixture.userId = WORKER;
  release();
  await expect(page.getByRole("alert").filter({ hasText: "Hisob o'zgardi" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/elon/${LISTING}/edit$`));
  await expect(page.getByText("O'zgarishlar saqlandi", { exact: true })).toHaveCount(0);
  expect(fixture.patches).toHaveLength(1);
  await fixture.assertClean();
});

test("remote field drift is not overwritten by a title-only save", async ({ page }) => {
  const fixture = new OwnerFixture(0);
  await fixture.install(page);
  await page.goto(`/elon/${LISTING}/edit`);
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await page.getByLabel("Vazifa nomi", { exact: true }).fill("Saqlanmagan mahalliy sarlavha");
  Object.assign(fixture.listing, { priceAmount: 250000, perWorkerAmount: 250000, locationText: "Boshqa qurilmadan kiritilgan manzil", images: ["http://127.0.0.1:4318/fixtures/changed-listing.svg"] });
  await page.getByRole("button", { name: "O'zgarishlarni saqlash", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /o'zgargan|yangilangan/ })).toBeVisible();
  expect(fixture.patches).toHaveLength(0);
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue("Saqlanmagan mahalliy sarlavha");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "So'nggi ma'lumotlarni yuklash", exact: true }).click();
  await expect(page.getByLabel("Vazifa nomi", { exact: true })).toHaveValue(TITLE);
  await expect(page.getByLabel("Ish haqi (UZS)", { exact: true })).toHaveValue("250 000");
  await expect(page.getByLabel("Manzil", { exact: true })).toHaveValue("Boshqa qurilmadan kiritilgan manzil");
  await expect(page.getByRole("img", { name: "E'lon rasmi 1", exact: true })).toBeVisible();
  expect(fixture.patches).toHaveLength(0);
  await fixture.assertClean();
});
