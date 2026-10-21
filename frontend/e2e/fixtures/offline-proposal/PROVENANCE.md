# Preview-catalog offline draft proposal (fictional, MOCK)

`preview-proposal.json` was exported by the accepted offline drafting companion
`ec82371` (provider DISABLED / MOCK, scripted fictional coach acceptance)
against the **fresh preview fixture catalog** (5 rows, read in preview mode
with `include_hidden=true`). Canonical SHA-256
`37e0d9ea4e54c12f1acc0e11fca4e8a48151cb449312564435cde1b3eb91c5f2`; catalog
`pt-catalog:55020c13…a612`. If the preview catalog is edited in a browser
session, PT correctly refuses this file as drafted against another catalog.

Regenerate from the Track 04 `build/` directory:

    node tools/make-proposal.mjs scenarios/preview.json pt/frontend/e2e/fixtures/offline-proposal/preview-proposal.json
