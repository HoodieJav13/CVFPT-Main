# CVF notification email appearance — selected B

Owner accepted the compact/stronger fictional comparisons on 2026-10-02:
“emails look good” and “agree on you recs and implementation proposal.”
The delegated selection is B: original 88px PNG, 22px live wordmark, teal
masthead and action, warm off-white reading surface, graphite dark enhancement.
It applies through the existing booking/session/series/digest/invite/reset wrapper.

The renderer retains the original subject/copy/facts/link/plain-text contract.
Call sites, recipients, Resend behavior and idempotency keys are unchanged.
Logo requests use only the action's app origin plus `/logo.png`, with no token,
email query, fragment or credentials. No new dependency or asset was introduced.

## Verification

- Full backend `npm test`: 472 passed, 0 failed, 0 skipped.
- New rendering regression: 7 tests. Five failed against the old appearance
  before implementation; content/escaping guards already passed. All now pass.
- Independent review: no actionable findings; 120 baseline comparisons retained
  plain text and links, and 25 targeted tests passed independently.
- `scripts/verify-email-render.cjs`: 56 real-wrapper layouts with light/dark
  color-scheme at 320/390/560/900px, 28 inline-only layouts (style removed),
  7 byte-for-byte plain-text baseline comparisons, 2 blocked-image cases,
  all text/button pairs >=4.5:1, zero page errors and zero external requests.
- Deployment-boundary, syntax and whitespace checks pass.

Screenshots and raw browser results in `artifacts/` render the actual production
wrapper, using the unchanged local PNG to fulfill its fictional image request.
They are distinct from the earlier accepted design mockups. Existing comparison
images in the owner's Library were not uploaded again.

Reproduce locally after installing the repository's existing dependencies:

```sh
npm test --prefix backend
node scripts/verify-email-render.cjs
bash scripts/check-boundaries.sh backend
```

The visual script uses existing frontend Playwright and backend dependencies,
not a new test package. Its fixtures use fictional names, dates and reserved
`example.invalid` links. No provider or database operation is invoked.

## Release boundary

No merge, live send, production mutation or deployment is authorized here.
The draft-review branch is disabled in both Vercel roots via an exact
`git.deploymentEnabled` rule for `codex/email-brand-preview`; other branches
retain their existing behavior. Merging to main still triggers both Production
projects and requires the owner's release decision.

Actual Yahoo/Gmail/Outlook rendering, automatic dark-mode rewriting and real
image loading/delivery remain untested. Perform any mailbox test only after
separate authorization. The browser fallback checks and AA calculations do
not certify every email client's behavior.
