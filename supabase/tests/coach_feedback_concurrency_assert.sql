\set ON_ERROR_STOP on

do $$
declare
  v_response public.workout_coach_responses%rowtype;
begin
  if (select count(*) from public.workout_coach_responses
      where workout_log_id = '50000000-0000-4000-8000-000000000001'
        and author_coach_id = '10000000-0000-4000-8000-000000000003') <> 1 then
    raise exception 'concurrent saves did not converge on exactly one row';
  end if;
  select * into v_response from public.workout_coach_responses
  where workout_log_id = '50000000-0000-4000-8000-000000000001'
    and author_coach_id = '10000000-0000-4000-8000-000000000003';
  if v_response.content <> 'Concurrent response two' then raise exception 'last successful concurrent save did not win'; end if;
  if v_response.author_name_snapshot <> 'Concurrent Coach' or v_response.read_at is not null or v_response.created_at is null then
    raise exception 'concurrent creation snapshot/unread semantics regressed';
  end if;
end;
$$;

select 'coach feedback concurrent database regression passed' as result;
