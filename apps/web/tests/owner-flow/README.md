# Owner listing browser checks

Run `npm run test:owner-flow` from `apps/web`. The suite starts a dedicated Next
development server on `127.0.0.1:3105` and a dummy SSR API on `127.0.0.1:4318`.
Both ports must be free. Neither server is reused from another process.

Run `node --test tests/owner-listing-pagination.test.cjs` from `apps/web` for
the pagination helper's data, cancellation, and account-change regressions.

The default browser is installed Google Chrome. Set `PLAYWRIGHT_CHANNEL=msedge`
for installed Edge, or `PLAYWRIGHT_CHANNEL=chromium` after
`npx playwright install chromium` for Playwright's bundled browser.

All browser API traffic is intercepted with isolated in-memory fixtures; all
external requests are blocked. No live account, API, database or credentials
are used. The dummy API returns 404 for server-side listing reads to exercise
the authenticated client fallback required by private archived listings.

Tests cover owner details, edit/save and validation failures, both delete entry
points, cancellation reasons, archive navigation, stale applicant counts,
acceptance conflicts, recovery after committed-but-failed responses, session
changes during mutations, non-owner access and narrow mobile layouts.
They also verify pagination beyond 500 received applications, expired-listing
archive grouping, per-worker pricing, and refusing to overwrite remote edits.

Review screenshots and failed-run traces are in `test-results/owner-flow/`.
The HTML report is in `playwright-report/` and includes named screenshot
attachments. These generated directories are ignored by Git.
