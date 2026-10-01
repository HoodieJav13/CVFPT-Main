# Preview Mode Post-Launch (Steps 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview mode trustworthy for post-launch review: unmocked routes are explicit and fail tests, loading/failure states are one tap away on a phone, and recurring sessions can be exercised in preview.

**Architecture:** All work is inside `frontend/`. The preview mock adapter (`previewMode.js`) gains an exclusions list, a missing-mock marker observed by a shared Playwright fixture, and a fault wrapper that runs around the existing route handler. Recurring-session logic is a pure, node-testable module (`previewSeries.js`) ported from the backend; `previewMode.js` only wires routes to it.

**Tech Stack:** React 19, Vite 6, axios (custom adapter), sonner toasts, Playwright 1.61.1, `node --test` unit tests.

**Spec:** `docs/superpowers/specs/2026-10-01-preview-mode-post-launch-design.md` (revision 3). Read it before any task.

**Execution (owner decision 2026-10-01):** inline, in one session, with a stop for owner review at each PR boundary — after Task 2, after Task 4, and after Task 9.

## Global Constraints

- Written against `origin/main` at `e86938d`. Start every PR branch from current `origin/main` (`git fetch origin main` first). Line numbers below are from `e86938d` and will drift; locate code by the quoted text.
- Three PRs, in order: Tasks 1–2 (PR 1), Tasks 3–4 (PR 2), Tasks 5–9 (PR 3). Each PR leaves `npm run test:e2e:preview` green on its own.
- Never touch the preview gate: `frontend/src/lib/previewFlag.js` and the `hostedDemoDefines` block in `frontend/vite.config.js`.
- Nothing is imported across the `frontend/` ↔ `backend/` boundary. Backend logic needed in preview is copied, not referenced.
- No backend, migration, or schema change.
- Sarah's existing fixtures (`client_sarah` and everything keyed to her) are not edited or removed.
- Design tokens only in components; no hex colors. Reuse the toolbar's existing classes.
- Exact strings: toast titles `Not available in preview` and `Preview is missing a mock`; console marker `[cvf-preview:missing-mock]`; simulated failure message `Simulated failure (preview)`; storage keys `cvf_preview_latency`, `cvf_preview_fail`.
- Status codes: unsupported route 422, missing mock 404, simulated failure 503.
- Do not edit the "Preview mode" section of `CLAUDE.md`; the owner is amending it.
- Commits: small and scoped; end each commit message with the session's attribution line. Do not push or open a PR without the owner asking.
- All commands run from `frontend/` unless a step says otherwise.

## File Structure

| File | Responsibility | PR |
|---|---|---|
| `frontend/e2e/preview-test.mjs` (new) | Shared Playwright `test` with the automatic missing-mock fixture; `usePreviewRole`, `callPreviewApi` helpers | 1 |
| `frontend/e2e/preview-harness.spec.mjs` (new) | Tests for the detector and the unsupported state | 1 |
| `frontend/e2e/preview-critical.spec.mjs` | Import `test`/`expect` from `preview-test.mjs` (one line) | 1 |
| `frontend/src/lib/previewMode.js` | Exclusions list, missing-mock marker, notices; fault wrapper, switches, reset; series routes, seed, program clone | 1, 2, 3 |
| `frontend/src/components/PreviewToolbar.jsx` | Notice toasts; speed, failure, reset controls and the modified marker | 1, 2 |
| `frontend/e2e/preview-controls.spec.mjs` (new) | Tests for faults, switches, reset | 2 |
| `frontend/src/lib/previewSeries.js` (new) | Pure port of the series rule, Denver time conversion, suggestion times, slot checking | 3 |
| `frontend/tests/unit/previewSeries.test.mjs` (new) | Parity vectors copied from the backend tests | 3 |
| `frontend/e2e/preview-series.spec.mjs` (new) | Recurring-session preview tests | 3 |
| `CLAUDE.md` | "Known duplication" entry and one Status sentence | 3 |

---

# PR 1 — Unsupported flows and missing mocks

Branch: `claude/preview-missing-mocks` from `origin/main`.

### Task 1: Exclusions list, missing-mock marker, notices, and the detector

**Files:**
- Create: `frontend/e2e/preview-test.mjs`
- Create: `frontend/e2e/preview-harness.spec.mjs`
- Modify: `frontend/src/lib/previewMode.js` (constants after `const CHANGE_EVENT`; top and bottom of the adapter in `installPreviewApi`)
- Modify: `frontend/src/components/PreviewToolbar.jsx`

**Interfaces:**
- Produces (test helpers, `frontend/e2e/preview-test.mjs`):
  - `test` — Playwright `test` extended with option `allowMissingMocks: boolean` (default `false`) and auto fixture `missingMocks: string[]` (entries like `GET /path`).
  - `expect` — re-exported from `@playwright/test`.
  - `usePreviewRole(page, role, clientId = 'client_sarah'): Promise<void>`
  - `callPreviewApi(page, method, path, body?): Promise<{ status: number|null, data: any }>` — calls the app's own axios instance; never throws.
- Produces (`previewMode.js`):
  - `export const PREVIEW_NOTICE_EVENT = 'cvf-preview-notice'` — `CustomEvent` with `detail: { kind: 'unsupported'|'missing', method, path, reason? }`.
  - Unsupported response body: `{ error: 'Not available in preview', code: 'preview_unsupported', reason }`, status 422.
  - Missing-mock response body: `{ error: 'Preview route not mocked: METHOD /path', code: 'preview_missing_mock' }`, status 404.

- [ ] **Step 1: Create the shared test harness**

Create `frontend/e2e/preview-test.mjs`:

```js
import { test as base, expect } from '@playwright/test';

// The preview mock answers unknown routes with a synthetic 404 that never
// touches the network, so network listeners cannot see it. The mock writes
// this marker to the console instead; this fixture fails any test that
// produced one, even when the screen caught and hid the error.
const MISSING_MOCK_MARKER = '[cvf-preview:missing-mock]';

export const test = base.extend({
  allowMissingMocks: [false, { option: true }],
  missingMocks: [async ({ context, allowMissingMocks }, use) => {
    const hits = [];
    const onConsole = (message) => {
      const text = message.text();
      if (text.startsWith(MISSING_MOCK_MARKER)) hits.push(text.slice(MISSING_MOCK_MARKER.length).trim());
    };
    context.on('console', onConsole);
    await use(hits);
    context.off('console', onConsole);
    if (!allowMissingMocks && hits.length) {
      throw new Error(`Preview routes with no mock were requested:\n${[...new Set(hits)].map((hit) => `  ${hit}`).join('\n')}\n`
        + 'Add a mock in frontend/src/lib/previewMode.js, or list the route in PREVIEW_UNSUPPORTED with a reason.');
    }
  }, { auto: true }],
});

export { expect };

export async function usePreviewRole(page, role, clientId = 'client_sarah') {
  await page.addInitScript(({ selectedRole, selectedClient }) => {
    localStorage.setItem('cvf_preview_role', selectedRole);
    localStorage.setItem('cvf_preview_client_id', selectedClient);
  }, { selectedRole: role, selectedClient: clientId });
}

// Sends a request through the app's own axios instance (the one the preview
// adapter is installed on). Resolves for failures too.
export async function callPreviewApi(page, method, path, body) {
  return page.evaluate(async ({ requestMethod, requestPath, requestBody }) => {
    const { api } = await import('/src/lib/api.js');
    try {
      const response = await api.request({ method: requestMethod, url: requestPath, data: requestBody });
      return { status: response.status, data: response.data };
    } catch (error) {
      return { status: error?.response?.status ?? null, data: error?.response?.data ?? null };
    }
  }, { requestMethod: method, requestPath: path, requestBody: body });
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/e2e/preview-harness.spec.mjs`:

```js
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const PROBE = '/__preview_missing_mock_probe__';

test('an unexpected missing mock fails an ordinary test', async ({ page }) => {
  // No opt-out here. The automatic fixture must fail this test in teardown;
  // test.fail() turns that expected failure into a pass and turns a silent
  // detector into a red suite.
  test.fail(true, 'The missing-mock fixture must fail this test.');
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await callPreviewApi(page, 'get', PROBE);
});

test.describe('with missing mocks allowed', () => {
  test.use({ allowMissingMocks: true });

  test('a missing mock is collected, answered with 404, and shown as a preview gap', async ({ page, missingMocks }) => {
    await usePreviewRole(page, 'coach');
    await page.goto('/coach');
    const result = await callPreviewApi(page, 'get', PROBE);
    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: `Preview route not mocked: GET ${PROBE}`, code: 'preview_missing_mock' });
    expect(missingMocks).toEqual([`GET ${PROBE}`]);
    await expect(page.getByText('Preview is missing a mock')).toBeVisible();
    await expect(page.getByText(`GET ${PROBE}`)).toBeVisible();
  });
});

test('a deliberately unsupported route says so and does not count as a missing mock', async ({ page, missingMocks }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  const result = await callPreviewApi(page, 'post', '/sessions/series/preview', {});
  expect(result.status).toBe(422);
  expect(result.data.error).toBe('Not available in preview');
  expect(result.data.code).toBe('preview_unsupported');
  expect(result.data.reason).toBe('Recurring sessions are not in preview yet');
  await expect(page.getByText('Not available in preview')).toBeVisible();
  expect(missingMocks).toEqual([]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx playwright test e2e/preview-harness.spec.mjs`

Expected: all three fail. Test 1 fails because it *passes* unexpectedly (`Expected to fail, but passed`) — no marker exists yet. Test 2 fails on the response body (no `code`). Test 3 fails on status (404, not 422).

If test 1 instead reports a real network request (the dev server returning HTML for `/api/__preview_missing_mock_probe__`), the dynamic import produced a second `api` instance. Stop and report; the spec's fallback is to drive a real screen whose route is on the unsupported list.

- [ ] **Step 4: Add the constants and helpers to `previewMode.js`**

Directly below `const CHANGE_EVENT = 'cvf-preview-change';` add:

```js
export const PREVIEW_NOTICE_EVENT = 'cvf-preview-notice';
// Fixed prefix read by the Playwright fixture in e2e/preview-test.mjs.
const MISSING_MOCK_MARKER = '[cvf-preview:missing-mock]';

// Routes preview deliberately does not mock. Every entry needs a reason.
// Anything not handled and not listed here is a missing mock and fails the
// preview browser suite.
const PREVIEW_UNSUPPORTED = [
  { method: 'post', pattern: /^\/sessions\/series\/preview$/, reason: 'Recurring sessions are not in preview yet' },
  { method: 'post', pattern: /^\/sessions\/series\/check$/, reason: 'Recurring sessions are not in preview yet' },
  { method: 'post', pattern: /^\/sessions\/series$/, reason: 'Recurring sessions are not in preview yet' },
  { method: 'patch', pattern: /^\/sessions\/series\/[^/]+\/cancel$/, reason: 'Recurring sessions are not in preview yet' },
];
```

Directly below the existing `function fail(config, status, message) { ... }` add:

```js
function previewNotice(detail) {
  window.dispatchEvent(new CustomEvent(PREVIEW_NOTICE_EVENT, { detail }));
}

// 422, not 5xx: retry-safe forms treat >= 500 as "outcome unknown" and lock.
function rejectUnsupported(config, method, path, entry) {
  previewNotice({ kind: 'unsupported', method, path, reason: entry.reason });
  return Promise.reject({
    response: {
      data: { error: 'Not available in preview', code: 'preview_unsupported', reason: entry.reason },
      status: 422, statusText: 'Unprocessable Entity', headers: {}, config,
    },
    config,
  });
}

function rejectMissingMock(config, method, path) {
  const label = `${method.toUpperCase()} ${path}`;
  console.error(`${MISSING_MOCK_MARKER} ${label}`);
  previewNotice({ kind: 'missing', method, path });
  return Promise.reject({
    response: {
      data: { error: `Preview route not mocked: ${label}`, code: 'preview_missing_mock' },
      status: 404, statusText: 'Error', headers: {}, config,
    },
    config,
  });
}
```

- [ ] **Step 5: Wire both into the adapter**

In `installPreviewApi`, immediately after the line `const client = currentClient();` add:

```js
    const unsupported = PREVIEW_UNSUPPORTED.find((entry) => entry.method === method && entry.pattern.test(path));
    if (unsupported) return rejectUnsupported(config, method, path, unsupported);
```

Replace the adapter's last line

```js
    return fail(config, 404, `Preview route not mocked: ${method.toUpperCase()} ${path}`);
```

with

```js
    return rejectMissingMock(config, method, path);
```

- [ ] **Step 6: Show the notices in the toolbar**

In `frontend/src/components/PreviewToolbar.jsx`, add `import { toast } from 'sonner';` below the `lucide-react` import, and add `PREVIEW_NOTICE_EVENT` to the names imported from `@/lib/previewMode`.

Below the existing `useEffect(() => onPreviewChange(...), []);` add:

