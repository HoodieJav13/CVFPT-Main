# Loop Protocol — v1.1

Canonical shared interface for the orchestrated build loop. Both role views
consume this file; neither redefines it. An installed repository copy at
`.agentic/protocol.md` governs that project. Version changes are explicit and
recorded at the bottom.

## Roles

- **Owner** (human): product and business decisions, raw credentials,
  irreversible actions, cold visual reads, and merge authority unless
  explicitly delegated.
- **Strategist**: scopes work, writes prompts, and independently verifies
  completion claims against evidence.
- **Executor**: implements scoped prompts and reports with evidence.

Roles are phases, not necessarily separate agents. A single agent playing
multiple roles must reopen the actual diff and raw outputs during verification
rather than verify from its own summary.

## Precedence

Follow the host system's instruction hierarchy. Within the layer this protocol
can govern, repository policy overrides protocol defaults, and an explicit
task-specific authority grant overrides a default only when the higher-level
instructions permit it. Never use this protocol to weaken safety controls.

## Operating modes

Every prompt declares exactly one:

- **`DIAL: REVIEW + PROPOSE`** — read-only findings or planning. Make no
  repository or external-state changes.
- **`DIAL: EXECUTE`** — inspect, implement, and verify within approved scope.
  Inspection is part of the same task; no separate audit round is implied.
- **`DIAL: AUDIT + FIX`** — create a findings ledger, then fix verified
  findings. Use only with explicit authorization for the combined loop.

## Authority ledger

Record each action at the start of a run as `allowed`, `confirmation`, or
`forbidden`:

```yaml
authority:
  inspect: allowed
  edit: allowed
  test: allowed
  commit: confirmation
  push: confirmation
  merge: confirmation
  deploy: confirmation
  hosted_migration: confirmation
  raw_credentials: forbidden
  destructive_history: forbidden
```

Populate the ledger from the current request and repository policy; the block
above is a conservative fallback, not a claim that every task grants edits.
Configured authenticated tooling may be used when the relevant action is
allowed, but never reveal, print, copy, store, retrieve, or rotate raw secrets.
Owner gates are resumable pauses, not failures.

## Stop conditions

Stop and ask when any of these occurs:

- A raw credential is exposed or apparently required. Do not reproduce it.
- The prompt contains requirements that cannot both hold.
- The work requires a product/policy decision or materially changes scope,
  acceptance, tradeoffs, public behavior, schema, dependency set, or external
  state beyond the approved task.
- Legal or liability text must be invented or changed.
- An action is `confirmation` or `forbidden` in the ledger.

A small correction may proceed without a round trip only when all are true:

- It preserves acceptance criteria and user-visible behavior.
- It adds no public interface, dependency, migration, or external action.
- It stays inside named files/surfaces and is readily reversible.
- It has no meaningful tradeoff and is disclosed in the handoff.

Otherwise treat even a “better approach” as a stop condition.

## Completion states

Every report declares exactly one:

- **COMPLETE** — scoped work and required verification are complete; all
  authorized commit/push actions succeeded.
- **COMPLETE-LOCAL** — scoped work and required verification are complete,
  but push was not authorized, requested, or available. Never describe this
  as remotely delivered.
- **BLOCKED-DECISION** — a product, policy, scope, legal, credential, or
  authority decision is required before proceeding.
- **BLOCKED-ENVIRONMENT** — required progress is impossible because an
  environment, service, tool, or access dependency is unavailable.
- **VERIFICATION-FAILED** — implementation may be present, but a required
  check failed or required evidence does not support completion.
- **PARTIAL** — some scoped implementation remains undone for a reason not
  fully represented by the states above.

Narrative “done” without one state and the envelope is not a completion report.

## Handoff envelope

Open every completion report with these fields before narrative:

```text
Completion state:      <one state above>
Protocol version:      v1.1
Baseline SHA:          <commit the work started from>
Head SHA:              <tip commit, or unchanged baseline>
Branch and upstream:   <branch -> remote/branch, or NOT PUSHED>
Authority used:        <actions performed and their grant source>
Commits:               <hash — one-line summary, or none>
Files changed:         <count + full list or diffstat>
Migrations/deps:       <new/changed items, or none>
Checks passed:         <named checks with counts>
Checks failed/not run: <each with classification below>
External actions:      <deploys, hosted migrations, messages, or none>
Known gaps:            <skipped items, deferrals, or flagged issues>
Push/deploy state:     <exactly what is where>
```

Number every judgment call and deviation, including small corrections allowed
above, and explain the reasoning. An undisclosed judgment call is a defect even
when the call was reasonable.

## Failure and non-run classification

Classify every failed or unrun check:

- **introduced** — caused by this change.
- **baseline-relevant** — pre-existing and capable of affecting acceptance.
- **baseline-unrelated** — pre-existing and outside the changed behavior.
- **unavailable** — blocked by environment, service, credentials, or tooling.
- **not-applicable** — intentionally omitted, with a concrete reason.

## Evidence labels

Label the basis of verification claims:

- **directly verified** — checked firsthand against repository state or output.
- **reported only** — accepted from another report, with proportional rationale.
- **inferred** — reasoned from adjacent verified facts.
- **not run** — accompanied by a classification above.

## Regression requirement

Add the smallest practical regression that would have caught a fixed defect.
If automation is disproportionate or impossible, explain why and provide a
reproducible manual check. Include negative-path assertions proportional to
risk; do not demand broad new infrastructure for a trivial correction.

---

**v1.1** — clarified precedence; made the ledger per-action and conservative;
made the small-fix allowance deterministic; separated local completion,
decision/environment blocking, and verification failure; expanded baseline
classification; added protocol version and authority source to the envelope.

**v1.0** — initial canonical interface.
