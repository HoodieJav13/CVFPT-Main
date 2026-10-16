-- A6 (sequential): independent idempotent shared-studio-library save.
do $$
declare
  c1 uuid := 'b1000000-0000-4000-8000-000000000001';
  c2 uuid := 'b1000000-0000-4000-8000-000000000002';
  k1 uuid := 'b2000000-0000-4000-8000-000000000001';
  r jsonb; s jsonb; s2 jsonb; a uuid; w uuid; t uuid; templates_before int;
begin
  r := public.create_quick_session(c1, k1, 'c1000000-0000-4000-8000-000000000001', pg_temp.h('lib'), '2031-03-05', 'Library me', null, pg_temp.body('Side plank'));
  a := (r ->> 'assignment_id')::uuid; w := (r ->> 'workout_id')::uuid;
  insert into public.workout_assignment_exercise_loads (workout_assignment_id, workout_exercise_id, load_value, load_unit)
  select a, id, 150, 'lb' from public.workout_exercises where workout_id = w and exercise_library_id is not null;
  select count(*) into templates_before from public.workouts where is_template;

  -- Failure rolls back only the clone and pointer: the session stays intact.
  begin
    create function public.quick_fail_template() returns trigger language plpgsql as 'begin if new.is_template then raise exception ''injected template failure''; end if; return new; end';
    create trigger quick_fail_template before insert on public.workouts for each row execute function public.quick_fail_template();
    perform public.save_quick_session_to_library(c1, a);
    raise exception 'template failure did not fire';
  exception when raise_exception then if sqlerrm <> 'injected template failure' then raise; end if; end;
  perform pg_temp.assert((select library_template_id is null and not archived from public.workout_assignments where id = a)
    and (select count(*) = templates_before from public.workouts where is_template)
    and (select count(*) = 2 from public.workout_exercises where workout_id = w and not archived), 'A6 template failure leaves the session intact and the pointer null');

  s := public.save_quick_session_to_library(c1, a);
  t := (s ->> 'template_id')::uuid;
  perform pg_temp.assert(s ->> 'state' = 'saved' and t is not null, 'A6 first save creates one template');
  perform pg_temp.assert((select is_template and hidden and client_id is null and created_by = c1 and coach_id = c1 and source_workout_id = w and name = 'Library me'
    from public.workouts where id = t), 'A6 hidden shared studio template, attributed to the actor');
  perform pg_temp.assert((select count(*) = 2 and bool_and(coach_notes is null) and bool_and(default_load_value is null)
    from public.workout_exercises where workout_id = t and not archived), 'A6 client-specific loads and coach notes are stripped');
  perform pg_temp.assert((select library_template_id = t from public.workout_assignments where id = a), 'A6 pointer set atomically');
  s2 := public.save_quick_session_to_library(c1, a);
  perform pg_temp.assert(s2 = jsonb_build_object('state', 'replayed', 'template_id', t)
    and (select count(*) = templates_before + 1 from public.workouts where is_template), 'A6 retry returns the one committed pointer');
  begin
    perform public.assign_workout_clone(t, k1, 'active', null, null, '[]');
    raise exception 'hidden template assigned';
  exception when raise_exception then if sqlerrm <> 'Workout not found' then raise; end if; end;
  perform pg_temp.assert(true, 'A6 hidden library template is not assignable until shown');
  update public.workouts set archived = true where id = t;
  perform pg_temp.assert(public.save_quick_session_to_library(c1, a) = jsonb_build_object('state', 'replayed', 'template_id', t)
    and (select count(*) = templates_before + 1 from public.workouts where is_template), 'A6 archived pointer is never silently replaced');
  begin update public.workout_assignments set library_template_id = null where id = a; raise exception 'pointer cleared';
  exception when check_violation then null; end;

  perform pg_temp.assert(public.save_quick_session_to_library(c2, a) = jsonb_build_object('state', 'not_found'), 'A6 another coach cannot read the pointer');
  update public.workout_assignments set archived = true where id = a;
  perform pg_temp.assert(public.save_quick_session_to_library(c1, a) = jsonb_build_object('state', 'not_found'), 'A6 archived assignment masks the pointer on replay');
  update public.workout_assignments set archived = false where id = a;
end $$;

do $$
declare
  c1 uuid := 'b1000000-0000-4000-8000-000000000001';
  k1 uuid := 'b2000000-0000-4000-8000-000000000001';
  tmpl uuid; ordinary uuid;
begin
  tmpl := public.save_workout(null, c1, 'Ordinary template', null, null, '[{"custom_name":"Row"}]');
  ordinary := public.assign_workout_clone(tmpl, k1, 'active', null, null, '[]');
  perform pg_temp.assert(public.save_quick_session_to_library(c1, ordinary) = jsonb_build_object('state', 'not_found'), 'A6 ordinary assignments have no quick library save');
end $$;

-- F2: the generic callable RPC keeps its historical copy contract for all source kinds.
do $$
declare
  c uuid := 'b1000000-0000-4000-8000-000000000001';
  k uuid := 'b2000000-0000-4000-8000-000000000001';
  a uuid; w uuid; t uuid; renamed uuid; ordinary uuid;
begin
  a := (public.create_quick_session(c,k,'c1000000-0000-4000-8000-000000000003',pg_temp.h('generic'),'2031-03-05','Generic quick',null,pg_temp.body('Generic row'))->>'assignment_id')::uuid;
  select workout_id into w from public.workout_assignments where id=a;
  t := public.save_workout_as_template(w,c,null,null);
  perform pg_temp.assert((select name='Generic quick' and is_template and hidden and client_id is null and source_workout_id=w from public.workouts where id=t), 'F2 generic quick copy preserves source title, hidden template and provenance');
  perform pg_temp.assert((select count(*)=2 and bool_and(coach_notes is null) and bool_and(default_load_value is null) from public.workout_exercises where workout_id=t and not archived), 'F2 generic quick copy strips client loads and coach notes');
  perform pg_temp.assert((select library_template_id is null from public.workout_assignments where id=a), 'F2 generic copy preserves independent dedicated-library pointer semantics');
  renamed := public.save_workout_as_template(t,c,'Named variation',t);
  perform pg_temp.assert((select name='Named variation' and variation_of=t and hidden from public.workouts where id=renamed), 'F2 ordinary template rename and variation behavior unchanged');
  update public.workouts set hidden=false where id=t;
  ordinary := public.assign_workout_clone(t,k,'active',null,null,'[]');
  select workout_id into w from public.workout_assignments where id=ordinary;
  renamed := public.save_workout_as_template(w,c,null,null);
  perform pg_temp.assert((select name='Generic quick' and is_template and hidden and client_id is null from public.workouts where id=renamed), 'F2 ordinary private-workout generic copy unchanged');
end $$;