```jsx
  // Fixed ids so repeated hits replace the toast instead of stacking. This
  // runs even when the calling screen swallowed the error.
  useEffect(() => {
    const onNotice = (event) => {
      const { kind, method, path, reason } = event.detail || {};
      if (kind === 'unsupported') {
        toast.info('Not available in preview', { id: 'preview-unsupported', description: reason });
      } else if (kind === 'missing') {
        toast.error('Preview is missing a mock', { id: 'preview-missing-mock', description: `${String(method).toUpperCase()} ${path}` });
      }
    };
    window.addEventListener(PREVIEW_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(PREVIEW_NOTICE_EVENT, onNotice);
  }, []);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test e2e/preview-harness.spec.mjs`

Expected: 3 passed. Test 1 is reported as passed *because it failed as expected*.

If test 1 still says `Expected to fail, but passed` while test 2 passes, a fixture-teardown error does not satisfy `test.fail()` on this Playwright version. Use this fallback and report that you did:

1. Delete test 1 from `preview-harness.spec.mjs`.
2. Create `frontend/e2e/enforcement/missing-mock.probe.mjs` (the name keeps it out of the main suite's default `*.spec.*` match):

   ```js
   import { test, usePreviewRole, callPreviewApi } from '../preview-test.mjs';

   test('probe: an unmocked route with no opt-out', async ({ page }) => {
     await usePreviewRole(page, 'coach');
     await page.goto('/coach');
     await callPreviewApi(page, 'get', '/__preview_missing_mock_probe__');
   });
   ```

3. Create `frontend/playwright.enforcement.config.mjs`:

   ```js
   import base from './playwright.config.mjs';

   export default {
     ...base,
     testIgnore: [],
     testMatch: 'enforcement/missing-mock.probe.mjs',
     retries: 0,
     reporter: 'line',
   };
   ```

4. Create `frontend/e2e/enforcement/run.mjs`:

   ```js
   import { spawnSync } from 'node:child_process';

   // The probe must FAIL: that is the proof the detector enforces.
   const run = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.enforcement.config.mjs'], { encoding: 'utf8' });
   const output = `${run.stdout}${run.stderr}`;
   if (run.status === 0) {
     console.error('Missing-mock enforcement is broken: the probe test passed.');
     process.exit(1);
   }
   if (!output.includes('GET /__preview_missing_mock_probe__')) {
     console.error(`The probe failed for another reason:\n${output}`);
     process.exit(1);
   }
   console.log('Missing-mock enforcement verified: the probe test failed as required.');
   ```

5. Add `"test:e2e:enforcement": "node e2e/enforcement/run.mjs"` to `frontend/package.json` scripts, and a step `- run: npm run test:e2e:enforcement` directly after `- run: npm run test:e2e:preview` in the `frontend` job of `.github/workflows/ci.yml`.
6. Run `npm run test:e2e:enforcement`. Expected: `Missing-mock enforcement verified: the probe test failed as required.`

- [ ] **Step 8: Commit**

```bash
git add frontend/e2e/preview-test.mjs frontend/e2e/preview-harness.spec.mjs frontend/src/lib/previewMode.js frontend/src/components/PreviewToolbar.jsx
git commit -m "feat: explicit unsupported routes and missing-mock detection in preview"
```

### Task 2: Turn the detector on for the whole suite and triage

**Files:**
- Modify: `frontend/e2e/preview-critical.spec.mjs:1`
- Modify: `frontend/src/lib/previewMode.js` (only as triage requires)

**Interfaces:**
- Consumes: `test`, `expect` from `frontend/e2e/preview-test.mjs` (Task 1).

- [ ] **Step 1: Switch the existing suite to the shared `test`**

In `frontend/e2e/preview-critical.spec.mjs`, replace line 1

```js
import { test, expect } from '@playwright/test';
```

with

```js
import { test, expect } from './preview-test.mjs';
```

Leave the file's local `usePreviewRole` in place.

- [ ] **Step 2: Run the full preview suite and record every missing mock**

Run: `npm run test:e2e:preview 2>&1 | tee /tmp/preview-triage.log; grep -h "^  [A-Z]* /" /tmp/preview-triage.log | sort | uniq -c`

Expected: either the suite is green (no triage needed — go to Step 4), or some tests fail with `Preview routes with no mock were requested:` followed by `METHOD /path` lines. The `uniq -c` output is the triage list.

- [ ] **Step 3: Resolve each route on the list**

For each `METHOD /path`, decide by reading the screen that calls it (`git grep -n "<path fragment>" frontend/src`):

- **The screen needs the data to render correctly** → add a handler in `installPreviewApi` near the related routes, returning the same shape the real route returns (read the matching file in `backend/src/routes/` for the shape; do not import it). Example of the minimal form for a list read:

  ```js
      if (path === '/example/list' && method === 'get') return ok([], config);
  ```

- **The flow cannot work without a real service** (push subscription, real email, real file storage) → add an entry to `PREVIEW_UNSUPPORTED` with a reason a coach would understand, for example:

  ```js
    { method: 'post', pattern: /^\/push\/subscribe$/, reason: 'Push notifications need a real device registration' },
  ```

Do not add a list entry merely to make a test pass; a listed route shows a toast to the owner every time a screen calls it. If a listed route is called on ordinary page load, prefer a mock.

Re-run `npm run test:e2e:preview` after each change until no test reports a missing mock. Record the final triage table (route → mocked or listed, with reason) in the PR description.

- [ ] **Step 4: Verify PR 1**

Run each and confirm:

- `npm run test:e2e:preview` → 0 failed; the three harness tests pass.
- `npm run test:unit` → all pass.
- `npm run build` → succeeds.
- From the repo root: `bash scripts/check-boundaries.sh frontend` → passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/preview-critical.spec.mjs frontend/src/lib/previewMode.js
git commit -m "test: fail the preview suite on any unexpected missing mock"
```

---

# PR 2 — Toolbar controls

Branch: `claude/preview-controls` from `origin/main` after PR 1 has merged.

### Task 3: Fault injection, switches, and reset in the mock

**Files:**
- Create: `frontend/e2e/preview-controls.spec.mjs`
- Modify: `frontend/src/lib/previewMode.js`
- Modify: `frontend/e2e/preview-test.mjs` (fixture also fails on unlisted saves)

**Interfaces:**
- Consumes: `rejectMissingMock`, `rejectUnsupported` response codes `preview_missing_mock` / `preview_unsupported` (Task 1); `test`, `expect`, `usePreviewRole`, `callPreviewApi` (Task 1).
- Produces (`previewMode.js` exports):
  - `onPreviewSwitchChange(cb: () => void): () => void` — subscribe; returns unsubscribe.
  - `getPreviewSpeed(): 'normal' | 'slow' | 'very-slow'`
  - `setPreviewSpeed(speed: 'normal' | 'slow' | 'very-slow'): void`
  - `getPreviewFailMode(): 'off' | 'write-once' | 'reads'`
  - `setPreviewFailMode(mode: 'off' | 'write-once' | 'reads'): void`
  - `resetPreview(): void` — removes preview-owned storage keys only; does not reload.
- Produces (`previewMode.js`, internal): `PREVIEW_SAVE_ROUTES: Array<[method: string, pattern: RegExp]>` — every mocked route that changes fixture data. Later tasks that add a save route must add its entry.
- Console marker: `[cvf-preview:unlisted-save] METHOD /path` — a save the handler chain served that is absent from `PREVIEW_SAVE_ROUTES`. The shared fixture fails the test on it.
- Storage: `cvf_preview_fail` holds `write-once` or `reads`; absent means off. `cvf_preview_latency` holds `[{ "path": ".*", "ms": 1500 }]` (slow) or `ms: 4000` (very slow).

**Design rule (owner review, 2026-10-01):** a simulated save failure is injected **before** the handler runs, never by running the save and undoing it. Undoing cannot retract events a handler emitted, and restoring a snapshot erases other requests' saves that completed in between. The route is therefore identified first, from `PREVIEW_SAVE_ROUTES`. Missing and unsupported routes are not in that table, so they reach the handler chain and pass through unchanged.

- [ ] **Step 1: Write the failing tests**

Create `frontend/e2e/preview-controls.spec.mjs`:

```js
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const PROBE = '/__preview_missing_mock_probe__';

function sessionBody(daysAhead = 6, hour = 14) {
  const at = new Date();
  at.setDate(at.getDate() + daysAhead);
  at.setHours(hour, 0, 0, 0);
  return { client_id: 'client_david', scheduled_at: at.toISOString(), duration_minutes: 60, location: 'CVF Studio' };
}

const setFail = (page, mode) => page.evaluate((value) => {
  if (value) localStorage.setItem('cvf_preview_fail', value);
  else localStorage.removeItem('cvf_preview_fail');
}, mode);
const getFail = (page) => page.evaluate(() => localStorage.getItem('cvf_preview_fail'));

async function openCoach(page) {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
}

test('fail next save rejects one save before it changes anything, and then clears itself', async ({ page }) => {
  await openCoach(page);
  const before = await callPreviewApi(page, 'get', '/sessions');
  await setFail(page, 'write-once');

  // Reads are untouched by "fail next save".
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(200);
  expect(await getFail(page)).toBe('write-once');

  const failed = await callPreviewApi(page, 'post', '/sessions', sessionBody());
  expect(failed.status).toBe(503);
  expect(failed.data).toEqual({ error: 'Simulated failure (preview)' });
  expect(await getFail(page)).toBeNull();
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length);

  const retry = await callPreviewApi(page, 'post', '/sessions', sessionBody());
  expect(retry.status).toBe(201);
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length + 1);
});

test('concurrent saves: exactly one fails and the others are kept', async ({ page }) => {
  await openCoach(page);
  const before = await callPreviewApi(page, 'get', '/sessions');
  await setFail(page, 'write-once');
  // Three different days so the saves cannot conflict with each other.
  const results = await Promise.all([6, 7, 8].map((day) => callPreviewApi(page, 'post', '/sessions', sessionBody(day))));
  expect(results.map((result) => result.status).sort()).toEqual([201, 201, 503]);
  expect(await getFail(page)).toBeNull();
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length + 2);
});

test('a POST that only computes a result is a read: it does not consume fail next save', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'write-once');
  const parsed = await callPreviewApi(page, 'post', '/programs/import/parse-paste', { text: 'Goblet Squat 3x8' });
  expect(parsed.status).not.toBe(503);
  expect(await getFail(page)).toBe('write-once');
});

test('fail loads rejects every read until it is turned off, and saves still work', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'reads');
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(503);
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(503);
  expect(await getFail(page)).toBe('reads');
  expect((await callPreviewApi(page, 'post', '/sessions', sessionBody(7))).status).toBe(201);
  await setFail(page, null);
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(200);
});

test('an unsupported save passes through unchanged and does not consume fail next save', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'write-once');
  const result = await callPreviewApi(page, 'post', '/sessions/series', {});
  expect(result.status).toBe(422);
  expect(result.data.code).toBe('preview_unsupported');
  expect(await getFail(page)).toBe('write-once');
});

test.describe('faults and missing mocks', () => {
  test.use({ allowMissingMocks: true });

  test('a simulated failure never hides a missing mock and is not consumed by one', async ({ page, missingMocks }) => {
    await openCoach(page);
    await setFail(page, 'reads');
    expect((await callPreviewApi(page, 'get', PROBE)).status).toBe(404);
    await setFail(page, 'write-once');
    const write = await callPreviewApi(page, 'post', PROBE, {});
    expect(write.status).toBe(404);
    expect(write.data.code).toBe('preview_missing_mock');
    expect(await getFail(page)).toBe('write-once');
    expect(missingMocks).toEqual([`GET ${PROBE}`, `POST ${PROBE}`]);
  });
});
```

(Task 6 removes the recurring-session routes from the unsupported list. It then changes the "unsupported save" test to another listed route, or deletes it if the list is empty.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test e2e/preview-controls.spec.mjs`

Expected: "fail next save", "concurrent saves" and "fail loads" fail (saves return 201 and reads return 200 — no fault code exists). The other three may already pass; that is fine.

- [ ] **Step 3: Build the save-route table from the handler chain**

List every branch that changes fixture data:

```bash
grep -n "method === 'post'\|method === 'put'\|method === 'patch'\|method === 'delete'\|method !== 'get'" src/lib/previewMode.js
```

For each line, read the branch's path condition and write one `[method, pattern]` entry. A branch testing `path === '/sessions' && method === 'post'` becomes `['post', /^\/sessions$/]`; a branch using a matcher such as `path.match(/^\/sessions\/([^/]+)\/cancel$/)` reuses that same regular expression. Leave out the three `parse-csv` / `parse-paste` / `parse-pdf` routes and anything under `/auth/` (they are reads or exempt). A branch that accepts several methods gets one entry per saving method.

Add the table below the `PREVIEW_UNSUPPORTED` list, in the same order as the chain. It starts like this — complete it for every line the grep printed:

