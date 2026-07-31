-- ============================================================
-- Structured rest (roadmap Track 4, item 12).
--
-- Rest periods were free text ("90s", "2 min", "1:30") that the tracker
-- re-parsed at runtime to start the rest timer; the database never knew
-- the number and unparseable text failed silently. This migration makes
-- the number first-class:
--
--   1. parse_rest_seconds(text): SQL port of the frontend parseRest
--      rules (clock "M:SS", unit suffixes, bare digits; anything else,
--      or out of the sane 0..36000s range, is null).
--   2. workout_exercises.rest_seconds + workout_log_exercises.
--      prescribed_rest_seconds columns.
--   3. One-time backfill from the existing text. Completed logs are
--      deliberately excluded: their snapshots are immutable history
--      (prevent_completed_workout_exercise_change) and nothing reads a
--      timer from them.
--   4. Fill triggers so every writer stays consistent — the builder RPC,
--      the paste importer, and the start_workout_log snapshot (which
--      copies the source exercise's rest_seconds when present) — without
--      redefining any of those functions. An explicitly provided value
--      always wins; the trigger only fills nulls.
-- ============================================================

create or replace function public.parse_rest_seconds(p_text text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := lower(btrim(coalesce(p_text, '')));
  v_clock text[];
  v_minutes text[];
  v_seconds text[];
  v_total numeric := 0;
  v_found boolean := false;
  v_result integer;
begin
  if v_text = '' then
    return null;
  end if;
  v_clock := regexp_match(v_text, '^(\d+):(\d{1,2})$');
  if v_clock is not null then
    v_result := (v_clock[1])::integer * 60 + (v_clock[2])::integer;
    return case when v_result between 0 and 36000 then v_result else null end;
  end if;
  v_minutes := regexp_match(v_text, '([\d.]+)\s*(?:m|min|mins|minute|minutes)');
  v_seconds := regexp_match(v_text, '([\d.]+)\s*(?:s|sec|secs|second|seconds)');
  if v_minutes is not null then
    v_total := v_total + ((v_minutes[1])::numeric * 60);
    v_found := true;
  end if;
  if v_seconds is not null then
    v_total := v_total + (v_seconds[1])::numeric;
    v_found := true;
  end if;
  if not v_found then
    if v_text ~ '^\d+$' then
      v_total := v_text::numeric;
    else
      return null;
    end if;
  end if;
  v_result := round(v_total)::integer;
  return case when v_result between 0 and 36000 then v_result else null end;
exception when others then
  -- Malformed numerics ("9999999999999 min") parse to "no structured rest".
  return null;
end;
$$;

alter table public.workout_exercises
  add column if not exists rest_seconds integer
  check (rest_seconds is null or (rest_seconds >= 0 and rest_seconds <= 36000));

alter table public.workout_log_exercises
  add column if not exists prescribed_rest_seconds integer
  check (prescribed_rest_seconds is null or (prescribed_rest_seconds >= 0 and prescribed_rest_seconds <= 36000));

-- ---------- One-time backfill ----------
update public.workout_exercises
set rest_seconds = public.parse_rest_seconds(rest)
where rest_seconds is null and rest is not null;

-- Only logs that are still mutable; completed snapshots are immutable
-- history and the timer never reads them.
update public.workout_log_exercises wle
set prescribed_rest_seconds = public.parse_rest_seconds(wle.prescribed_rest)
from public.workout_logs wl
where wl.id = wle.workout_log_id
  and wl.status <> 'completed'
  and wle.prescribed_rest_seconds is null
  and wle.prescribed_rest is not null;

-- ---------- Fill triggers ----------
-- Insert: fill a missing rest_seconds from text. Update: an explicitly
-- changed rest_seconds always wins; otherwise a changed rest text
-- RE-derives rest_seconds — an UPDATE carries the old (backfilled)
-- seconds forward implicitly, so "fill only when null" would let edited
-- text ("90s" -> "120s") leave stale seconds behind for new snapshots.
create or replace function public.fill_workout_exercise_rest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.rest_seconds is null then
      new.rest_seconds := public.parse_rest_seconds(new.rest);
    end if;
  elsif new.rest_seconds is distinct from old.rest_seconds then
    null; -- explicit change wins as provided
  elsif new.rest is distinct from old.rest or new.rest_seconds is null then
    new.rest_seconds := public.parse_rest_seconds(new.rest);
  end if;
  return new;
end;
$$;

drop trigger if exists fill_workout_exercise_rest on public.workout_exercises;
create trigger fill_workout_exercise_rest
before insert or update on public.workout_exercises
for each row execute function public.fill_workout_exercise_rest();

create or replace function public.fill_workout_log_exercise_rest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.prescribed_rest_seconds is null then
      if new.source_workout_exercise_id is not null then
        select rest_seconds into new.prescribed_rest_seconds
        from public.workout_exercises
        where id = new.source_workout_exercise_id;
      end if;
      if new.prescribed_rest_seconds is null then
        new.prescribed_rest_seconds := public.parse_rest_seconds(new.prescribed_rest);
      end if;
    end if;
  elsif new.prescribed_rest_seconds is distinct from old.prescribed_rest_seconds then
    null; -- explicit change wins as provided
  elsif new.prescribed_rest is distinct from old.prescribed_rest or new.prescribed_rest_seconds is null then
    new.prescribed_rest_seconds := public.parse_rest_seconds(new.prescribed_rest);
  end if;
  return new;
end;
$$;

drop trigger if exists fill_workout_log_exercise_rest on public.workout_log_exercises;
create trigger fill_workout_log_exercise_rest
before insert or update on public.workout_log_exercises
for each row execute function public.fill_workout_log_exercise_rest();

revoke execute on function public.parse_rest_seconds(text) from public, anon, authenticated;
grant execute on function public.parse_rest_seconds(text) to service_role;

select 'structured rest ready' as result;
