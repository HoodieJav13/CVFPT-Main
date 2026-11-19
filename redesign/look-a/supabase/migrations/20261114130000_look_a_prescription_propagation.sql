-- Look A, part 2 (local, 2026-11-14): the two prescription facts
-- (prescribed_load_max, per_side) travel through every other path that writes
-- or reads a prescription. Forward-only; 20261114120000 is unchanged.
--
--   1. commit_program_import: a draft row's load, unit, upper load and per side.
--   2. Workout Rescue: the original shows them only when set (saved plans
--      stay current), and an assignment override, a single number, drops the
--      upper load from the visible copy.
--   3. Coach-planned backups gain an upper load and per side.
--   4. activate_workout_substitution / apply_program_substitution: the
--      replacement's facts come from the replacement targets only, never from
--      the replaced exercise.
--   5. get_workout_exercise_history_v3: v2 plus the prescription each
--      performed occurrence was logged against (load, unit, upper load, per
--      side), so history can say "per side" and show a range truthfully.
-- Every function keeps SECURITY INVOKER, an empty search_path and
-- service-role-only execute. No RLS policy is added.

-- ---------- 1. Import ----------
create or replace function public.commit_program_import(
  p_coach_id uuid,
  p_source text,
  p_draft jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_workout_id uuid;
  v_exercise_id uuid;
  v_day jsonb;
  v_exercise jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
  v_warnings jsonb := coalesce(p_draft #> '{import_meta,warnings}', '[]'::jsonb);
  v_program_name text := btrim(coalesce(p_draft #>> '{program,name}', ''));
  v_frequency integer := (p_draft #>> '{program,frequency_days}')::integer;
  v_day_count integer := jsonb_array_length(coalesce(p_draft -> 'days', '[]'::jsonb));
  v_normalized_name text;
  v_video_url text;
  v_mode text;
  v_load numeric;
  v_load_max numeric;
begin
  if v_program_name = '' then
    raise exception 'Program name is required';
  end if;
  if v_frequency is null or v_frequency < 1 or v_frequency > 5 then
    raise exception 'Program frequency must be between 1 and 5';
  end if;
  if v_day_count <> v_frequency then
    raise exception 'Program day count must match frequency';
  end if;

  -- Serialize normalized-name lookup/insert so concurrent imports cannot
  -- create duplicate exercise_library rows.
  perform pg_advisory_xact_lock(hashtextextended('cvf_exercise_library', 0));

  insert into public.programs (coach_id, name, description, frequency_days)
  values (
    p_coach_id,
    v_program_name,
    nullif(p_draft #>> '{program,description}', ''),
    v_frequency
  )
  returning id into v_program_id;

  for v_day in select * from jsonb_array_elements(p_draft -> 'days')
  loop
    insert into public.workouts (coach_id, name, description, goal)
    values (
      p_coach_id,
      coalesce(nullif(v_day ->> 'name', ''), 'Day ' || (v_day ->> 'day_number')),
      nullif(v_day ->> 'notes', ''),
      nullif(v_day ->> 'goal', '')
    )
    returning id into v_workout_id;

    for v_exercise in
      select * from jsonb_array_elements(coalesce(v_day -> 'exercises', '[]'::jsonb))
    loop
      v_exercise_id := null;
      v_normalized_name := regexp_replace(
        lower(btrim(coalesce(v_exercise ->> 'name', ''))),
        '\s+',
        ' ',
        'g'
      );
      if v_normalized_name = '' then
        raise exception 'Exercise name is required';
      end if;

      if nullif(v_exercise ->> 'exercise_library_id', '') is not null then
        begin
          select id into v_exercise_id
          from public.exercise_library
          where id = (v_exercise ->> 'exercise_library_id')::uuid
            and archived = false;
        exception
          when invalid_text_representation then
            raise exception 'Selected exercise is invalid';
        end;
        if v_exercise_id is null then
          raise exception 'Selected exercise is unavailable';
        end if;
      else
        select id into v_exercise_id
        from public.exercise_library
        where archived = false
          and regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') = v_normalized_name
        order by created_at asc
        limit 1;
      end if;

      if v_exercise_id is null then
        insert into public.exercise_library (
          name,
          category,
          equipment,
          primary_muscle,
          video_url,
          notes,
          source,
          review_status
        )
        values (
          btrim(v_exercise ->> 'name'),
          nullif(v_exercise ->> 'category', ''),
          nullif(v_exercise ->> 'equipment', ''),
          nullif(v_exercise ->> 'primary_muscle', ''),
          nullif(v_exercise ->> 'video_url', ''),
          nullif(v_exercise ->> 'client_notes', ''),
          p_source,
          'needs_review'
        )
        returning id into v_exercise_id;
        v_created := v_created || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      else
        v_reused := v_reused || jsonb_build_array(
          jsonb_build_object('id', v_exercise_id, 'name', btrim(v_exercise ->> 'name'))
        );
      end if;

      -- Demo reference: an explicit draft mode is kept (NULL = an unclassified
      -- legacy copy); an old draft shape treats a per-row link as an explicit
      -- override and no link as inheriting the (always linked) library demo.
      v_video_url := nullif(v_exercise ->> 'video_url', '');
      v_mode := case
        when v_exercise ? 'video_link_mode' then nullif(v_exercise ->> 'video_link_mode', '')
        when nullif(btrim(coalesce(v_video_url, '')), '') is not null then 'override'
        when v_video_url is null then 'inherit'
        else null end;
      if v_mode is not null and v_mode not in ('inherit', 'override') then
        raise exception 'Invalid demo link mode' using errcode = '22023';
      end if;

      -- Look A: the load, its unit, the optional upper load and per side come
      -- from the draft row itself. An upper load equal to the load is the
      -- single number (stored as no range); a lower one is refused by
      -- look_a_load_range with nothing saved.
      v_load := nullif(v_exercise ->> 'default_load_value', '')::numeric;
      v_load_max := nullif(v_exercise ->> 'prescribed_load_max', '')::numeric;
      if v_load_max is not null and v_load_max = v_load then v_load_max := null; end if;

      insert into public.workout_exercises (
        workout_id,
        exercise_library_id,
        custom_name,
        sets,
        reps,
        rest,
        tempo,
        notes,
        client_notes,
        coach_notes,
        video_url,
        position, tracking_type, duration_value, duration_unit, distance_value, distance_unit,
        video_link_mode,
        default_load_value, default_load_unit, prescribed_load_max, per_side
      )
      values (
        v_workout_id,
        v_exercise_id,
        btrim(v_exercise ->> 'name'),
        nullif(v_exercise ->> 'sets', ''),
        nullif(v_exercise ->> 'reps', ''),
        nullif(v_exercise ->> 'rest', ''),
        nullif(v_exercise ->> 'tempo', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'client_notes', ''),
        nullif(v_exercise ->> 'coach_notes', ''),
        v_video_url,
        coalesce((
          select count(*)
          from public.workout_exercises
          where workout_id = v_workout_id
        ), 0),
        coalesce(v_exercise ->> 'tracking_type', 'reps_weight'), nullif(v_exercise ->> 'duration_value', '')::numeric, nullif(v_exercise ->> 'duration_unit', ''), nullif(v_exercise ->> 'distance_value', '')::numeric, nullif(v_exercise ->> 'distance_unit', ''),
        v_mode,
        v_load, case when v_load is null then null else coalesce(nullif(v_exercise ->> 'default_load_unit', ''), 'lb') end,
        v_load_max, coalesce((v_exercise ->> 'per_side')::boolean, false)
      );
    end loop;

    insert into public.program_days (program_id, day_number, workout_id, notes)
    values (
      v_program_id,
      (v_day ->> 'day_number')::integer,
      v_workout_id,
      nullif(v_day ->> 'notes', '')
    );
  end loop;

  return jsonb_build_object(
    'program_id', v_program_id,
    'created_exercises', v_created,
    'reused_exercises', v_reused,
    'warnings', v_warnings
  );
end;
$$;

-- ---------- 2. Rescue ----------
create or replace function public.workout_rescue_original(p_program_id uuid,p_day_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('program_id',p.id,'program_name',p.name,'program_description',p.description,'frequency_days',p.frequency_days,'day_number',d.day_number,'day_id',d.id,'day_notes',d.notes,
 'workout',jsonb_build_object('id',w.id,'updated_at',w.updated_at,'name',w.name,'description',w.description,'goal',w.goal,'exercises',coalesce((
  select jsonb_agg(jsonb_build_object('id',e.id,'exercise_library_id',e.exercise_library_id,'custom_name',e.custom_name,
   'library_exercise',jsonb_build_object('name',l.name,'equipment',l.equipment,'updated_at',l.updated_at),'sets',e.sets,'reps',e.reps,'target_rpe',e.target_rpe,
   'default_load_value',e.default_load_value,'default_load_unit',e.default_load_unit,'rest',e.rest,'rest_seconds',e.rest_seconds,
   'tempo',e.tempo,'client_notes',coalesce(e.client_notes,e.notes),'tracking_type',e.tracking_type,
   'duration_value',e.duration_value,'duration_unit',e.duration_unit,'distance_value',e.distance_value,'distance_unit',e.distance_unit,
   'superset_group',e.superset_group,'position',e.position)
   -- Look A: present only when set, so a plan saved before them stays current.
   || case when e.prescribed_load_max is not null then jsonb_build_object('prescribed_load_max',e.prescribed_load_max) else '{}'::jsonb end
   || case when e.per_side then jsonb_build_object('per_side',true) else '{}'::jsonb end
   order by e.position,e.id)
  from public.workout_exercises e left join public.exercise_library l on l.id=e.exercise_library_id where e.workout_id=w.id and not e.archived),'[]'::jsonb)))
 from public.programs p join public.program_days d on d.program_id=p.id join public.workouts w on w.id=d.workout_id
 where p.id=p_program_id and d.id=p_day_id and not p.archived and not d.archived and not w.archived;
$$;

create or replace function public.read_workout_rescue(p_program_id uuid,p_day_id uuid,p_auth_id uuid,p_assignment_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o jsonb; v text; plan public.workout_rescue_plans; loads jsonb:='[]'; visible jsonb;
begin
 perform public.workout_rescue_access(p_program_id,p_day_id,p_auth_id,p_assignment_id,false);
 o:=public.workout_rescue_original(p_program_id,p_day_id);v:='rescue-'||md5(o::text);
 select * into plan from public.workout_rescue_plans where program_day_id=p_day_id;
 if p_assignment_id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('source_id',workout_exercise_id,'load_value',load_value,'load_unit',load_unit) order by workout_exercise_id),'[]') into loads
  from public.program_assignment_exercise_loads where program_assignment_id=p_assignment_id and program_day_id=p_day_id and not archived;
 end if;
 select coalesce(jsonb_agg(case when x.value is null then e.value else (e.value-'prescribed_load_max')||jsonb_build_object('default_load_value',x.value->'load_value','default_load_unit',x.value->'load_unit') end order by e.ordinality),'[]') into visible
 from jsonb_array_elements(o#>'{workout,exercises}') with ordinality e(value,ordinality)
 left join lateral (select value from jsonb_array_elements(loads) where value->>'source_id'=e.value->>'id' limit 1) x on true;
 return jsonb_build_object('original',jsonb_set(o,'{workout,exercises}',visible),'current_version',v,
 'selection_version',md5(jsonb_build_object('original',o,'loads',loads,'assignment',p_assignment_id)::text),
 'stale',plan.program_day_id is not null and plan.original_version<>v,
 'plan',jsonb_build_object('version',coalesce(plan.original_version,v),'revision',coalesce(plan.revision,0),'branches',coalesce(plan.branches,'[]'::jsonb)));
end; $$;

-- ---------- 3. Coach-planned backups ----------
alter table public.workout_exercise_backups
  add column target_load_max numeric
    constraint workout_exercise_backups_target_load_max_check check (target_load_max is null or target_load_max >= 0),
  add column target_per_side boolean not null default false;
alter table public.workout_exercise_backups
  add constraint workout_exercise_backups_load_range_check
    check (target_load_max is null or (target_load_value is not null and target_load_max > target_load_value));

-- ---------- 4. Substitutions ----------
create or replace function public.activate_workout_substitution(p_sub_id uuid, p_create_sets boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_sub public.workout_log_substitutions;
  v_original public.workout_log_exercises;
  v_sets integer;
  v_load numeric;
  v_unit text;
  v_max numeric;
  i integer;
begin
  select * into v_sub from public.workout_log_substitutions where id = p_sub_id for update;
  if exists (select 1 from public.workout_log_exercises where id = v_sub.replacement_log_exercise_id) then return; end if;
  select * into v_original from public.workout_log_exercises where id = v_sub.original_log_exercise_id;
  v_sets := nullif(v_sub.targets ->> 'sets', '')::integer;
  v_load := nullif(v_sub.targets ->> 'load_value', '')::numeric;
  v_unit := case when v_load is null then null else coalesce(nullif(v_sub.targets ->> 'load_unit', ''), 'lb') end;
  -- Look A: the replacement's own prescription (never the original's): an
  -- upper load only above the replacement load, per side only when asked.
  v_max := nullif(v_sub.targets ->> 'load_max', '')::numeric;
  if v_load is null or v_max is null or v_max <= v_load then v_max := null; end if;
  insert into public.workout_log_exercises (
    id, workout_log_id, source_workout_exercise_id, exercise_library_id, exercise_name,
    prescribed_sets, prescribed_reps, prescribed_load_value, prescribed_load_unit, position,
    superset_group, tracking_type, substitutes_log_exercise_id, substitution_id, prescribed_load_max, per_side
  ) values (
    v_sub.replacement_log_exercise_id, v_sub.workout_log_id, null, v_sub.replacement_exercise_library_id, v_sub.replacement_name,
    v_sets::text, nullif(v_sub.targets ->> 'reps', ''), v_load, v_unit, v_original.position,
    null, 'reps_weight', v_original.id, v_sub.id, v_max, coalesce((v_sub.targets ->> 'per_side')::boolean, false)
  );
  -- A client that logs offline adds its own sets (client_operation_id), so it asks
  -- for none here; coach approvals create the confirmed target sets.
  if v_sets is not null and p_create_sets then
    for i in 1..v_sets loop
      insert into public.workout_log_sets (workout_log_exercise_id, set_number, set_origin, status, actual_load_value, actual_load_unit)
      values (v_sub.replacement_log_exercise_id, i, 'prescribed', 'pending', v_load, v_unit);
    end loop;
  end if;
end;
$$;

create or replace function public.apply_program_substitution(
  p_application_id uuid, p_assignment_id uuid, p_substitution_id uuid, p_coach_id uuid,
  p_expected_ids uuid[], p_targets jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing public.program_substitution_applications;
  v_sub public.workout_log_substitutions;
  v_program public.programs;
  v_ids uuid[];
  v_affected jsonb;
  r record;
  v_load numeric;
  v_max numeric;
begin
  select * into v_existing from public.program_substitution_applications where id = p_application_id;
  if found then return jsonb_build_object('outcome', 'replayed', 'application', to_jsonb(v_existing)); end if;
  select * into v_sub from public.workout_log_substitutions where id = p_substitution_id and status = 'active';
  if not found then raise exception 'Substitution not active'; end if;
  select p.* into v_program from public.program_assignments pa join public.programs p on p.id = pa.program_id
  where pa.id = p_assignment_id and pa.client_id = v_sub.client_id and not pa.archived for update of p;
  if not found then raise exception 'Program assignment not found'; end if;
  if v_program.is_template or v_program.client_id is distinct from v_sub.client_id then
    raise exception 'shared_program: this assignment still uses shared template workouts; edit it in the program builder';
  end if;
  -- Serialize on the physical rows this application would change. A private
  -- workout may be shared by several of the client's programs, so the
  -- program lock alone does not cover it. Rows are locked in id order (no
  -- deadlock between applications); a waiter then re-reads committed state.
  perform 1 from public.workout_exercises we where we.id = any(p_expected_ids) order by we.id for update;
  -- The same application may have committed while this one waited: replay it.
  select * into v_existing from public.program_substitution_applications where id = p_application_id;
  if found then return jsonb_build_object('outcome', 'replayed', 'application', to_jsonb(v_existing)); end if;
  -- The preview lists one entry per program day (a reused workout appears
  -- once per day); it must still match exactly.
  select coalesce(array_agg(t.workout_exercise_id order by t.workout_exercise_id), '{}') into v_ids
  from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t;
  if v_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_expected_ids) x) then
    raise exception 'preview_mismatch';
  end if;
  -- Audit every day the change affects, read before anything is archived.
  select coalesce(jsonb_agg(jsonb_build_object('workout_exercise_id', t.workout_exercise_id, 'day_number', t.day_number, 'workout_name', t.workout_name)
           order by t.day_number, t.workout_exercise_id), '[]'::jsonb) into v_affected
  from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t;
  v_load := nullif(p_targets ->> 'load_value', '')::numeric;
  -- Look A: the replacement prescription's own upper load and per side, from
  -- the coach's targets only; the replaced exercise's facts never carry over.
  v_max := nullif(p_targets ->> 'load_max', '')::numeric;
  if v_load is null or v_max is null or v_max <= v_load then v_max := null; end if;
  -- Mutate each physical workout exercise exactly once.
  for r in select distinct t.workout_exercise_id
           from public.program_substitution_targets(p_assignment_id, v_sub.original_exercise_library_id, v_sub.original_name) t loop
    insert into public.workout_exercises (workout_id, exercise_library_id, custom_name, sets, reps, rest, tempo,
      default_load_value, default_load_unit, position, superset_group, tracking_type, prescribed_load_max, per_side)
    select we.workout_id, v_sub.replacement_exercise_library_id, null,
      nullif(p_targets ->> 'sets', ''), nullif(p_targets ->> 'reps', ''), we.rest, null,
      v_load, case when v_load is null then null else coalesce(nullif(p_targets ->> 'load_unit', ''), 'lb') end,
      we.position, we.superset_group, 'reps_weight', v_max, coalesce((p_targets ->> 'per_side')::boolean, false)
    from public.workout_exercises we where we.id = r.workout_exercise_id and not we.archived;
    update public.program_assignment_exercise_loads set archived = true where workout_exercise_id = r.workout_exercise_id and not archived;
    update public.workout_exercises set archived = true where id = r.workout_exercise_id;
  end loop;
  insert into public.program_substitution_applications (id, program_assignment_id, substitution_id, coach_id, affected, targets)
  values (p_application_id, p_assignment_id, p_substitution_id, p_coach_id, v_affected, coalesce(p_targets, '{}'::jsonb))
  returning * into v_existing;
  return jsonb_build_object('outcome', 'applied', 'application', to_jsonb(v_existing));
end;
$$;

-- ---------- 5. History ----------
create function public.get_workout_exercise_history_v3(
  p_client_id uuid,
  p_exercise_library_id uuid,
  p_source_workout_exercise_id uuid,
  p_before_completed_at timestamptz default null,
  p_before_log_id uuid default null,
  p_occurrence_limit integer default 11
)
returns table (
  workout_log_id uuid,
  completed_at timestamptz,
  exercise_name text,
  set_number integer,
  actual_load_value numeric,
  actual_load_unit text,
  actual_reps integer,
  actual_rpe numeric,
  tracking_type text,
  actual_duration_value numeric, actual_duration_unit text,
  actual_distance_value numeric, actual_distance_unit text,
  workout_log_exercise_id uuid,
  prescribed_load_value numeric, prescribed_load_unit text, prescribed_load_max numeric, per_side boolean
)
language sql
security invoker
set search_path = ''
as $$
  with occurrences as (
    select l.id, l.completed_at
    from public.workout_logs l
    where l.client_id = p_client_id
      and l.status = 'completed'
      and l.archived = false
      and (p_before_completed_at is null or (l.completed_at, l.id) < (p_before_completed_at, p_before_log_id))
      and exists (
        select 1 from public.workout_log_exercises e
        join public.workout_log_sets s on s.workout_log_exercise_id = e.id
          and s.archived = false and s.status = 'completed'
        where e.workout_log_id = l.id and e.archived = false
          and ((p_exercise_library_id is not null and e.exercise_library_id = p_exercise_library_id)
            or (p_exercise_library_id is null and p_source_workout_exercise_id is not null
              and e.exercise_library_id is null and e.source_workout_exercise_id = p_source_workout_exercise_id))
      )
    order by l.completed_at desc, l.id desc
    limit greatest(1, least(p_occurrence_limit, 11))
  )
  select o.id, o.completed_at, e.exercise_name, s.set_number,
    s.actual_load_value, s.actual_load_unit, s.actual_reps, s.actual_rpe,
    e.tracking_type, s.actual_duration_value, s.actual_duration_unit, s.actual_distance_value, s.actual_distance_unit, e.id,
    e.prescribed_load_value, e.prescribed_load_unit, e.prescribed_load_max, e.per_side
  from occurrences o
  join public.workout_log_exercises e on e.workout_log_id = o.id and e.archived = false
    and ((p_exercise_library_id is not null and e.exercise_library_id = p_exercise_library_id)
      or (p_exercise_library_id is null and p_source_workout_exercise_id is not null
        and e.exercise_library_id is null and e.source_workout_exercise_id = p_source_workout_exercise_id))
  join public.workout_log_sets s on s.workout_log_exercise_id = e.id
    and s.archived = false and s.status = 'completed'
  order by o.completed_at desc, o.id desc, e.id desc, s.set_number asc;
$$;

-- ---------- Grants ----------
revoke all on function public.commit_program_import(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_program_import(uuid, text, jsonb) to service_role;
revoke all on function public.workout_rescue_original(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workout_rescue_original(uuid, uuid) to service_role;
revoke all on function public.read_workout_rescue(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_workout_rescue(uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.activate_workout_substitution(uuid, boolean) from public, anon, authenticated;
grant execute on function public.activate_workout_substitution(uuid, boolean) to service_role;
revoke all on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_program_substitution(uuid, uuid, uuid, uuid, uuid[], jsonb) to service_role;
revoke all on function public.get_workout_exercise_history_v3(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_workout_exercise_history_v3(uuid, uuid, uuid, timestamptz, uuid, integer) to service_role;