```js
// Every mocked route that changes fixture data: [method, pattern], in the
// order the handler chain serves them. "Fail next save" consults this BEFORE
// the handler runs, so a simulated failure never changes data, never emits a
// handler's events, and never hides a missing mock. Add a route here when you
// add a save handler: a save the chain serves that is missing from this table
// logs [cvf-preview:unlisted-save], which fails the preview browser suite.
const PREVIEW_SAVE_ROUTES = [
  ['post', /^\/workout-logs\/start$/],
  ['post', /^\/sessions$/],
  ['put', /^\/sessions\/[^/]+$/],
  ['patch', /^\/sessions\/[^/]+\/complete$/],
  ['patch', /^\/sessions\/[^/]+\/cancel$/],
  ['post', /^\/sessions\/[^/]+\/notes$/],
  ['patch', /^\/bookings\/[^/]+\/(approve|decline)$/],
  ['post', /^\/programs\/[^/]+\/assign$/],
  ['post', /^\/waivers\/sign$/],
];
```

The nine entries above are confirmed against `origin/main`'s chain for their paths; verify each method against the branch as you transcribe, and add the rest. Step 7 proves the table is complete for everything the suite exercises.

- [ ] **Step 4: Add the switch helpers to `previewMode.js`**

Below `PREVIEW_SAVE_ROUTES` add:

```js
const PREVIEW_LATENCY_KEY = 'cvf_preview_latency';
const PREVIEW_FAIL_KEY = 'cvf_preview_fail';
// Not CHANGE_EVENT: AuthContext answers that one by replacing the user
// object, which would re-run user-dependent effects mid-save.
const SWITCH_EVENT = 'cvf-preview-switch-change';
const UNLISTED_SAVE_MARKER = '[cvf-preview:unlisted-save]';
const SPEED_MS = { slow: 1500, 'very-slow': 4000 };
const FAIL_MODES = ['write-once', 'reads'];
// Every key Reset removes. Anything not matched here is left alone, because a
// local dev origin is shared with real-auth sessions.
const PREVIEW_SWITCH_KEYS = [PREVIEW_LATENCY_KEY, PREVIEW_FAIL_KEY, 'cvf_preview_incomplete_analytics', 'cvf_preview_history_failure'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// POSTs that only compute a result. Without this, previewing dates would
// consume "fail next save" before anything is saved.
const READ_LIKE_POSTS = [
  /^\/sessions\/series\/preview$/,
  /^\/sessions\/series\/check$/,
  /^\/programs\/import\/parse-(csv|paste|pdf)$/,
];
```

In `previewLatencyFor`, replace the literal `'cvf_preview_latency'` with `PREVIEW_LATENCY_KEY`.

Below `export function onPreviewChange(cb) { ... }` add:

```js
function emitSwitchChange() {
  window.dispatchEvent(new CustomEvent(SWITCH_EVENT));
}

export function onPreviewSwitchChange(cb) {
  window.addEventListener(SWITCH_EVENT, cb);
  return () => window.removeEventListener(SWITCH_EVENT, cb);
}

export function getPreviewSpeed() {
  try {
    const rules = JSON.parse(localStorage.getItem(PREVIEW_LATENCY_KEY) || '[]');
    if (!Array.isArray(rules) || rules.length !== 1 || rules[0].path !== '.*') return 'normal';
    return Object.keys(SPEED_MS).find((name) => SPEED_MS[name] === rules[0].ms) || 'normal';
  } catch {
    return 'normal';
  }
}

export function setPreviewSpeed(speed) {
  try {
    if (SPEED_MS[speed]) localStorage.setItem(PREVIEW_LATENCY_KEY, JSON.stringify([{ path: '.*', ms: SPEED_MS[speed] }]));
    else localStorage.removeItem(PREVIEW_LATENCY_KEY);
  } catch { /* storage unavailable: the switch simply does not stick */ }
  emitSwitchChange();
}

export function getPreviewFailMode() {
  try {
    const mode = localStorage.getItem(PREVIEW_FAIL_KEY);
    return FAIL_MODES.includes(mode) ? mode : 'off';
  } catch {
    return 'off';
  }
}

export function setPreviewFailMode(mode) {
  try {
    if (FAIL_MODES.includes(mode)) localStorage.setItem(PREVIEW_FAIL_KEY, mode);
    else localStorage.removeItem(PREVIEW_FAIL_KEY);
  } catch { /* storage unavailable: the switch simply does not stick */ }
  emitSwitchChange();
}

function isPreviewOwnedKey(key) {
  if (PREVIEW_SWITCH_KEYS.includes(key)) return true;
  // Pending recurring saves are keyed cvf_series_pending:<user.profile.id>:<client id>.
  if (state.coaches.some((coach) => key.startsWith(`cvf_series_pending:${coach.id}:`))) return true;
  // Offline queue and rest timer for workouts the mock issued (real log ids are UUIDs).
  const log = key.match(/^cvf_(?:workout_outbox|rest_timer)_(.+)$/);
  return Boolean(log) && !UUID_RE.test(log[1]);
}

// Removes preview-owned storage only. The caller hard-loads the page, which
// rebuilds the in-memory fixtures.
export function resetPreview() {
  try {
    const owned = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isPreviewOwnedKey(key)) owned.push(key);
    }
    owned.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage unavailable: the reload still rebuilds the fixtures */ }
}
```

- [ ] **Step 5: Add the fault helpers**

Below `rejectMissingMock` add:

```js
function isPreviewRead(method, path) {
  return method === 'get' || (method === 'post' && READ_LIKE_POSTS.some((pattern) => pattern.test(path)));
}

function isKnownSave(method, path) {
  return PREVIEW_SAVE_ROUTES.some(([saveMethod, pattern]) => saveMethod === method && pattern.test(path));
}

function isPreviewGap(error) {
  const code = error?.response?.data?.code;
  return code === 'preview_missing_mock' || code === 'preview_unsupported';
}
```

- [ ] **Step 6: Wrap the existing handler**

In `installPreviewApi`, the adapter currently begins:

```js
  api.defaults.adapter = async (config) => {
    const method = String(config.method || 'get').toLowerCase();
    const { path, search } = pathFromConfig(config);
    // Test-harness latency (like cvf_preview_history_failure): browser specs
    // set cvf_preview_latency to [{ "path": "<regex>", "ms": 1500 }] to
    // reproduce slow-network races on chosen routes.
    await new Promise((resolve) => setTimeout(resolve, 80 + previewLatencyFor(path)));
    const payload = body(config);
```

Change that head to (the handler body below it is untouched):

```js
  const route = async (config) => {
    const method = String(config.method || 'get').toLowerCase();
    const { path, search } = pathFromConfig(config);
    const payload = body(config);
```

The handler currently ends:

```js
    return rejectMissingMock(config, method, path);
  };
}
```

Change that tail to:

```js
    return rejectMissingMock(config, method, path);
  };

  api.defaults.adapter = async (config) => {
    const method = String(config.method || 'get').toLowerCase();
    const { path } = pathFromConfig(config);
    // Latency: browser specs set cvf_preview_latency to
    // [{ "path": "<regex>", "ms": 1500 }] to reproduce slow-network races on
    // chosen routes; the toolbar writes one catch-all rule.
    await new Promise((resolve) => setTimeout(resolve, 80 + previewLatencyFor(path)));
    if (path.startsWith('/auth/')) return route(config);

    const read = isPreviewRead(method, path);
    const knownSave = !read && isKnownSave(method, path);
    const mode = getPreviewFailMode();

    // Fail next save: decided from the route table, BEFORE the handler runs,
    // so nothing is changed and nothing is emitted. Reading and clearing the
    // switch is synchronous, so concurrent saves cannot both consume it.
    if (mode === 'write-once' && knownSave) {
      setPreviewFailMode('off');
      return fail(config, 503, 'Simulated failure (preview)');
    }

    // Fail loads: read handlers do not change fixture data, so the handler
    // runs first purely to let a missing or unsupported route pass through.
    if (mode === 'reads' && read) {
      try {
        await route(config);
      } catch (error) {
        if (isPreviewGap(error)) throw error;
      }
      return fail(config, 503, 'Simulated failure (preview)');
    }

    if (read || knownSave) return route(config);

    // A save that is not in PREVIEW_SAVE_ROUTES: fine when it is a missing or
    // unsupported route, a bug in the table when the chain actually served it.
    const flagUnlisted = () => console.error(`${UNLISTED_SAVE_MARKER} ${method.toUpperCase()} ${path}`);
    try {
      const response = await route(config);
      flagUnlisted();
      return response;
    } catch (error) {
      if (!isPreviewGap(error)) flagUnlisted();
      throw error;
    }
  };
}
```

- [ ] **Step 7: Make the shared fixture fail on unlisted saves**

In `frontend/e2e/preview-test.mjs`, replace the `missingMocks` fixture with:

```js
  missingMocks: [async ({ context, allowMissingMocks }, use) => {
    const hits = [];
    const unlistedSaves = [];
    const onConsole = (message) => {
      const text = message.text();
      if (text.startsWith(MISSING_MOCK_MARKER)) hits.push(text.slice(MISSING_MOCK_MARKER.length).trim());
      if (text.startsWith(UNLISTED_SAVE_MARKER)) unlistedSaves.push(text.slice(UNLISTED_SAVE_MARKER.length).trim());
    };
    context.on('console', onConsole);
    await use(hits);
    context.off('console', onConsole);
    if (unlistedSaves.length) {
      throw new Error(`Preview save routes missing from PREVIEW_SAVE_ROUTES:\n${[...new Set(unlistedSaves)].map((hit) => `  ${hit}`).join('\n')}\n`
        + 'Add each one to PREVIEW_SAVE_ROUTES in frontend/src/lib/previewMode.js so "Fail next save" can apply to it.');
    }
    if (!allowMissingMocks && hits.length) {
      throw new Error(`Preview routes with no mock were requested:\n${[...new Set(hits)].map((hit) => `  ${hit}`).join('\n')}\n`
        + 'Add a mock in frontend/src/lib/previewMode.js, or list the route in PREVIEW_UNSUPPORTED with a reason.');
    }
  }, { auto: true }],
```

and add below the `MISSING_MOCK_MARKER` constant:

```js
// A save the mock served that "Fail next save" does not know about.
const UNLISTED_SAVE_MARKER = '[cvf-preview:unlisted-save]';
```

- [ ] **Step 8: Run the tests, then the full suite, and complete the table**

Run: `npx playwright test e2e/preview-controls.spec.mjs`

Expected: 6 passed.

Run: `npm run test:e2e:preview`

Expected: 0 failed. Any test failing with `Preview save routes missing from PREVIEW_SAVE_ROUTES:` names entries Step 3 missed — add them and re-run until the suite is green. The latency tests that set per-route `cvf_preview_latency` rules still pass, proving the wrapper kept that behavior.

- [ ] **Step 9: Commit**

```bash
git add frontend/e2e/preview-controls.spec.mjs frontend/e2e/preview-test.mjs frontend/src/lib/previewMode.js
git commit -m "feat: simulated failures, speed switch, and scoped reset in the preview mock"
```

### Task 4: Toolbar controls

**Files:**
- Modify: `frontend/src/components/PreviewToolbar.jsx`
- Modify: `frontend/e2e/preview-controls.spec.mjs` (append)

**Interfaces:**
- Consumes: `getPreviewSpeed`, `setPreviewSpeed`, `getPreviewFailMode`, `setPreviewFailMode`, `onPreviewSwitchChange`, `resetPreview` (Task 3).
- Produces test ids: `preview-speed-select`, `preview-fail-select`, `preview-reset-button`, `preview-modified-marker`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/e2e/preview-controls.spec.mjs`:

```js
test('toolbar switches write their storage keys and show the modified marker', async ({ page }) => {
  await openCoach(page);
  await expect(page.getByTestId('preview-modified-marker')).toHaveCount(0);

  await page.getByTestId('preview-speed-select').selectOption('slow');
  expect(await page.evaluate(() => localStorage.getItem('cvf_preview_latency'))).toBe('[{"path":".*","ms":1500}]');
  await expect(page.getByTestId('preview-modified-marker').first()).toBeAttached();

  await page.getByTestId('preview-speed-select').selectOption('normal');
  expect(await page.evaluate(() => localStorage.getItem('cvf_preview_latency'))).toBeNull();

  await page.getByTestId('preview-fail-select').selectOption('write-once');
  expect(await getFail(page)).toBe('write-once');
  await expect(page.getByTestId('preview-modified-marker').first()).toBeAttached();
});

test('fail next save shows the screen error once, returns the switch to off, and the retry succeeds', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('preview-fail-select').selectOption('write-once');
  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByText('Simulated failure (preview)')).toBeVisible();
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('off');
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(1);

  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(0);
});

test('fail loads shows the retry state, and turning it off lets Retry recover', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('preview-fail-select').selectOption('reads');
  await page.goto('/coach/clients');
  await expect(page.getByTestId('load-error-state')).toBeVisible();
  await page.getByTestId('preview-fail-select').selectOption('off');
  await page.getByTestId('load-error-retry-button').click();
  await expect(page.getByTestId('load-error-state')).toHaveCount(0);
  await expect(page.getByText('David Chen').first()).toBeVisible();
});

