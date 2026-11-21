# Workout Authoring Studio — first slice

Local implementation only. Nothing here has been deployed, run against a hosted
database, or reviewed by the owner. No hosted, device or production claim is made.

## What it does

Training builder → Workout Days → **Draft from text** (phone header and desktop
rail). The coach types, pastes, or dictates with the **device keyboard's own
microphone** into a normal text box. CVF PT does not capture, record, upload or
receive audio; there is no microphone integration, speech service or AI provider.

1. **Build draft** reads the text with `parseAuthoringText` (both Program Draft
   copies: `frontend/src/lib/programDraft.js`, `backend/src/lib/programDraft.cjs`).
2. The original text stays visible and read-only while the draft is reviewed.
   **Change text** discards the draft only after confirmation.
3. The coach resolves every open item. **Accept into builder** stays disabled
   until none remain.
4. Accept opens the existing workout builder with a new, independent form. No
   server write happens until the builder's normal **Save workout**.

## What the parser reads

Deterministic rules only. One exercise per line, numbers as digits.

| Written | Read as |
| --- | --- |
| `Goblet squat 3x10`, `3 x 8-10`, `3 by 12`, `3 sets of 8 to 10 reps` | sets + reps (ranges kept as `8-10`) |
| `Split squat 3x10/side` | reps `10/side` |
| `Plank 3 x 30 sec`, `Bike 2 x 5 min` | sets + duration, unit `s`/`min` |
| `Row erg 4x500m`, `Run 1.5 mi`, `Carry 2x40 yards`, `Run 5 km` | sets (optional) + distance, unit `m`/`km`/`mi`/`yd` |
| `Bike 3 x 1 km in 3 min` | duration + distance |
| `…, rest 90 seconds, tempo 3-1-1, chest tall` or a following `Rest … - Tempo … - cue` line | rest, tempo and client cue, as written |
| `Day 2 …` / weekday lines, or blank lines | a new day |

Values and units are kept as written. Nothing is converted. Separate cues with
commas; an unclassified bare word after a number needs an explicit note/edit
choice, so a new unit cannot silently become reps.

## What it will not guess

Each of these blocks Accept until the coach makes a choice:

- **Unreadable prescriptions**: unsupported units (`cal`, `rounds`, `hours`,
  `ft`, `lb`…), a range for a time or distance target (`30-45 sec`), decimal reps,
  unknown bare suffixes (`40 furlongs`), unsupported or ranged secondary targets
  (`500 m in 2-3 min`, `30 sec + 2 hours`), two targets of the same kind, or values
  outside the builder's limits. Reps and targets are left blank; a readable set
  count is retained, and the complete raw prescription is shown. The coach either
  edits the values and chooses **Use what I entered**, or chooses **Keep as coach
  note**. That stores `As written: <raw>` in the internal coach notes.
- **Catalog names**: only an exact, unique (normalized) catalog name links
  automatically, using the same fields as the builder picker
  (`chooseLibraryExercise`: inherit the library demo, never copy its link).
  - Exact duplicates in the catalog: the coach picks one. To use a custom exercise
    instead, they rename it, because the builder links exact catalog names.
  - Unknown names: shared-word suggestions are shown but never picked. The coach
    chooses a suggestion or **Keep as a custom exercise**. Nothing is added to
    the catalog. The builder's existing "Create in catalog" button stays the only
    way to add one.
- **Lines that are not exercises**: plain text becomes a workout note, goes into
  the description, and stays visible. A line with numbers or workout words
  (for example "three sets of ten") needs **Keep as workout note** or **Add as
  exercise**. A first line that reads like a prescription is not used as the day
  name.
- **Several days**: no day is pre-selected. This first slice moves **one day at a
  time** into the workout builder. The text is kept after Accept, so another day
  can be taken later. To keep these typed targets in a whole program, save each
  reviewed day and select those workouts in the existing program builder.
  Programs → Import program is unchanged and uses its own supported formats.
- Blank text, or text with no readable exercise, shows what to change and the
  lines that were read.

## Builder handoff guarantees

- Opening or cancelling the studio never changes the builder, the catalog or
  any saved workout/program.
- Accept replaces the builder contents with a new workout day. Unsaved builder
  edits are discarded only after the existing unsaved-changes confirmation.
  Declining leaves both the builder and the studio draft as they were. An open
  saved workout is not modified; the draft becomes a new workout.
- The accepted form is built only from primitive values. Every row gets a fresh
  builder `_uid`. A synchronous accept latch and a take-once handoff mean a
  double tap cannot apply the draft twice. The accepted draft counts as unsaved
  builder work.
- Not a medical or prescription tool. The parser transcribes what the coach
  wrote and does not generate, check or adjust prescriptions.

## Local verification (2026-10-30)

- `frontend/tests/unit/workoutAuthoring.test.mjs`: parsing fidelity, explicit
  issues, catalog resolution, blocking, independence, and the handoff/latch.
- `backend/test/workout-authoring-parser.test.js`: backend/browser parser parity,
  and `parsePasteDraft` unchanged by the shared walker refactor.
- `frontend/e2e/workout-authoring.spec.mjs` (preview fixture): phone-width flow
  through the normal save payload, double accept, cancel, unsaved-builder
  consent, independence, and actionable empty/unreadable text.

Executor results: 303/303 frontend units; 43/43 scoped backend parser/catalog/metric/demo
tests; 20/20 preview browser tests (18 workflow/regression + 1 ambiguity + 1 existing
program-import critical flow). Production build, new-code lint, contract and both
deploy-boundary guards pass. Existing `Programs.jsx` lint findings remain exactly
at baseline (2 errors, 4 warnings); the full baseline frontend lint has 122 errors
and 23 warnings. No hosted or device certification is implied.

The [local paired screenshots and workflow proof](../../../../evidence/01-workout/index.html)
and executor report are outside this isolated source repository in the owned lane
evidence folder. The independent three-case ambiguity regression was RED before
local repair and GREEN after it. The first-party Claude author wrote the initial
implementation; the executor made the bounded ambiguity/a11y corrections and ran
the checks.

## Known limits of this slice

Numbers must be digits, and spoken number words are not read. There is no
superset, load or RPE parsing. Only one day is accepted at a time. Rows are not
re-matched if the catalog changes while the studio is open. No backend route uses
the parser yet. The CJS copy exists for parity with the browser copy.

The legacy whole-program paste parser keeps its original grammar: for example,
`Plank 3x30 sec` there still means reps `30` with cue `sec`. Its separate review
must be checked manually; Studio text is not promised to parse identically in
that route. The Studio reads that example as duration `30 s` and the existing
program builder can reuse each saved typed workout day without reparsing it.
