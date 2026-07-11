-- Development-only rollback for the CVF PT empty-project baseline.
-- Do not run after any business data exists. Verify every table is empty first.

begin;

drop function if exists public.create_waiver_version(text);
drop function if exists public.save_program(uuid, uuid, boolean, text, text, integer, jsonb);
drop function if exists public.save_workout(uuid, uuid, text, text, text, jsonb);
drop function if exists public.record_manual_purchase(uuid, uuid, numeric, uuid);
drop function if exists public.complete_purchase(uuid);
drop function if exists public.complete_session(uuid);
drop function if exists public.approve_booking(uuid);
drop function if exists public.commit_program_import(uuid, text, jsonb);

drop table if exists public.credit_transactions;
drop table if exists public.client_credits;
drop table if exists public.purchases;
drop table if exists public.packages;
drop table if exists public.waiver_signatures;
drop table if exists public.waiver_versions;
drop table if exists public.booking_requests;
drop table if exists public.messages;
drop table if exists public.program_assignments;
drop table if exists public.program_exercises;
drop table if exists public.workout_assignments;
drop table if exists public.program_days;
drop table if exists public.workout_exercises;
drop table if exists public.workouts;
drop table if exists public.exercise_library;
drop table if exists public.programs;
drop table if exists public.check_ins;
drop table if exists public.metric_entries;
drop table if exists public.metrics;
drop table if exists public.session_notes;
drop table if exists public.sessions;
drop table if exists public.clients;
drop table if exists public.coaches;

commit;

-- The baseline's least-privilege default function grants and revocation on the
-- pre-existing rls_auto_enable() helper are intentionally retained.