test('slow speed keeps the loading skeleton on screen before content', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('preview-speed-select').selectOption('slow');
  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await expect(page.getByTestId('loading-skeleton').first()).toBeVisible();
  await expect(page.getByText('David Chen').first()).toBeVisible();
});

test('Reset restores fixtures and switches and leaves everything else alone', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(0);
  await page.getByTestId('preview-speed-select').selectOption('slow');
  await page.getByTestId('preview-fail-select').selectOption('reads');
  await page.evaluate(() => {
    localStorage.setItem('cvf_access_token', 'keep-me');
    localStorage.setItem('cvf_rest_alerts', 'on');
    localStorage.setItem('unrelated_key', 'keep-me-too');
    localStorage.setItem('cvf_workout_outbox_3f2b8c1e-1111-4222-8333-444455556666', '[]');
    localStorage.setItem('cvf_series_pending:coach_marcus:client_david', '{}');
    localStorage.setItem('cvf_workout_outbox_log_abc12345', '[]');
    localStorage.setItem('cvf_rest_timer_log_abc12345', '1');
  });

  await page.getByTestId('preview-reset-button').click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(1);
  await expect(page.getByTestId('preview-speed-select')).toHaveValue('normal');
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('off');

  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(stored.cvf_preview_role).toBe('coach');
  expect(stored.cvf_preview_client_id).toBe('client_sarah');
  expect(stored.cvf_access_token).toBe('keep-me');
  expect(stored.cvf_rest_alerts).toBe('on');
  expect(stored.unrelated_key).toBe('keep-me-too');
  expect(stored['cvf_workout_outbox_3f2b8c1e-1111-4222-8333-444455556666']).toBe('[]');
  for (const removed of ['cvf_preview_latency', 'cvf_preview_fail', 'cvf_series_pending:coach_marcus:client_david', 'cvf_workout_outbox_log_abc12345', 'cvf_rest_timer_log_abc12345']) {
    expect(stored[removed], removed).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test e2e/preview-controls.spec.mjs -g "toolbar|fail next save shows|fail loads shows|slow speed|Reset"`

Expected: all five fail waiting for `preview-speed-select`, `preview-fail-select`, or `preview-reset-button`.

- [ ] **Step 3: Add state and handlers to the toolbar**

In `frontend/src/components/PreviewToolbar.jsx`, extend the import from `@/lib/previewMode` with `getPreviewFailMode`, `getPreviewSpeed`, `onPreviewSwitchChange`, `resetPreview`, `setPreviewFailMode`, `setPreviewSpeed`.

Above `export default function PreviewToolbar()` add:

```jsx
const CONTROL = 'h-11 rounded-lg border border-border bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-8';
```

Inside the component, below `const clients = useMemo(() => getPreviewClients(), []);` add:

```jsx
  const [speed, setSpeed] = useState(getPreviewSpeed());
  const [failMode, setFailMode] = useState(getPreviewFailMode());
  // A switch left on from an earlier visit is the main way this layer could
  // mislead, so its state is visible without opening the panel.
  const modified = speed !== 'normal' || failMode !== 'off';
```

Below the notice `useEffect` added in Task 1 add:

```jsx
  useEffect(() => onPreviewSwitchChange(() => {
    setSpeed(getPreviewSpeed());
    setFailMode(getPreviewFailMode());
  }), []);
```

Below `toggleIncompleteAnalytics` add:

```jsx
  const reset = () => {
    resetPreview();
    // Hard load: fixtures live in memory and rebuild on load.
    window.location.assign(role === 'client' ? '/client' : role === 'admin' ? '/admin' : '/coach');
  };
```

- [ ] **Step 4: Render the controls and the marker**

Change the mobile toggle button's `className` to start with `relative ` (i.e. `'relative flex h-11 w-11 items-center ...'`), and inside that button, after the icon expression, add:

```jsx
        {modified && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden data-testid="preview-modified-marker" />}
```

Replace the `Preview Mode` label span's text with:

```jsx
            Preview Mode{modified && <span data-testid="preview-modified-marker"> · modified</span>}
```

Directly after the closing `)}` of the `{role !== 'client' && (<label ... Incomplete analytics ...)}` block, add:

```jsx
          <select
            value={speed}
            onChange={(e) => setPreviewSpeed(e.target.value)}
            aria-label="Preview network speed"
            className={CONTROL}
            data-testid="preview-speed-select"
          >
            <option value="normal">Speed: normal</option>
            <option value="slow">Speed: slow (1.5s)</option>
            <option value="very-slow">Speed: very slow (4s)</option>
          </select>
          <select
            value={failMode}
            onChange={(e) => setPreviewFailMode(e.target.value)}
            aria-label="Preview simulated failures"
            className={CONTROL}
            data-testid="preview-fail-select"
          >
            <option value="off">Failures: off</option>
            <option value="write-once">Fail next save</option>
            <option value="reads">Fail loads</option>
          </select>
          <button
            type="button"
            onClick={reset}
            className={`${CONTROL} font-medium text-muted-foreground transition-colors hover:text-foreground`}
            data-testid="preview-reset-button"
          >
            Reset
          </button>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test e2e/preview-controls.spec.mjs`

Expected: 11 passed.

If "fail next save shows the screen error" fails because the dashboard shows its own fallback text instead of the server message, read the approve handler in `frontend/src/pages/coach/Dashboard.jsx` and assert the text it actually shows; keep the other assertions.

- [ ] **Step 6: Check the toolbar at phone width**

Run: `npm run dev:preview`, open `http://localhost:5173/coach` (use the port Vite prints) at 390 px width, open the preview controls, and confirm: all three new controls are reachable, the panel does not scroll the page horizontally, and the marker dot appears on the collapsed toggle after selecting "Fail loads". Take one screenshot for the PR. Stop the dev server.

- [ ] **Step 7: Verify PR 2**

- `npm run test:e2e:preview` → 0 failed.
- `npm run test:unit` → all pass.
- `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/PreviewToolbar.jsx frontend/e2e/preview-controls.spec.mjs
git commit -m "feat: reset, speed, and failure controls in the preview toolbar"
```

---

# PR 3 — Recurring sessions in preview

Branch: `claude/preview-recurring-sessions` from `origin/main` after PR 2 has merged.

### Task 5: `previewSeries.js` — pure series logic

**Files:**
- Create: `frontend/src/lib/previewSeries.js`
- Create: `frontend/tests/unit/previewSeries.test.mjs`

**Interfaces:**
- Produces (`previewSeries.js`, all pure, relative imports only):
  - `MAX_SLOTS = 52`
  - `shiftDate(dateStr: string, days: number): string`
  - `todayInDenver(now?: Date): string` — `YYYY-MM-DD`
  - `denverWallClockToUtc(dateStr: string, timeStr: string): string | null` — UTC ISO string
  - `formatDenverDisplay(instant: string | Date): string` — e.g. `Tue, Oct 6, 5:00 PM`
  - `parseRule(raw, { today }): { ok: true, value } | { ok: false, error: string }`
  - `expandSeriesRule(rule): { slots: [{ key, date, time }], exceededMax: boolean, exceededHorizon: boolean }`
  - `slotHorizonError(slots, startDate, today): string | null`
  - `pastError(slots, nowMs): string | null` — `slots` carry `scheduled_at`
  - `candidateTimes({ date, time }): [{ date, time }]`
  - `checkSlots({ slots, durationMinutes, findExisting, nowMs = Date.now() }): [{ key, date, time, scheduled_at, display, conflict, suggestions }]` where suggestions never start at or before `nowMs`, `findExisting(scheduledAtIso): { scope: 'coach'|'client', session } | null`, `conflict` is `null`, `{ scope, session: { id, scheduled_at, duration_minutes }, display }`, or `{ scope: 'batch', with_key, display: null }`, and each suggestion is `{ date, time, scheduled_at, display }`.

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/tests/unit/previewSeries.test.mjs`. The expansion and candidate vectors are copied from `backend/test/session-series-rule.test.js` and `backend/test/session-series-alternatives.test.js`; keep them identical to the backend's.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SLOTS, parseRule, expandSeriesRule, slotHorizonError, pastError, candidateTimes,
  denverWallClockToUtc, formatDenverDisplay, checkSlots, shiftDate,
} from '../../src/lib/previewSeries.js';

const TODAY = '2026-09-30';
const base = (overrides = {}) => ({
  start_date: '2026-10-06', time: '17:00', duration_minutes: 60,
  weekdays: [2, 4], interval_weeks: 1, end: { count: 6 }, ...overrides,
});
const dates = (rule) => expandSeriesRule(parseRule(rule, { today: TODAY }).value).slots.map((slot) => slot.date);
// Newer ICU versions put a narrow no-break space before AM/PM; compare on plain spaces.
const plain = (text) => text.replace(/\s/g, ' ');

test('Tue/Thu weekly, count 6 starting on a Tuesday', () => {
  assert.deepEqual(dates(base()), ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22']);
});

test('keys are stable and ordered g1..gN', () => {
  const { slots } = expandSeriesRule(parseRule(base(), { today: TODAY }).value);
  assert.deepEqual(slots.map((slot) => slot.key), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
  assert.ok(slots.every((slot) => slot.time === '17:00'));
});

test('every 2 weeks takes every second Monday-start week', () => {
  assert.deepEqual(dates(base({ weekdays: [2], interval_weeks: 2, end: { count: 4 } })),
    ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
});

test('weekdays earlier than start_date in its first week are skipped', () => {
  assert.deepEqual(dates(base({ start_date: '2026-10-07', end: { count: 4 } })),
    ['2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20']);
});

test('Sunday sorts last within a Monday-start week', () => {
  assert.deepEqual(dates(base({ start_date: '2026-10-05', weekdays: [0, 1], end: { count: 4 } })),
    ['2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18']);
});

test('until end is inclusive', () => {
  assert.deepEqual(dates(base({ weekdays: [2], end: { until: '2026-10-20' } })), ['2026-10-06', '2026-10-13', '2026-10-20']);
});

test('52 weekly sessions fit the one-year horizon; 53 are rejected', () => {
  const ok = expandSeriesRule(parseRule(base({ weekdays: [2], end: { count: 52 } }), { today: TODAY }).value);
  assert.equal(ok.slots.length, 52);
  assert.equal(ok.exceededMax, false);
  assert.equal(ok.exceededHorizon, false);
  const tooMany = parseRule(base({ end: { count: 53 } }), { today: TODAY });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error, 'A series has between 1 and 52 sessions');
});

test('count-based every-2-weeks that runs past the horizon is flagged', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [2], interval_weeks: 2, end: { count: 30 } }), { today: TODAY }).value);
  assert.equal(result.exceededHorizon, true);
  assert.ok(result.slots.length < 30);
});

test('until-based rules that would exceed 52 sessions are flagged as exceededMax', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [1, 2, 3, 4, 5], end: { until: '2027-10-06' } }), { today: TODAY }).value);
  assert.equal(result.exceededMax, true);
  assert.equal(result.slots.length, MAX_SLOTS + 1);
});

test('parseRule rejects a start in the past and normalizes weekdays Monday-first', () => {
  assert.equal(parseRule(base({ start_date: '2026-09-29' }), { today: TODAY }).error, 'A series cannot start in the past');
  assert.deepEqual(parseRule(base({ weekdays: [0, 4, 2] }), { today: TODAY }).value.weekdays, [2, 4, 0]);
});

test('slot horizon and past messages match the server', () => {
  assert.equal(slotHorizonError([{ date: '2026-09-29' }], '2026-10-06', TODAY), 'Sessions cannot be in the past');
  assert.equal(slotHorizonError([{ date: '2027-10-07' }], '2026-10-06', TODAY), 'Sessions must be within one year of the start date');
  assert.equal(slotHorizonError([{ date: '2027-10-06' }], '2026-10-06', TODAY), null);
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  assert.equal(pastError([{ scheduled_at: '2026-10-06T11:00:00.000Z' }], now), 'Sessions cannot be in the past');
  assert.equal(pastError([{ scheduled_at: '2026-10-06T13:00:00.000Z' }], now), null);
});

test('candidates alternate +15/-15 outward, same date, excluding the requested time', () => {
  const out = candidateTimes({ date: '2026-10-06', time: '12:00' });
  assert.equal(out.length, 24);
  assert.deepEqual(out.slice(0, 4).map((c) => c.time), ['12:15', '11:45', '12:30', '11:30']);
  assert.ok(out.every((c) => c.date === '2026-10-06'));
  assert.ok(!out.some((c) => c.time === '12:00'));
});

test('candidates are clamped to the allowed start times 05:00-20:45', () => {
  const early = candidateTimes({ date: '2026-10-06', time: '05:15' });
  assert.ok(early.every((c) => c.time >= '05:00' && c.time <= '20:45'));
  assert.ok(early.some((c) => c.time === '05:00'));
  const late = candidateTimes({ date: '2026-10-06', time: '20:30' });
  assert.ok(late.every((c) => c.time <= '20:45'));
  assert.ok(late.some((c) => c.time === '20:45'));
});

test('Denver wall clock converts to UTC in both daylight and standard time', () => {
  assert.equal(denverWallClockToUtc('2026-10-06', '17:00'), '2026-10-06T23:00:00.000Z'); // MDT, UTC-6
  assert.equal(denverWallClockToUtc('2026-12-01', '17:00'), '2026-12-02T00:00:00.000Z'); // MST, UTC-7
  assert.equal(denverWallClockToUtc('2026-02-30', '17:00'), null);
  assert.equal(plain(formatDenverDisplay('2026-10-06T23:00:00.000Z')), 'Tue, Oct 6, 5:00 PM');
  assert.equal(shiftDate('2026-10-06', 7), '2026-10-13');
});

// checkSlots drops suggestions at or before nowMs; pin the clock for the fixed-date cases.
const EARLIER = Date.parse('2026-09-30T12:00:00.000Z');

test('checkSlots reports existing conflicts with the three nearest free suggestions', () => {
  const blockedStart = Date.parse(denverWallClockToUtc('2026-10-06', '09:00'));
  const findExisting = (scheduledAt) => {
    const start = Date.parse(scheduledAt);
    const overlaps = blockedStart < start + 3600000 && start < blockedStart + 3600000;
    return overlaps ? { scope: 'coach', session: { id: 'busy', scheduled_at: new Date(blockedStart).toISOString(), duration_minutes: 60 } } : null;
  };
  const [row] = checkSlots({ slots: [{ key: 'g1', date: '2026-10-06', time: '09:00' }], durationMinutes: 60, findExisting, nowMs: EARLIER });
  assert.equal(row.conflict.scope, 'coach');
  assert.equal(row.conflict.session.id, 'busy');
  assert.equal(plain(row.conflict.display), 'Tue, Oct 6, 9:00 AM');
  assert.deepEqual(row.suggestions.map((s) => s.time), ['10:00', '08:00', '10:15']);
  assert.equal(plain(row.suggestions[0].display), 'Tue, Oct 6, 10:00 AM');
});

test('checkSlots flags both rows of a batch conflict and leaves free rows clean', () => {
  const rows = checkSlots({
    slots: [
      { key: 'g1', date: '2026-10-06', time: '09:00' },
      { key: 'g2', date: '2026-10-06', time: '09:30' },
      { key: 'g3', date: '2026-10-13', time: '09:00' },
    ],
    durationMinutes: 60,
    findExisting: () => null,
    nowMs: EARLIER,
  });
  assert.deepEqual(rows[0].conflict, { scope: 'batch', with_key: 'g2', display: null });
  assert.deepEqual(rows[1].conflict, { scope: 'batch', with_key: 'g1', display: null });
  assert.equal(rows[2].conflict, null);
  assert.deepEqual(rows[2].suggestions, []);
  assert.equal(rows[2].scheduled_at, denverWallClockToUtc('2026-10-13', '09:00'));
});

test('checkSlots never suggests a time that has already passed', () => {
  const blockedStart = Date.parse(denverWallClockToUtc('2026-10-06', '09:00'));
  const findExisting = (scheduledAt) => {
    const start = Date.parse(scheduledAt);
    return blockedStart < start + 3600000 && start < blockedStart + 3600000
      ? { scope: 'coach', session: { id: 'busy', scheduled_at: new Date(blockedStart).toISOString(), duration_minutes: 60 } } : null;
  };
  // It is 08:30 Denver on the day: 08:00 is free on the calendar but already gone.
  const nowMs = Date.parse(denverWallClockToUtc('2026-10-06', '08:30'));
  const [row] = checkSlots({ slots: [{ key: 'g1', date: '2026-10-06', time: '09:00' }], durationMinutes: 60, findExisting, nowMs });
  assert.deepEqual(row.suggestions.map((s) => s.time), ['10:00', '10:15', '10:30']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/unit/previewSeries.test.mjs`

