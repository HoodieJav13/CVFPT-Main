-- Client-visible coach responses to immutable completed workout snapshots.
-- Responses are separate business records; Express remains the authorization boundary.

create table if not exists public.workout_coach_responses (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs(id),
  client_id uuid not null references public.clients(id),
  author_coach_id uuid not null references public.coaches(id),
  author_name_snapshot text not null check (btrim(author_name_snapshot) <> ''),
  content text not null check (
    content = btrim(content)
    and char_length(content) between 1 and 4000
  ),
  read_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(workout_log_id, author_coach_id)
);

create index if not exists idx_workout_coach_responses_client_unread
  on public.workout_coach_responses(client_id, read_at, archived);
create index if not exists idx_workout_coach_responses_activity
  on public.workout_coach_responses(workout_log_id, coalesce(edited_at, created_at) desc, id desc)
  where archived = false;

create or replace function public.save_workout_coach_response(
  p_workout_log_id uuid,
  p_author_coach_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.workout_logs%rowtype;
  v_author public.coaches%rowtype;
  v_content text := btrim(coalesce(p_content, ''));
  v_response public.workout_coach_responses%rowtype;
begin
  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    raise exception 'Coach response must be between 1 and 4,000 characters';
  end if;

  select * into v_log
  from public.workout_logs
  where id = p_workout_log_id and archived = false;
  if v_log.id is null then raise exception 'Workout log not found'; end if;
  if v_log.status <> 'completed' then raise exception 'Only completed workouts accept coach responses'; end if;

  select * into v_author
  from public.coaches
  where id = p_author_coach_id and archived = false;
  if v_author.id is null then raise exception 'Coach not found'; end if;

  insert into public.workout_coach_responses (
    workout_log_id, client_id, author_coach_id, author_name_snapshot, content
  ) values (
    v_log.id, v_log.client_id, v_author.id, btrim(v_author.name), v_content
  )
  on conflict (workout_log_id, author_coach_id) do nothing
  returning * into v_response;

  if v_response.id is not null then
    return jsonb_build_object('outcome', 'created', 'response', to_jsonb(v_response));
  end if;

  update public.workout_coach_responses
  set content = v_content,
      edited_at = case when content is distinct from v_content then now() else edited_at end,
      updated_at = case when content is distinct from v_content then now() else updated_at end
  where workout_log_id = v_log.id
    and author_coach_id = v_author.id
    and archived = false
  returning * into v_response;

  if v_response.id is null then raise exception 'Coach response not found'; end if;
  return jsonb_build_object('outcome', 'updated', 'response', to_jsonb(v_response));
end;
$$;

alter table public.workout_coach_responses enable row level security;
revoke all privileges on table public.workout_coach_responses from public, anon, authenticated, service_role;
grant select, insert, update on table public.workout_coach_responses to service_role;

revoke execute on function public.save_workout_coach_response(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_workout_coach_response(uuid, uuid, text) to service_role;
