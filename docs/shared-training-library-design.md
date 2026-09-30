# Shared training library: design

Status: proposed (2026-09-29). Not implemented. Needs owner review, then a new
forward-only migration.

## Goal

Programs, workout templates, and the exercise library become one shared pool that
every coach can read and use. Assigning a template to a client **clones** it into a
client-specific instance, so later edits to either side never affect the other.

## Current behavior (what this replaces)

- Exercise library: already business-wide and editable by any coach.
- Workouts: a coach sees their own plus shared ones (`coach_id IS NULL`, admin-made);
  only the owner (or admin) edits.
- Programs: visible and editable only by the owning coach (or admin).
- Assignments (`program_assignments`, `workout_assignments`) point at the **live**
  template by id. Editing a template changes every assigned client's plan.

## Model

### Templates and instances

- `programs` and `workouts` each get an `is_template boolean not null default true`
  and a nullable `client_id` (set on instances only).
- Assigning calls one transactional RPC that clones program -> days -> workouts ->
  workout_exercises into instance rows, then creates the assignment pointing at the
  instance. The template is never modified.
- The client's coach (or admin) may edit an instance. Nobody else can.
- Template lists filter `is_template = true`, so instances never appear in pickers.
- Instances keep `exercise_library_id` references. The library is a reference
  catalog and is not copied; client history already snapshots library identity.

### Sharing and editing

- All coaches read and assign any non-hidden template. Admin sees everything.
- All coaches may edit templates, since edits only affect future assignments.
- Assignment authorization is unchanged: you can only assign to your own clients
  (`canAccessClient`). Assignment reads, load edits, and unassign authorize on the
  assignment's client, not the program's coach.

### Hidden flag

`hidden boolean not null default false` on programs, workouts, and exercise_library.
A hidden item is visible to coaches but cannot be assigned and is excluded from every
client-facing surface. Its purpose is drafts and internal-only items.

### Save instance as template / variation

- RPC copies an instance back to a new template, stripping client-specific data:
  assigned loads and client-specific notes. Structure and prescription are kept.
- Two modes: **new** (no parent) or **variation of X** (`variation_of` set). Default
  parent is the template the instance was cloned from; the coach may change or clear it.
- Works for a whole program and for a single workout day.
- Saved templates default to `hidden = true` until the coach reviews them.
- `variation_of` always points at the **root** template (one level only).
  A variation of a variation attaches to the root.
- If a parent is archived, its variations are shown at top level.
- Variations are ordinary templates. They do not track or drift from their parent.

### Provenance columns

- `source_program_id` / `source_workout_id` on instances: the template they were
  cloned from.
- `variation_of` on templates: grouping only.

### Attribution (trimmed)

- `created_by uuid references coaches(id)` on **programs and workouts only**. Not on
  exercise_library, and not needed on instances (the client's coach is known).
- Rendered as one small muted "by Name" in the row meta line, including nested
  variations. Resolved by join, not snapshot; coaches are soft-deleted so it always
  resolves. No badge or avatar.
- **Filter by author** in the programs and workouts template lists: a coach picker
  (all coaches, plus "Mine"), applied to `created_by`. Variations follow their root
  template, so a root that matches keeps its nested children visible, and a
  variation that matches surfaces under its parent. Add an index on `created_by`
  (or filter client-side; the pool is small).
- Templates with NULL `created_by` (admin-made, backfilled) are only reachable
  under the unfiltered view.
- Still out of scope: snapshots, admin-only views.
- Coach-only. See the client-response allowlist below.

## Library UI

Variations nest under their parent (collapsible, with a count on the parent).
Hidden items are visibly marked for coaches.

## Client-facing safeguards (required)

`programWithDetails` and `workoutWithDetails` use `select('*')` and
`GET /programs/client/assigned` returns their output unchanged, so every new column
would reach clients automatically. Before shipping:

- Build an explicit allowlist for client responses that excludes `created_by`,
  `source_*`, `variation_of`, `hidden`, `is_template`, and `client_id` internals.
- Exclude attribution from client-format PDFs (`?format=client`, the default) and the
  client log-sheet PDFs.
- Add a backend test asserting the client endpoints contain none of those fields, so
  a future `select('*')` cannot re-leak them.

## Migration

One new numbered migration (never edit applied ones): the columns above, the clone
and save-as-template RPCs (service_role execute only, matching existing RPCs),
loosened `save_program` ownership check (`p_is_admin or coach_id is null or
coach_id = p_coach_id` no longer applies to templates), and a backfill of
`created_by` from existing `coach_id` (admin-made `coach_id IS NULL` workouts keep
NULL and show no name).

## Decision: existing live-linked assignments (resolved 2026-09-29)

Workout logs reference `program_assignment_id`, `program_day_id`,
`workout_assignment_id`, and `source_workout_id`, and load rows are keyed by
`workout_exercise_id` with a trigger validating them against the workout's
exercises. Cloning existing assignments would mean repointing all of that, which
is risky for in-flight client history.

Owner decision: **no backfill.** Existing assignments stay live-linked (legacy) and
keep working unchanged. Only new assignments clone.

**Legacy 409 guard:** editing (`PUT`) or archiving a template that has any active
legacy live-linked assignment (`program_assignments` / `workout_assignments` rows
with `archived = false` pointing at it, where the target is a template) returns
`409` with a message directing the coach to "Save as variation" instead. This
keeps legacy clients' plans from changing underneath them. The guard disappears on
its own as legacy assignments are unassigned or completed. Instances created by the
new clone flow never trigger it.

Implementation notes:
- Determine "legacy" as an active assignment whose program/workout has
  `is_template = true`. New clones point at `is_template = false` rows.
- The check runs server-side in the route before calling `save_workout` /
  `save_program`, and inside the archive handlers.
- Before shipping, count active legacy assignments on hosted data
  (`supabase migration list --linked` first to confirm hosted state) so the
  coaches know which templates will be locked.

## Tests

- Clone: template unchanged after assign and after instance edit; instance edits do
  not touch the template; atomic on failure.
- Authorization: coach cannot assign to another coach's client, cannot read or edit
  another coach's instance; admin can.
- Hidden templates cannot be assigned.
- Save-as-template strips loads/client notes; variation root flattening; archived
  parent promotion.
- Client responses contain no attribution/provenance fields (regression test).
- Legacy guard: editing or archiving a template with active legacy assignments returns 409; a template with only clone-instances does not.