Expected: FAIL — `Cannot find module '.../src/lib/previewSeries.js'`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/previewSeries.js`:

```js
// Preview-mode port of the recurring-session rule, Denver time conversion,
// and suggestion times. Sources of truth (do not import them — the frontend
// and backend deploy separately):
//   backend/src/lib/sessionSeries/rule.js
//   backend/src/lib/sessionSeries/alternatives.js
//   backend/src/utils/time.js
// tests/unit/previewSeries.test.mjs holds the backend's test vectors; a
// backend rule change must update this file and those vectors together.

const TZ = 'America/Denver';
export const MAX_SLOTS = 52;
const HORIZON_DAYS = 365;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const STEP_MINUTES = 15;
const WINDOW_MINUTES = 180;
const FIRST_START = 5 * 60; // 05:00 — the DateTimePicker's first allowed start time
const LAST_START = 20 * 60 + 45; // 20:45 — and its last
const MAX_SUGGESTIONS_PER_ROW = 3;

const invalid = (error) => ({ ok: false, error });
const valid = (value) => ({ ok: true, value });
const pad = (n) => String(n).padStart(2, '0');

export function shiftDate(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

export function todayInDenver(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function tzOffsetMinutes(instantMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(instantMs));
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (parseInt(match[2], 10) * 60 + parseInt(match[3] || '0', 10));
}

// Spring-forward gap resolves forward; fall-back ambiguity picks the first occurrence.
export function denverWallClockToUtc(dateStr, timeStr) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  const d = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = timeStr.match(TIME_RE);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const naive = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  const check = new Date(naive);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const offsetBefore = tzOffsetMinutes(naive - 86400000);
  const offsetAfter = tzOffsetMinutes(naive + 86400000);
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * 60000)
    .filter((utc) => naive - utc === tzOffsetMinutes(utc) * 60000);
  const instant = candidates.length ? Math.min(...candidates) : naive - offsetBefore * 60000;
  return new Date(instant).toISOString();
}

export function formatDenverDisplay(instant) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(instant instanceof Date ? instant : new Date(instant));
}

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isTime = (value) => typeof value === 'string' && TIME_RE.test(value);
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
const mondayOf = (dateStr) => shiftDate(dateStr, -((weekdayOf(dateStr) + 6) % 7));
const horizonBounds = (startDate, today) => ({ min: today, max: shiftDate(startDate, HORIZON_DAYS) });

export function parseRule(raw, { today }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Repeat settings are required');
  if (!isRealDate(raw.start_date)) return invalid('Start date must be a valid date');
  if (raw.start_date < today) return invalid('A series cannot start in the past');
  if (!isTime(raw.time)) return invalid('Time must be HH:mm');
  if (!Number.isInteger(raw.duration_minutes) || raw.duration_minutes < 15 || raw.duration_minutes > 240) {
    return invalid('Duration must be a whole number between 15 and 240 minutes');
  }
  if (!Array.isArray(raw.weekdays) || !raw.weekdays.length || raw.weekdays.length > 7
    || !raw.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    || new Set(raw.weekdays).size !== raw.weekdays.length) {
    return invalid('Choose one or more weekdays');
  }
  if (raw.interval_weeks !== 1 && raw.interval_weeks !== 2) return invalid('Repeat every 1 or 2 weeks');
  const end = raw.end;
  if (!end || typeof end !== 'object' || Array.isArray(end)) return invalid('Choose how the series ends');
  const hasCount = Object.hasOwn(end, 'count');
  const hasUntil = Object.hasOwn(end, 'until');
  if (hasCount === hasUntil) return invalid('End after a number of sessions or on a date, not both');
  const bounds = horizonBounds(raw.start_date, today);
  let normalizedEnd;
  if (hasCount) {
    if (!Number.isInteger(end.count) || end.count < 1 || end.count > MAX_SLOTS) {
      return invalid(`A series has between 1 and ${MAX_SLOTS} sessions`);
    }
    normalizedEnd = { count: end.count };
  } else {
    if (!isRealDate(end.until)) return invalid('End date must be a valid date');
    if (end.until < raw.start_date) return invalid('End date cannot be before the start date');
    if (end.until > bounds.max) return invalid('A series can run at most one year from its start date');
    normalizedEnd = { until: end.until };
  }
  let location = null;
  if (raw.location !== undefined && raw.location !== null && raw.location !== '') {
    if (typeof raw.location !== 'string') return invalid('Location must be text');
    location = raw.location.trim() || null;
  }
  const weekdays = MONDAY_FIRST.filter((day) => raw.weekdays.includes(day));
  return valid({
    start_date: raw.start_date, time: raw.time, duration_minutes: raw.duration_minutes,
    weekdays, interval_weeks: raw.interval_weeks, end: normalizedEnd, location,
  });
}

// Returns at most MAX_SLOTS + 1 slots (the extra one signals exceededMax).
export function expandSeriesRule(rule) {
  const bounds = horizonBounds(rule.start_date, rule.start_date);
  const slots = [];
  let exceededHorizon = false;
  let exceededMax = false;
  const firstMonday = mondayOf(rule.start_date);
  const wantCount = Object.hasOwn(rule.end, 'count') ? rule.end.count : Infinity;
  const until = Object.hasOwn(rule.end, 'until') ? rule.end.until : null;
  const finish = () => ({ slots, exceededMax, exceededHorizon });

  for (let week = 0; week < 120 && !exceededMax; week += rule.interval_weeks) {
    for (const weekday of rule.weekdays) {
      const date = shiftDate(firstMonday, week * 7 + ((weekday + 6) % 7));
      if (date < rule.start_date) continue;
      if (until && date > until) return finish();
      if (slots.length >= wantCount) return finish();
      if (date > bounds.max) { exceededHorizon = true; return finish(); }
      slots.push({ key: `g${slots.length + 1}`, date, time: rule.time });
      if (slots.length > MAX_SLOTS) { exceededMax = true; break; }
    }
  }
  return finish();
}

export function slotHorizonError(slots, startDate, today) {
  const bounds = horizonBounds(startDate, today);
  for (const slot of slots) {
    if (slot.date < bounds.min) return 'Sessions cannot be in the past';
    if (slot.date > bounds.max) return 'Sessions must be within one year of the start date';
  }
  return null;
}

export function pastError(slots, nowMs) {
  return slots.some((slot) => !slot.scheduled_at || new Date(slot.scheduled_at).getTime() <= nowMs)
    ? 'Sessions cannot be in the past' : null;
}

// Same-day alternatives around the requested time, nearest first: +15, -15, +30, -30, ...
export function candidateTimes({ date, time }) {
  const [hour, minute] = time.split(':').map(Number);
  const base = hour * 60 + minute;
  const out = [];
  for (let delta = STEP_MINUTES; delta <= WINDOW_MINUTES; delta += STEP_MINUTES) {
    for (const sign of [1, -1]) {
      const candidate = base + sign * delta;
      if (candidate < FIRST_START || candidate > LAST_START) continue;
      out.push({ date, time: `${pad(Math.floor(candidate / 60))}:${pad(candidate % 60)}` });
    }
  }
  return out;
}

