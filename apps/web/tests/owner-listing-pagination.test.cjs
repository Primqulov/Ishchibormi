const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../lib/owner-listing.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(get) {
  let session = "owner-session";
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "./api");
      return { api: { get }, getAccess: () => session };
    },
  });
  return { ...module.exports, setSession(value) { session = value; } };
}

function application(index, elonId = "new-listing") {
  return { id: "application-" + index, elonId, status: "pending" };
}
function grouped(items) {
  const result = {};
  for (const item of items) (result[item.elonId] ||= []).push(item);
  return result;
}

test("loads an older listing's accepted applicant beyond the first 500 rows", async () => {
  const firstPage = Array.from({ length: 500 }, (_, i) => application(i));
  const older = { ...application(501, "older-listing"), status: "accepted" };
  const calls = [];
  const helper = setup(async (url, options) => {
    calls.push(url);
    assert.equal(options.cache, "no-store");
    return url.endsWith("page=1") ? grouped(firstPage) : grouped([older]);
  });
  const result = await helper.loadAllOwnerApplications();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /limit=500&page=1$/);
  assert.match(calls[1], /limit=500&page=2$/);
  assert.equal(result["new-listing"].length, 500);
  assert.equal(result["older-listing"][0].status, "accepted");
});

test("fetches the terminating empty page for exactly 500 applications", async () => {
  let calls = 0;
  const helper = setup(async () => ++calls === 1 ? grouped(Array.from({ length: 500 }, (_, i) => application(i))) : {});
  const result = await helper.loadAllOwnerApplications();
  assert.equal(calls, 2);
  assert.equal(result["new-listing"].length, 500);
});

test("deduplicates overlapping page boundaries without losing older rows", async () => {
  const first = Array.from({ length: 500 }, (_, i) => application(i));
  let calls = 0;
  const helper = setup(async () => ++calls === 1 ? grouped(first) : grouped([application(499), application(500, "older-listing")]));
  const result = await helper.loadAllOwnerApplications();
  assert.equal(Object.values(result).flat().length, 501);
  assert.equal(result["older-listing"].length, 1);
});

test("a server repeating a full page fails instead of reporting partial totals", async () => {
  const fullPage = grouped(Array.from({ length: 500 }, (_, i) => application(i)));
  let calls = 0;
  const helper = setup(async () => { calls += 1; return fullPage; });
  await assert.rejects(helper.loadAllOwnerApplications(), { code: "applications_incomplete" });
  assert.equal(calls, 2);
});

test("a failed later page does not return earlier applications as complete", async () => {
  let calls = 0;
  const failure = { code: "server_unavailable", message: "offline" };
  const helper = setup(async () => {
    if (++calls === 1) return grouped(Array.from({ length: 500 }, (_, i) => application(i)));
    throw failure;
  });
  await assert.rejects(helper.loadAllOwnerApplications(), (error) => error === failure);
});

test("an account switch discards the entire pagination result", async () => {
  let calls = 0;
  const helper = setup(async () => {
    calls += 1;
    helper.setSession("another-owner");
    return grouped([application(0)]);
  });
  await assert.rejects(helper.loadAllOwnerApplications(), { code: "owner_required" });
  assert.equal(calls, 1);
});

test("requires a signed-in session before requesting any page", async () => {
  let calls = 0;
  const helper = setup(async () => { calls += 1; return {}; });
  helper.setSession(null);
  await assert.rejects(helper.loadAllOwnerApplications(), { code: "no_account" });
  assert.equal(calls, 0);
});

test("query cancellation stops pagination before another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const helper = setup(async (_url, options) => {
    calls += 1;
    assert.equal(options.signal, controller.signal);
    controller.abort();
    return grouped(Array.from({ length: 500 }, (_, i) => application(i)));
  });
  await assert.rejects(helper.loadAllOwnerApplications(controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("malformed grouped data cannot masquerade as a zero count", async () => {
  const helper = setup(async () => ({ "new-listing": { message: "not an array" } }));
  await assert.rejects(helper.loadAllOwnerApplications(), { code: "applications_incomplete" });
});

test("owner guard includes applications from every page", async () => {
  const listing = { id: "older-listing", ownerId: "owner", status: "recruiting", acceptedCount: 0 };
  const helper = setup(async (url) => {
    if (url === "/api/me") return { id: "owner" };
    if (url === "/api/elons/older-listing") return listing;
    if (url.endsWith("page=1")) return grouped(Array.from({ length: 500 }, (_, i) => application(i)));
    return grouped([{ ...application(501, "older-listing"), status: "accepted" }]);
  });
  const guard = await helper.loadOwnerListingGuard("older-listing");
  assert.equal(guard.applications.length, 1);
  assert.equal(helper.requiresOwnerCancellation(guard.listing, guard.applications), true);
});
