# Look A — prototype field mapping (local, 2026-11-14)

Local build only. Nothing here is applied to a hosted database, pushed or
published. Prototype: `fable-redesign/pt` at 96fdcf66 (read only).

| Prototype field | CVF PT source | Notes |
|---|---|---|
| `x_prescribed_load_max` | `workout_exercises.prescribed_load_max`, snapshotted to `workout_log_exercises.prescribed_load_max` (migration 20261114120000); carried by import, Rescue, coach backups, swaps and history (20261114130000) | Same unit as the lower load; equal upper = single number. General authored bound: finite, ≥ 0. Substitution targets keep their 2000 cap. |
| `x_per_side` | `workout_exercises.per_side` → `workout_log_exercises.per_side` | Boolean; shown in words ("per side"). |
| `x_last_time` | `GET /workout-logs/:id/exercises/:exerciseId/history` (v3 adds the prescription each occurrence was logged against) | Same set number only (`lookA.lastTimeSet`): Focus Last column and each set row ("Last time, set 2: 170 lb × 4"); an em dash when that set was not done; recorded unit kept (kg stays kg). Never fills a value by itself. |
| `x_not_set_tracked` | `workout_log_exercises.not_set_tracked` (exercise Quick Complete) and `workout_logs.not_set_tracked` (Finish with no logged set) | One flag; sets are never written. Outlined teal tick. Not counted as volume or a PR. |
| `x_swapped_from` | `workout_log_exercises.substitutes_log_exercise_id` → the original's name | Only a real recorded substitution. |
| `x_client_plan` | The existing per-set drafts and queued outbox writes on this device | Never sent as a new server field. |
| `x_rest_over_seconds` | Derived from the stored rest deadline and the clock | The expired deadline is kept until dismissed. |

## Undo

One revision-checked inverse per workout (`workout_material_changes`), kept
until the next successful material change by anyone. The server decides
eligibility (`look_a_undo_blocker`); `GET /workout-logs/:id/undo` recovers it
after a reload or on another device. Undo requests go through the outbox with a
stable event id, so a lost reply or retry never undoes twice.

## Lock order (all Look A writers)

Event advisory lock → client KEY SHARE → workout → exercise/sets. Start/resume
keeps its own client-first order (LOOK-A-START-RACE-REVIEW.md; migrations
20261114140000, 20261114150000).

## Focus panel (tracker)

The active exercise card leads with one focused set: same-set Last/Today
rows, "Set n of N · Coach asked" with the rep and load range large, and one
primary action that is always truthful: the values already entered (the set
row's own write), else the existing guarded "same as set N" repeat, else
"Enter set N" (logs nothing). The per-set editor stays below as secondary.
There is no bulk "Complete all remaining" in the Look A tracker.

## Coach queue

Needs a look (every existing action, same order), Missed (attention rows with
the existing `low_adherence` reason: past-due dated workouts, at least 3
eligible, last 30 days) and On track, which is never derived: CVF PT has no
on-track measure, so it shows an em dash and says so. Unknown trend data shows
an em dash for Missed with the existing partial note. Counts are items shown,
not clients; the 12-item cut is stated. No weekly cohorts or program-review
dates are invented (the prototype's coach data is fictional).