// findExisting(scheduledAtIso) -> { scope, session } | null for sessions already on the calendar.
// Suggestions are never in the past: the server refuses those at save time.
export function checkSlots({ slots, durationMinutes, findExisting, nowMs = Date.now() }) {
  const span = Number(durationMinutes) * 60000;
  const timed = slots.map((slot) => ({ ...slot, scheduled_at: denverWallClockToUtc(slot.date, slot.time) }));
  const startOf = (row) => new Date(row.scheduled_at).getTime();
  const batchHit = (key, scheduledAt) => {
    const start = new Date(scheduledAt).getTime();
    return timed.find((other) => other.key !== key && startOf(other) < start + span && start < startOf(other) + span) || null;
  };
  return timed.map((slot) => {
    let conflict = null;
    const existing = findExisting(slot.scheduled_at);
    if (existing) {
      conflict = {
        scope: existing.scope,
        session: { id: existing.session.id, scheduled_at: existing.session.scheduled_at, duration_minutes: existing.session.duration_minutes },
        display: formatDenverDisplay(existing.session.scheduled_at),
      };
    } else {
      const other = batchHit(slot.key, slot.scheduled_at);
      if (other) conflict = { scope: 'batch', with_key: other.key, display: null };
    }
    const suggestions = conflict
      ? candidateTimes(slot)
        .map((candidate) => ({ ...candidate, scheduled_at: denverWallClockToUtc(candidate.date, candidate.time) }))
        .filter((candidate) => new Date(candidate.scheduled_at).getTime() > nowMs)
        .filter((candidate) => !findExisting(candidate.scheduled_at) && !batchHit(slot.key, candidate.scheduled_at))
        .slice(0, MAX_SUGGESTIONS_PER_ROW)
        .map((candidate) => ({ ...candidate, display: formatDenverDisplay(candidate.scheduled_at) }))
      : [];
    return {
      key: slot.key, date: slot.date, time: slot.time, scheduled_at: slot.scheduled_at,
      display: formatDenverDisplay(slot.scheduled_at), conflict, suggestions,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/previewSeries.test.mjs`

Expected: 17 passed.

- [ ] **Step 5: Run the whole unit suite and commit**

Run: `npm run test:unit` → all pass.

```bash
git add frontend/src/lib/previewSeries.js frontend/tests/unit/previewSeries.test.mjs
git commit -m "feat: preview-side port of the recurring-session rule and suggestion times"
```

### Task 6: Series routes, series fields on reads, and reload reset

**Files:**
- Create: `frontend/e2e/preview-series.spec.mjs`
- Modify: `frontend/src/lib/previewMode.js`
- Modify: `frontend/e2e/preview-harness.spec.mjs`, `frontend/e2e/preview-controls.spec.mjs` (their unsupported-route examples)

**Interfaces:**
- Consumes: `PREVIEW_SAVE_ROUTES` (Task 3); everything exported by `previewSeries.js` (Task 5); `previewScheduleConflict({ sessionId, clientId, coachId, scheduledAt, durationMinutes })` (existing); `callPreviewApi`, `usePreviewRole` (Task 1).
- Produces (`previewMode.js`, internal):
  - `state.sessionSeries: [{ id, request_id, request_fingerprint, client_id, coach_id, rule, created_count, receipt: { slots }, created_at }]`
  - `previewSeriesRows(target, slots, durationMinutes)` → `checkSlots` result
  - `withSeries(row)` → row plus `series: { id, rule, created_count }` when `row.series_id` is set
  - `previewAssignProgramClone(programId, clientId)` — defined as a no-op returning `null` here, implemented in Task 7
  - Session rows gain `series_id` and `series_ordinal`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/e2e/preview-series.spec.mjs`:

```js
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const pad = (n) => String(n).padStart(2, '0');
const dayIso = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00`).getDay();
const plusDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const START = dayIso(10);
const ruleFor = (start = START, overrides = {}) => ({
  start_date: start, time: '09:00', weekdays: [weekdayOf(start)], interval_weeks: 1, end: { count: 3 }, ...overrides,
});
const previewBody = (clientId, start = START, overrides = {}) => ({
  client_id: clientId, duration_minutes: 60, location: 'CVF Studio', ...ruleFor(start, overrides),
});
const threeSlots = (start = START) => [0, 7, 14].map((offset, index) => ({ key: `g${index + 1}`, date: plusDays(start, offset), time: '09:00' }));
const createBody = (clientId, requestId, overrides = {}) => ({
  request_id: requestId, client_id: clientId, duration_minutes: 60, location: 'CVF Studio', rule: ruleFor(),
  slots: threeSlots().map((slot) => ({ ...slot, workout_id: null })),
  program_id: null, assign_program: false, notify: true, ...overrides,
});

async function openCoach(page) {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/sessions');
  await expect(page.getByTestId('session-create-button')).toBeVisible();
}

test('preview expands the rule into weekly Denver-time slots with no conflicts', async ({ page }) => {
  await openCoach(page);
  const { status, data } = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david'));
  expect(status).toBe(200);
  expect(data.slots.map((slot) => slot.key)).toEqual(['g1', 'g2', 'g3']);
  expect(data.slots.map((slot) => slot.date)).toEqual([START, plusDays(START, 7), plusDays(START, 14)]);
  expect(data.slots.every((slot) => slot.time === '09:00' && slot.conflict === null && slot.suggestions.length === 0)).toBe(true);
  expect(data.slots[0].display).toMatch(/9:00\sAM$/); // \s: newer ICU uses a narrow no-break space
});

test('preview mirrors the server validation messages', async ({ page }) => {
  await openCoach(page);
  const tooMany = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david', START, { end: { count: 53 } }));
  expect(tooMany.status).toBe(400);
  expect(tooMany.data.error).toBe('A series has between 1 and 52 sessions');
  const past = await callPreviewApi(page, 'post', '/sessions/series/preview', previewBody('client_david', dayIso(-3)));
  expect(past.status).toBe(400);
  expect(past.data.error).toBe('A series cannot start in the past');
});

test('create saves the series, replays the same request, and rejects a changed one', async ({ page }) => {
  await openCoach(page);
  const body = createBody('client_david', '11111111-1111-4111-8111-111111111111');
  const created = await callPreviewApi(page, 'post', '/sessions/series', body);
  expect(created.status).toBe(201);
  expect(created.data.replayed).toBe(false);
  expect(created.data.receipt.slots.map((slot) => [slot.key, slot.ordinal])).toEqual([['g1', 1], ['g2', 2], ['g3', 3]]);
  expect(created.data.series.created_count).toBe(3);

  const replay = await callPreviewApi(page, 'post', '/sessions/series', body);
  expect(replay.status).toBe(200);
  expect(replay.data.replayed).toBe(true);
  expect(replay.data.series.id).toBe(created.data.series.id);

  const changed = await callPreviewApi(page, 'post', '/sessions/series', { ...body, location: 'Somewhere else' });
  expect(changed.status).toBe(409);
  expect(changed.data.code).toBe('request_mismatch');

  const sessions = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id === created.data.series.id);
  expect(sessions).toHaveLength(3);
  expect(sessions.map((row) => row.series_ordinal)).toEqual([1, 2, 3]);
  expect(sessions[0].series).toEqual({ id: created.data.series.id, rule: body.rule, created_count: 3 });
  const detail = await callPreviewApi(page, 'get', `/sessions/${sessions[0].id}/coach-detail`);
  expect(detail.data.series.created_count).toBe(3);
  expect(detail.data.series_ordinal).toBe(1);
});

test('a second client at the same coach times conflicts, with the nearest free suggestions, and nothing is saved', async ({ page }) => {
  await openCoach(page);
  await callPreviewApi(page, 'post', '/sessions/series', createBody('client_david', '22222222-2222-4222-8222-222222222222'));
  const before = (await callPreviewApi(page, 'get', '/sessions')).data.length;

  const check = await callPreviewApi(page, 'post', '/sessions/series/check', {
    client_id: 'client_sarah', duration_minutes: 60, start_date: START, seq: 7, slots: threeSlots(),
  });
  expect(check.status).toBe(200);
  expect(check.data.seq).toBe(7);
  expect(check.data.slots.map((slot) => slot.conflict.scope)).toEqual(['coach', 'coach', 'coach']);
  expect(check.data.slots[1].suggestions.map((s) => s.time)).toEqual(['10:00', '08:00', '10:15']);

  const refused = await callPreviewApi(page, 'post', '/sessions/series', createBody('client_sarah', '33333333-3333-4333-8333-333333333333'));
  expect(refused.status).toBe(409);
  expect(refused.data.error).toBe('Some dates are no longer available');
  expect(refused.data.conflicts.map((conflict) => [conflict.key, conflict.scope])).toEqual([['g1', 'coach'], ['g2', 'coach'], ['g3', 'coach']]);
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before);
});

test('two rows of one request that overlap are both flagged as a batch conflict', async ({ page }) => {
  await openCoach(page);
  const check = await callPreviewApi(page, 'post', '/sessions/series/check', {
    client_id: 'client_david', duration_minutes: 60, start_date: START, seq: 1,
    slots: [{ key: 'g1', date: START, time: '09:00' }, { key: 'g2', date: START, time: '09:30' }],
  });
  expect(check.data.slots.map((slot) => slot.conflict)).toEqual([
    { scope: 'batch', with_key: 'g2', display: null },
    { scope: 'batch', with_key: 'g1', display: null },
  ]);
});

test('cancel "this and all future" cancels from the anchor on and is safe to repeat', async ({ page }) => {
  await openCoach(page);
  const created = await callPreviewApi(page, 'post', '/sessions/series', createBody('client_david', '44444444-4444-4444-8444-444444444444'));
  const seriesId = created.data.series.id;
  const anchor = created.data.receipt.slots[1].session_id;

  const cancelled = await callPreviewApi(page, 'patch', `/sessions/series/${seriesId}/cancel`, { from_session_id: anchor, notify: false });
  expect(cancelled.status).toBe(200);
  expect(cancelled.data.cancelled).toHaveLength(2);
  const rows = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id === seriesId);
  expect(rows.map((row) => row.status)).toEqual(['scheduled', 'cancelled', 'cancelled']);

  const again = await callPreviewApi(page, 'patch', `/sessions/series/${seriesId}/cancel`, { from_session_id: anchor, notify: false });
  expect(again.data.cancelled).toEqual([]);
  const wrong = await callPreviewApi(page, 'patch', '/sessions/series/no_such_series/cancel', { from_session_id: anchor, notify: false });
  expect(wrong.status).toBe(404);
  expect(wrong.data.error).toBe('Series not found');
});

