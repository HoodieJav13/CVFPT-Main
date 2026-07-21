\set ON_ERROR_STOP on

insert into public.coaches (id, name, email)
values
  ('10000000-0000-4000-8000-000000000001', 'Original Coach', 'feedback-coach-1@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'Second Coach', 'feedback-coach-2@example.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'Concurrent Coach', 'feedback-coach-3@example.invalid');

insert into public.clients (id, coach_id, name, email)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Feedback Client', 'feedback-client@example.invalid');

insert into public.workouts (id, coach_id, name)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Feedback Test Workout');

insert into public.workout_assignments (id, client_id, workout_id, assignment_mode)
values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'active');

insert into public.workout_logs (
  id, client_id, coach_id, workout_assignment_id, source_workout_id,
  workout_name, status, feedback, notes, completed_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Feedback Test Workout', 'completed', 'Client feedback stays immutable',
  'Completed notes stay immutable', now()
);

select public.save_workout_coach_response(
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '  First response  '
);

do $$
declare
  v_response public.workout_coach_responses%rowtype;
  v_created_at timestamptz;
  v_edited_at timestamptz;
begin
  select * into v_response
  from public.workout_coach_responses
  where workout_log_id = '50000000-0000-4000-8000-000000000001'
    and author_coach_id = '10000000-0000-4000-8000-000000000001';
  if v_response.content <> 'First response' or v_response.author_name_snapshot <> 'Original Coach' or v_response.read_at is not null then
    raise exception 'creation snapshot/content/unread regression';
  end if;
  v_created_at := v_response.created_at;

  update public.workout_coach_responses set read_at = now() where id = v_response.id;
  update public.coaches set name = 'Renamed Coach' where id = v_response.author_coach_id;
  perform public.save_workout_coach_response(v_response.workout_log_id, v_response.author_coach_id, 'Edited response');

  select * into v_response from public.workout_coach_responses where id = v_response.id;
  if v_response.content <> 'Edited response'
    or v_response.author_name_snapshot <> 'Original Coach'
    or v_response.created_at <> v_created_at
    or v_response.edited_at is null
    or v_response.read_at is null then
    raise exception 'edit preservation regression';
  end if;
  v_edited_at := v_response.edited_at;
  perform public.save_workout_coach_response(v_response.workout_log_id, v_response.author_coach_id, 'Edited response');
  select * into v_response from public.workout_coach_responses where id = v_response.id;
  if v_response.edited_at <> v_edited_at then raise exception 'no-op save changed edited_at'; end if;
end;
$$;

select public.save_workout_coach_response(
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'Second author response'
);

do $$
declare
  v_order uuid[];
  v_log record;
begin
  if (select count(*) from public.workout_coach_responses where workout_log_id = '50000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'different authors did not retain distinct rows';
  end if;
  if (select count(*) from public.workout_coach_responses where workout_log_id = '50000000-0000-4000-8000-000000000001' and read_at is null) <> 1 then
    raise exception 'response unread state is not independent';
  end if;
  select array_agg(author_coach_id order by coalesce(edited_at, created_at) desc, id desc)
  into v_order from public.workout_coach_responses
  where workout_log_id = '50000000-0000-4000-8000-000000000001';
  if array_length(v_order, 1) <> 2 then raise exception 'deterministic ordering regression'; end if;

  select status, feedback, notes into v_log from public.workout_logs where id = '50000000-0000-4000-8000-000000000001';
  if v_log.status <> 'completed' or v_log.feedback <> 'Client feedback stays immutable' or v_log.notes <> 'Completed notes stay immutable' then
    raise exception 'completed workout changed';
  end if;
  if exists (select 1 from public.notifications where workout_log_id = '50000000-0000-4000-8000-000000000001') then
    raise exception 'coach response created a completion notification';
  end if;
  if exists (select 1 from public.client_credits where client_id = '20000000-0000-4000-8000-000000000001') then
    raise exception 'coach response touched client credits';
  end if;
end;
$$;

update public.coaches set archived = true where id = '10000000-0000-4000-8000-000000000002';
do $$
begin
  if not exists (
    select 1 from public.workout_coach_responses
    where author_coach_id = '10000000-0000-4000-8000-000000000002'
      and author_name_snapshot = 'Second Coach'
  ) then raise exception 'archived author history disappeared'; end if;
  begin
    perform public.save_workout_coach_response(
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'Forbidden archived edit'
    );
    raise exception 'archived coach save unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'archived coach save unexpectedly succeeded' then raise; end if;
  end;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.workout_coach_responses'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon', 'public.workout_coach_responses', 'SELECT')
    or has_table_privilege('authenticated', 'public.workout_coach_responses', 'SELECT') then raise exception 'Data API table privilege leaked'; end if;
  if not has_table_privilege('service_role', 'public.workout_coach_responses', 'SELECT,INSERT,UPDATE')
    or has_table_privilege('service_role', 'public.workout_coach_responses', 'DELETE') then raise exception 'service-role table grants invalid'; end if;
  if has_function_privilege('anon', 'public.save_workout_coach_response(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.save_workout_coach_response(uuid,uuid,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.save_workout_coach_response(uuid,uuid,text)', 'EXECUTE') then raise exception 'RPC grants invalid'; end if;
end;
$$;

select 'coach feedback sequential database regression passed' as result;
