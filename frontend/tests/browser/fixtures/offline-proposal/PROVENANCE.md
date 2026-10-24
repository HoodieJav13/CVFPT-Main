# Offline draft proposal fixtures (fictional, MOCK)

Produced by the accepted offline drafting companion `ec82371` (tree `9bd4de1`)
through its own flow and export wrapper: `buildRequest` → `MockProvider` →
`validateProposal` → `createReview` → `acceptReview` (scripted fictional coach)
→ `exportAccepted`. Provider DISABLED / MOCK; no network, no real people.
The catalog snapshot is built with PT's `catalogIdentity`
(`src/lib/offlineDraftImport.js`) from the fictional library next to it.

| File | Source |
|---|---|
| `library.json` | Fictional catalog (5 rows) from `build/scenarios/journey.json` |
| `proposal.json` | Export for `library.json`. Canonical SHA-256 `d288b6ba258bec838739e334c38ece7b979c9515bde0a15cead92de5cbf9163b`; catalog `pt-catalog:46a65d03…932d` |
| `library-ambiguous.json` | `library.json` plus a second "Goblet Squat" (`lib-goblet-b`) |
| `proposal-ambiguous-catalog.json` | Export for `library-ambiguous.json`; PT refuses it (other catalog revision, and the bound name is not unique there) |

Regenerate (from the Track 04 `build/` directory):

    node tools/make-proposal.mjs scenarios/journey.json pt/frontend/tests/browser/fixtures/offline-proposal/proposal.json
    node tools/make-proposal.mjs scenarios/journey-ambiguous.json pt/frontend/tests/browser/fixtures/offline-proposal/proposal-ambiguous-catalog.json