test('a reload clears a pending recurring save left by a preview coach', async ({ page }) => {
  await openCoach(page);
  await page.evaluate(() => {
    localStorage.setItem('cvf_series_pending:coach_marcus:client_david', JSON.stringify({ request_id: 'r', body: {}, state: 'pending' }));
    localStorage.setItem('cvf_series_pending:3f2b8c1e-1111-4222-8333-444455556666:client_x', '{}');
  });
  await page.reload();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_series_pending')));
  expect(keys).toEqual(['cvf_series_pending:3f2b8c1e-1111-4222-8333-444455556666:client_x']);
  await expect(page.getByTestId('series-unknown')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test e2e/preview-series.spec.mjs`

Expected: the first six fail with status 422 (`Not available in preview`); the reload test fails because the `coach_marcus` key survives.

- [ ] **Step 3: Import the module and remove the exclusions**

In `frontend/src/lib/previewMode.js`, below `import { normalizeSupersets } from '@/lib/supersets';` add:

```js
import {
  checkSlots, expandSeriesRule, parseRule, pastError, slotHorizonError, todayInDenver,
} from './previewSeries.js';
```

Add the two series saves to `PREVIEW_SAVE_ROUTES`, next to the other `/sessions` entries (preview and check are read-like and stay out):

```js
  ['post', /^\/sessions\/series$/],
  ['patch', /^\/sessions\/series\/[^/]+\/cancel$/],
```

Delete the four `sessions/series` entries from `PREVIEW_UNSUPPORTED`, leaving any entries Task 2's triage added. If the list is now empty, keep the declaration and its comment as `const PREVIEW_UNSUPPORTED = [];`.

In `frontend/e2e/preview-harness.spec.mjs`, the third test used `/sessions/series/preview` as its unsupported example. If `PREVIEW_UNSUPPORTED` still has an entry, change that test's method, path, and expected `reason` to one of them. If the list is empty, replace that test with:

```js
test('the unsupported list is empty: every preview route is either mocked or a missing mock', async ({ page, missingMocks }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  expect(missingMocks).toEqual([]);
});
```

In `frontend/e2e/preview-controls.spec.mjs`, the test `an unsupported save passes through unchanged and does not consume fail next save` used `POST /sessions/series`. If `PREVIEW_UNSUPPORTED` still lists a save route, point the test at it; if it lists none, delete that test (the missing-mock case beside it still proves pass-through).

- [ ] **Step 4: Add the series state and helpers**

In the `state` object, add a new property directly after the closing `],` of `sessions: [ ... ]`:

```js
  sessionSeries: [],
```

Below `function previewCancelRequested(sessionId) { ... }` add:

```js
// Conflict-checks slots the way check_session_slots does for the UI: sessions
// already on the calendar (coach before client), then rows of the same request.
function previewSeriesRows(target, slots, durationMinutes) {
  return checkSlots({
    slots,
    durationMinutes,
    findExisting: (scheduledAt) => previewScheduleConflict({
      clientId: target.id, coachId: target.coach_id, scheduledAt, durationMinutes,
    }),
  });
}

function withSeries(row) {
  const series = row.series_id ? state.sessionSeries.find((item) => item.id === row.series_id) : null;
  return series ? { ...row, series: { id: series.id, rule: series.rule, created_count: series.created_count } } : row;
}

// Implemented in the next task: mirrors assign_program_clone.
function previewAssignProgramClone() {
  return null;
}

// Fixtures rebuild on every load, so a pending recurring save from an earlier
// load refers to a demo that no longer exists. Clear it before the app renders.
function clearPreviewPendingSeries() {
  try {
    const stale = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && state.coaches.some((coach) => key.startsWith(`cvf_series_pending:${coach.id}:`))) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage unavailable: nothing was persisted either */ }
}
```

In `installPreviewApi`, directly after `if (!isPreviewMode) return;` add:

```js
  clearPreviewPendingSeries();
```

- [ ] **Step 5: Add the four routes**

In the `route` handler, directly above the comment `// Mirrors GET /api/sessions/studio: every coach's schedule with`, add:

```js
    // Recurring sessions. Shapes mirror backend/src/routes/sessionSeries.js;
    // rule and suggestion logic is the port in previewSeries.js.
    if (path.startsWith('/sessions/series') && role === 'client') return fail(config, 403, 'Coach access required');

    if (path === '/sessions/series/preview' && method === 'post') {
      const target = clientById(payload.client_id);
      if (!target || (role !== 'admin' && target.coach_id !== currentCoach().id)) return fail(config, 404, 'Client not found');
      const parsed = parseRule(payload, { today: todayInDenver() });
      if (!parsed.ok) return fail(config, 400, parsed.error);
      const expanded = expandSeriesRule(parsed.value);
      if (expanded.exceededMax) return fail(config, 400, 'A series can have at most 52 sessions');
      if (expanded.exceededHorizon) {
        return fail(config, 400, 'That schedule runs past one year from the start date — reduce the count or choose an end date');
      }
      const rows = previewSeriesRows(target, expanded.slots, parsed.value.duration_minutes);
      const past = pastError(rows, Date.now());
      if (past) return fail(config, 400, past);
      return ok({ slots: rows }, config);
    }

    if (path === '/sessions/series/check' && method === 'post') {
      const target = clientById(payload.client_id);
      if (!target || (role !== 'admin' && target.coach_id !== currentCoach().id)) return fail(config, 404, 'Client not found');
      const horizon = slotHorizonError(payload.slots || [], payload.start_date, todayInDenver());
      if (horizon) return fail(config, 400, horizon);
      const rows = previewSeriesRows(target, payload.slots || [], payload.duration_minutes);
      const past = pastError(rows, Date.now());
      if (past) return fail(config, 400, past);
      return ok({ seq: payload.seq, slots: rows }, config);
    }

    if (path === '/sessions/series' && method === 'post') {
      const target = clientById(payload.client_id);
      if (!target || (role !== 'admin' && target.coach_id !== currentCoach().id)) return fail(config, 404, 'Client not found');
      const fingerprint = JSON.stringify(payload);
      const existing = state.sessionSeries.find((item) => item.request_id === payload.request_id && item.client_id === target.id);
      const publicSeries = ({ request_fingerprint, ...series }) => series;
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          return Promise.reject({
            response: {
              data: { error: 'This save was already used with different content — nothing was changed.', code: 'request_mismatch' },
              status: 409, statusText: 'Conflict', headers: {}, config,
            },
            config,
          });
        }
        return ok({ series: publicSeries(existing), receipt: existing.receipt, replayed: true }, config, 200);
      }
      const horizon = slotHorizonError(payload.slots || [], payload.rule?.start_date, todayInDenver());
      if (horizon) return fail(config, 400, horizon);
      const rows = previewSeriesRows(target, payload.slots || [], payload.duration_minutes);
      const past = pastError(rows, Date.now());
      if (past) return fail(config, 400, past);
      const conflicts = rows.filter((row) => row.conflict).map((row) => ({ key: row.key, ...row.conflict }));
      if (conflicts.length) {
        return Promise.reject({
          response: {
            data: { error: 'Some dates are no longer available', conflicts },
            status: 409, statusText: 'Conflict', headers: {}, config,
          },
          config,
        });
      }
      const stamp = new Date().toISOString();
      const seriesId = id('series');
      const workoutByKey = new Map((payload.slots || []).map((slot) => [slot.key, slot.workout_id || null]));
      const receiptSlots = rows
        .slice()
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
        .map((row, index) => {
          // Workouts are stored exactly as sent; the server never remaps them.
          const session = {
            id: id('session'), client_id: target.id, coach_id: target.coach_id, scheduled_at: row.scheduled_at,
            duration_minutes: payload.duration_minutes, location: payload.location || null, status: 'scheduled',
            credit_deducted: false, workout_id: workoutByKey.get(row.key), series_id: seriesId, series_ordinal: index + 1,
            archived: false, created_at: stamp, updated_at: stamp,
          };
          state.sessions.push(session);
          return { key: row.key, session_id: session.id, scheduled_at: row.scheduled_at, workout_id: session.workout_id, ordinal: index + 1 };
        });
      const series = {
        id: seriesId, request_id: payload.request_id, request_fingerprint: fingerprint, client_id: target.id,
        coach_id: target.coach_id, rule: payload.rule, created_count: receiptSlots.length,
        receipt: { slots: receiptSlots }, created_at: stamp,
      };
      state.sessionSeries.push(series);
      if (payload.assign_program && payload.program_id) previewAssignProgramClone(payload.program_id, target.id);
      // notify is accepted and ignored: preview sends nothing.
      return ok({ series: publicSeries(series), receipt: series.receipt, replayed: false }, config, 201);
    }

    const seriesCancel = path.match(/^\/sessions\/series\/([^/]+)\/cancel$/);
    if (seriesCancel && method === 'patch') {
      const series = state.sessionSeries.find((item) => item.id === seriesCancel[1]);
      if (!series || (role !== 'admin' && series.coach_id !== currentCoach().id)) return fail(config, 404, 'Series not found');
      const anchor = state.sessions.find((row) => row.id === payload.from_session_id
        && row.series_id === series.id && row.client_id === series.client_id);
      if (!anchor) return fail(config, 404, 'Session not found in this series');
      const anchorStart = new Date(anchor.scheduled_at).getTime();
      const changed = state.sessions.filter((row) => row.series_id === series.id && row.status === 'scheduled'
        && !row.archived && new Date(row.scheduled_at).getTime() >= anchorStart);
      changed.forEach((row) => { row.status = 'cancelled'; row.updated_at = new Date().toISOString(); });
      const cancelled = changed
        .map((row) => ({ id: row.id, scheduled_at: row.scheduled_at }))
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      return ok({ cancelled }, config);
    }
```

- [ ] **Step 6: Add series fields to the two coach reads**

In the `if (path === '/sessions' && method === 'get')` handler, change

```js
      rows = rows.map((s) => ({
        ...s,
```

to

```js
      rows = rows.map((s) => ({
        ...withSeries(s),
```

In the `sessionCoachDetail` handler, change

```js
      return ok({
        ...row,
        client: { id: row.client_id, name: clientById(row.client_id).name },
```

to

```js
      return ok({
        ...withSeries(row),
        client: { id: row.client_id, name: clientById(row.client_id).name },
```

Leave `/sessions/client/mine` and `client-detail` unchanged: the real API does not add series fields to client reads.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test e2e/preview-series.spec.mjs e2e/preview-harness.spec.mjs`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/e2e/preview-series.spec.mjs frontend/e2e/preview-harness.spec.mjs frontend/e2e/preview-controls.spec.mjs frontend/src/lib/previewMode.js
git commit -m "feat: recurring-session routes in the preview mock"
```

### Task 7: "Also assign this program" creates a private client copy

**Files:**
- Modify: `frontend/src/lib/previewMode.js` (replace the `previewAssignProgramClone` stub)
- Modify: `frontend/e2e/preview-series.spec.mjs` (append)

**Interfaces:**
- Consumes: `createBody`, `openCoach`, `callPreviewApi` (Task 6); test ids `tab-programs`, `assigned-program-card`, `edit-client-workout-button` (existing client page).
- Produces: `previewAssignProgramClone(programId: string, clientId: string): assignment | null` — `null` when the client already has the program or a copy of it.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/e2e/preview-series.spec.mjs`:

```js
test('"also assign this program" gives a client without it a private, editable copy', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_david');
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card')).toHaveCount(0);

  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_david', '55555555-5555-4555-8555-555555555555', { program_id: 'program_foundation', assign_program: true }));
  expect(created.status).toBe(201);

  // In-app navigation keeps the in-memory fixtures; a reload would rebuild them.
  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await page.getByText('David Chen').first().click();
  await page.getByTestId('tab-programs').click();
  const copy = page.getByTestId('assigned-program-card').filter({ hasText: 'Foundation Strength - Phase 1' });
  await expect(copy).toHaveCount(1);
  // Only a client copy offers Edit; a template assigned directly does not.
  await expect(copy.getByTestId('edit-client-workout-button').first()).toBeVisible();
});

test('a client who already has the program, or a copy of it, gets no second assignment', async ({ page }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_sarah');
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card').first()).toBeVisible();
  const before = await page.getByTestId('assigned-program-card').count();

  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_sarah', '66666666-6666-4666-8666-666666666666', { program_id: 'program_foundation', assign_program: true }));
  expect(created.status).toBe(201);

  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await page.getByText('Sarah Martinez').first().click();
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assigned-program-card').first()).toBeVisible();
  await expect(page.getByTestId('assigned-program-card')).toHaveCount(before);
});
test('each program day gets its own workout copy, owned by the client\'s coach', async ({ page }) => {
  await openCoach(page);
  // Hybrid Strength: days 1 and 4 both use the Lower Strength A template.
  const created = await callPreviewApi(page, 'post', '/sessions/series',
    createBody('client_david', '88888888-8888-4888-8888-888888888888', { program_id: 'program_hybrid', assign_program: true }));
  expect(created.status).toBe(201);

  const workouts = (await callPreviewApi(page, 'get', '/programs/workouts')).data;
  const davidCopies = workouts.filter((workout) => workout.client_id === 'client_david' && workout.is_template === false);
  expect(davidCopies).toHaveLength(4);
  expect(new Set(davidCopies.map((workout) => workout.id)).size).toBe(4);
  expect(davidCopies.filter((workout) => workout.source_workout_id === 'workout_lower_a')).toHaveLength(2);
  expect(davidCopies.every((workout) => workout.coach_id === 'coach_marcus')).toBe(true);
  expect(davidCopies.map((workout) => workout.name).sort()).toEqual(
    ['Lower Strength A', 'Lower Strength A', 'Run Prep Mobility', 'Upper Strength A']);
});
```

Both tests make the API call after landing on the client page and then move with in-app navigation: a `page.goto` would reload the page and rebuild the fixtures.

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `npx playwright test e2e/preview-series.spec.mjs -g "assign|own workout copy"`

Expected: the "private, editable copy" and "own workout copy" tests fail (the stub does nothing). The "no second assignment" test passes already; it guards the skip rule once the clone exists.

If `GET /programs/workouts` does not return client copies (it is the coach's workout list; check its handler in `previewMode.js`), read the copies through the route the coach client page uses for its Programs tab instead, and keep the same five assertions.

- [ ] **Step 3: Implement the clone**

In `frontend/src/lib/previewMode.js`, replace the stub

```js
// Implemented in the next task: mirrors assign_program_clone.
function previewAssignProgramClone() {
  return null;
}
```

with

```js
// Mirrors schedule_session_series step 4e and assign_program_clone
// (supabase/migrations/20260929120000_shared_training_library.sql): skip when
// the client already has the program or a copy sourced from it; otherwise
// assign a private client copy. Like the real function: the source must be an
// unhidden template, the copy keeps the template's name, the copy and its
// workouts belong to the CLIENT'S coach, and every program day gets its OWN
// workout copy even when two days share one template workout — so editing one
// day never changes another.
function previewAssignProgramClone(programId, clientId) {
  const alreadyAssigned = state.programAssignments.some((assignment) => {
    if (assignment.archived || assignment.client_id !== clientId) return false;
    const program = state.programs.find((item) => item.id === assignment.program_id);
    return Boolean(program) && !program.archived && (program.id === programId || program.source_program_id === programId);
  });
  if (alreadyAssigned) return null;
  // Template fixtures omit is_template; client copies carry is_template: false.
  const source = state.programs.find((item) => item.id === programId && !item.archived && item.is_template !== false && !item.hidden);
  const client = clientById(clientId);
  if (!source || !client || client.archived || !client.coach_id) return null;

  const stamp = new Date().toISOString();
  const copy = {
    id: id('program'), coach_id: client.coach_id, name: source.name, description: source.description,
    frequency_days: source.frequency_days, is_template: false, client_id: client.id, source_program_id: source.id,
    hidden: false, archived: false, created_at: stamp, updated_at: stamp,
  };
  state.programs.push(copy);

  state.programDays
    .filter((day) => day.program_id === source.id && !day.archived)
    .sort((first, second) => first.day_number - second.day_number)
    .forEach((day) => {
      const workout = state.workouts.find((item) => item.id === day.workout_id);
      let workoutCopyId = null;
      if (workout) {
        workoutCopyId = id('workout');
        state.workouts.push({
          ...workout, id: workoutCopyId, coach_id: client.coach_id, is_template: false, client_id: client.id,
          source_workout_id: workout.id, hidden: false, archived: false, created_at: stamp, updated_at: stamp,
        });
        state.workoutExercises
          .filter((exercise) => exercise.workout_id === workout.id && !exercise.archived)
          .forEach((exercise) => state.workoutExercises.push({ ...exercise, id: id('wex'), workout_id: workoutCopyId, created_at: stamp }));
      }
      state.programDays.push({
        id: id('day'), program_id: copy.id, day_number: day.day_number, workout_id: workoutCopyId,
        notes: day.notes, archived: false, created_at: stamp,
      });
    });

  const assignment = {
    id: id('assign'), program_id: copy.id, client_id: client.id, notes: null, archived: false, created_at: stamp,
    client: { id: client.id, name: client.name },
  };
  state.programAssignments.push(assignment);
  return assignment;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test e2e/preview-series.spec.mjs -g "assign|own workout copy"`

Expected: 3 passed.

If the copy's card shows no Edit button, read how the client page decides (`git grep -n "edit-client-workout-button" frontend/src`) and compare the copy's fields with `program_sarah_mobility`; add any field the page keys on to `copy` or `workoutCopy`. Do not change the page.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/previewMode.js frontend/e2e/preview-series.spec.mjs
git commit -m "feat: recurring-session program assignment creates a client copy in preview"
```

### Task 8: Seeded series and the browser flows

**Files:**
- Modify: `frontend/src/lib/previewMode.js` (seed)
- Modify: `frontend/e2e/preview-series.spec.mjs` (append)

**Interfaces:**
- Consumes: Tasks 5–7; toolbar test id `preview-fail-select` (Task 4); existing test ids `session-create-button`, `session-client-select`, `session-datetime-input`, `session-repeat-toggle`, `series-count-input`, `series-preview-button`, `series-row-<key>`, `series-suggestion-<key>-<HH:mm>`, `series-create-button`, `series-unknown`, `series-retry-button`, `series-badge`, `session-row`, `session-actions-button`, `session-cancel-action`, `session-cancel-scope-future`, `session-cancel-confirm`.
- Produces: fixture ids `series_david`, `session_david_series_1` … `session_david_series_6`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/e2e/preview-series.spec.mjs`:

```js
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

/** Drive the branded DateTimePicker (same helper as series-mocked.spec.mjs). */
async function pickDateTime(page, testId, target, slotText = '9:00 AM') {
  await page.getByTestId(testId).click();
  const panel = page.getByTestId(`${testId}-panel`);
  const dayName = new RegExp(`${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}(st|nd|rd|th)?, ${target.getFullYear()}`);
  for (let hops = 0; hops < 3; hops += 1) {
    if (await panel.getByRole('button', { name: dayName }).count()) break;
    await panel.getByRole('button', { name: /next month/i }).click();
  }
  await panel.getByRole('button', { name: dayName }).first().click();
  await panel.getByTestId('time-slot').filter({ hasText: slotText }).first().click();
  await expect(panel).toBeHidden();
}

// Opens the editor for a client, 3 weekly sessions starting 10 days out at 9:00 AM, and previews.
async function startSeries(page, clientName) {
  await page.getByTestId('session-create-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: clientName }).click();
  await pickDateTime(page, 'session-datetime-input', daysFromNow(10), '9:00 AM');
  await page.getByTestId('session-repeat-toggle').click();
  await page.getByTestId('series-count-input').fill('3');
  await page.getByTestId('series-preview-button').click();
  await expect(page.getByTestId('series-row-g3')).toBeVisible();
}

const davidSeriesBadges = (page) => page.getByTestId('session-row').filter({ hasText: 'David Chen' }).getByTestId('series-badge');

test('the seeded series shows its badge on the list and the session detail page', async ({ page }) => {
  await openCoach(page);
  await expect(davidSeriesBadges(page)).toHaveCount(4);
  await expect(davidSeriesBadges(page).first()).toHaveText(/^Weekly · \w{3} · Session 3 of 6$/);
  await page.goto('/coach/sessions/session_david_series_3');
  await expect(page.getByTestId('series-badge')).toHaveText(/Session 3 of 6$/);
});

test('cancelling one session leaves the rest; cancelling this and all future clears them', async ({ page }) => {
  await openCoach(page);
  const rows = page.getByTestId('session-row').filter({ hasText: 'David Chen' }).filter({ has: page.getByTestId('series-badge') });
  await expect(rows).toHaveCount(4);

  await rows.first().getByTestId('session-actions-button').click();
  await page.getByTestId('session-cancel-action').click();
  await page.getByTestId('session-cancel-confirm').click();
  await expect(rows).toHaveCount(3);
  await expect(davidSeriesBadges(page).first()).toHaveText(/Session 4 of 6$/);

  await rows.first().getByTestId('session-actions-button').click();
  await page.getByTestId('session-cancel-action').click();
  await page.getByTestId('session-cancel-scope-future').click();
  await page.getByTestId('session-cancel-confirm').click();
  await expect(rows).toHaveCount(0);

  const series = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id === 'series_david');
  expect(series.map((row) => row.status)).toEqual(['completed', 'completed', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
});

test('a conflicting series is fixed with suggestions and saved from the editor', async ({ page }) => {
  await openCoach(page);
  // David already holds the same three slots, so every row for Sarah collides with Marcus's calendar.
  expect((await callPreviewApi(page, 'post', '/sessions/series', createBody('client_david', '77777777-7777-4777-8777-777777777777'))).status).toBe(201);

  await startSeries(page, 'Sarah Martinez');
  for (const key of ['g1', 'g2', 'g3']) {
    await expect(page.getByTestId(`series-row-${key}`)).toHaveAttribute('data-conflict', 'coach');
  }
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
  for (const key of ['g1', 'g2', 'g3']) {
    await page.getByTestId(`series-suggestion-${key}-10:00`).click();
    await expect(page.getByTestId(`series-row-${key}`)).toHaveAttribute('data-conflict', 'none');
  }
  await expect(page.getByTestId('series-create-button')).toHaveText('Create 3 sessions');
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  await expect(page.getByTestId('session-row').filter({ hasText: 'Sarah Martinez' }).getByTestId('series-badge')).toHaveCount(3);
});

test('fail next save is not consumed by previewing dates; Create lands in "Save status unknown" and Retry saves once', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('preview-fail-select').selectOption('write-once');
  await startSeries(page, 'David Chen');
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('write-once');

  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toContainText('Save status unknown');
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('off');

  await page.getByTestId('series-retry-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  const created = (await callPreviewApi(page, 'get', '/sessions')).data.filter((row) => row.series_id && row.series_id !== 'series_david');
  expect(created).toHaveLength(3);
});

test('after an unresolved save, a reload opens a clean demo with no recovery prompt', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('preview-fail-select').selectOption('write-once');
  await startSeries(page, 'David Chen');
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await expect(page.getByTestId('series-unknown')).toHaveCount(0);
  const pending = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_series_pending')));
  expect(pending).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify the seed-dependent ones fail**

Run: `npx playwright test e2e/preview-series.spec.mjs -g "seeded|cancelling"`

Expected: both fail — no `series-badge` exists for David.

- [ ] **Step 3: Add the seeded series**

In `frontend/src/lib/previewMode.js`, inside `sessions: [ ... ]`, add after the `session_emily` row:

```js
    // A seeded weekly series (David with Marcus): two past, four upcoming, so
    // the badge and "this and all future" cancel are reviewable without
    // creating one. 12:00 sits outside Marcus's availability windows and clear
    // of session_david and the seeded time off. Not on Sarah.
    ...[-10, -3, 4, 11, 18, 25].map((days, index) => ({
      id: `session_david_series_${index + 1}`, client_id: 'client_david', coach_id: 'coach_marcus',
      scheduled_at: iso(days, 12), duration_minutes: 45, location: 'CVF Studio',
      status: days < 0 ? 'completed' : 'scheduled', credit_deducted: false,
      series_id: 'series_david', series_ordinal: index + 1,
      archived: false, created_at: iso(-12), updated_at: iso(-12),
    })),
```

Replace `sessionSeries: [],` with:

```js
  sessionSeries: [
    {
      id: 'series_david', request_id: 'seed_series_david', request_fingerprint: 'seed', client_id: 'client_david', coach_id: 'coach_marcus',
      rule: { start_date: dateOnly(-10), time: '12:00', weekdays: [new Date(iso(-10, 12)).getDay()], interval_weeks: 1, end: { count: 6 } },
      created_count: 6, receipt: { slots: [] }, created_at: iso(-12),
    },
  ],
```

- [ ] **Step 4: Run the series tests**

Run: `npx playwright test e2e/preview-series.spec.mjs`

Expected: all pass.

The coach Sessions list opens on the `upcoming` filter (scheduled sessions from today on), which is why four of David's six seeded sessions show a badge and why cancelled rows drop out of the list.

- [ ] **Step 5: Run the full preview suite and fix seed collisions on the seed side**

Run: `npm run test:e2e:preview`

Expected: 0 failed.

If a pre-existing test now fails, the seeded sessions collided with one of its assumptions about Marcus's calendar or David's counts. Change the seed — move the hour (`iso(days, 12)` → another hour outside 06:00–11:00 and 16:00–20:00), or shift the day offsets by whole weeks — and re-run. Do not edit the pre-existing test. Report any collision and the seed change made.

Also run from `backend/`: `npm test`. `backend/test/analytics-dashboard.test.js` and `backend/test/metric-goals.test.js` reference the preview fixtures; they must still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/previewMode.js frontend/e2e/preview-series.spec.mjs
git commit -m "feat: seeded recurring series and preview browser coverage"
```

### Task 9: Documentation and PR 3 verification

**Files:**
- Modify: `CLAUDE.md` ("Known duplication" list; the "Recurring sessions" Status entry)

- [ ] **Step 1: Add the duplication entry**

In `CLAUDE.md`, under `## Known duplication`, add a third bullet:

```markdown
- The recurring-session rule, Denver wall-clock conversion, and suggestion times are ported for preview mode at `frontend/src/lib/previewSeries.js` from `backend/src/lib/sessionSeries/rule.js`, `backend/src/lib/sessionSeries/alternatives.js`, and `backend/src/utils/time.js`. `frontend/tests/unit/previewSeries.test.mjs` holds the backend's test vectors; a backend rule change must update the port and those vectors together.
```

- [ ] **Step 2: Add one sentence to the Status entry**

In `CLAUDE.md`, append to the end of the `- Recurring sessions (2026-09-30): ...` bullet:

```markdown
 Preview support (2026-10-01): the four series routes, series badges on coach session reads, and one seeded series are mocked in `previewMode.js`; cross-reload recovery, replay, and `request_mismatch` remain covered only by the mocked-API series suite. Spec: `docs/superpowers/specs/2026-10-01-preview-mode-post-launch-design.md`.
```

Do not edit the "Preview mode" section.

- [ ] **Step 3: Verify PR 3**

Run each and confirm:

- `npm run test:unit` → all pass, including 17 in `previewSeries.test.mjs`.
- `npm run test:e2e:preview` → 0 failed.
- `npm run test:e2e:series` → 19 passed, unchanged (this suite runs a non-preview build and must not be affected).
- `npm run build` → succeeds.
- From the repo root: `bash scripts/check-boundaries.sh frontend` → passes.
- Production bundle check:

  ```bash
  (
    VERCEL_ENV=production npm run build || { echo "FAIL: the production build failed"; exit 1; }
    if grep -rlE "cvf-preview:missing-mock|Simulated failure \(preview\)" dist/assets; then
      echo "FAIL: preview code is in the production bundle (files listed above)"
      exit 1
    fi
    echo "clean: no preview code in the production bundle"
  )
  echo "exit status: $?"
  ```

  Expected: `clean: no preview code in the production bundle` and `exit status: 0`. A failed build or any matching file prints `FAIL` and a non-zero status; treat either as a failed check. If the build needs other variables to run under `VERCEL_ENV=production`, report what it asked for instead of guessing values. If preview code is found, run the same block on `origin/main` with the pattern `Preview route not mocked` to learn whether preview code was already in that bundle before this work, and report both results.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the preview port of the recurring-session rule"
```

---

## Self-Review Notes

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Single exclusions list with reasons; 422 body; notice event | 1 |
| "Not available in preview" and "Preview is missing a mock" toasts from the toolbar | 1 |
| Console marker; context-level automatic fixture; `allowMissingMocks` option | 1 |
| Enforcement proven on an ordinary test (`test.fail()`), with the stated fallback | 1 |
| Existing suite switched to the shared `test`; triage until green | 2 |
| Read vs save classification, including read-like POSTs; `/auth/*` exempt | 3 |
| Save failures injected before the handler from `PREVIEW_SAVE_ROUTES`; gaps pass through and do not consume the switch | 3 |
| Concurrent saves: exactly one fails, the rest are kept | 3 |
| Unlisted saves fail the suite, keeping the route table complete | 3 |
| Dedicated switch-change event instead of `cvf-preview-change` | 3 |
| Reset removes only the explicit preview-owned keys; hard-loads the role's home | 3, 4 |
| Speed select reusing `cvf_preview_latency`; failure select; modified marker | 4 |
| Rule expander and `candidateTimes` ported with backend vectors | 5 |
| Four series routes with mirrored shapes and messages; Denver conversion | 6 |
| Conflicts: existing first (coach then client), then batch on both rows | 5, 6 |
| Suggestions: same day, nearest first, 05:00–20:45, never in the past, first three free | 5 |
| Replay and `request_mismatch` within one page load | 6 |
| Series fields on `GET /sessions` and coach-detail only | 6 |
| Reload clears pending series saves for fixture coaches before render | 6 |
| Exclusions removed | 6 |
| Program assignment: skip rule; private copy owned by the client's coach, one workout copy per day, template name kept | 7 |
| Seeded series on David; seed moves, tests do not | 8 |
| Preview browser tests for badge, create with conflict, cancel, fail-next-save, reload | 8 |
| "Known duplication" entry and Status sentence | 9 |
| Production bundle check | 9 |

**Deliberately not in this plan:** the CLAUDE.md "Preview mode" section (owner's edit); scenario data, coach selector, and scenario selector (later steps).

**Known unknowns an executor must report, not paper over:** the triage list size (Task 2); whether `test.fail()` is satisfied by fixture teardown (Task 1, fallback given); whether the dev server's dynamic `import('/src/lib/api.js')` returns the app's instance (Task 1, stop condition given); whether `PREVIEW_SAVE_ROUTES` is complete (Task 3 Step 8 — the suite proves it only for saves the suite exercises).
