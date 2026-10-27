-- Text cue -> next exact-source attempt -> explicit coach recheck.
-- Additive, unapplied locally until the isolated harness. Express/service role only.
create table public.exercise_attempt_cues (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 source_log_id uuid not null references public.workout_logs(id), source_exercise_id uuid not null references public.workout_log_exercises(id),
 source_workout_exercise_id uuid not null references public.workout_exercises(id),
 program_assignment_id uuid references public.program_assignments(id), program_day_id uuid references public.program_days(id),
 workout_assignment_id uuid references public.workout_assignments(id),
 text text not null check (text=btrim(text) and char_length(text) between 1 and 500),
 source_version text not null, author_coach_id uuid not null references public.coaches(id), author_name_snapshot text not null,
 retry_log_id uuid references public.workout_logs(id), retry_exercise_id uuid references public.workout_log_exercises(id), retry_version text,
 verdict text not null default 'pending' check(verdict in ('pending','fixed','partial','nochange')),
 revision integer not null default 1 check(revision>0), archived boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), linked_at timestamptz,
 rechecked_by uuid references public.coaches(id), rechecked_at timestamptz,
 check ((program_assignment_id is not null and program_day_id is not null and workout_assignment_id is null) or (program_assignment_id is null and program_day_id is null and workout_assignment_id is not null)),
 check ((retry_log_id is null and retry_exercise_id is null and retry_version is null) or (retry_log_id is not null and retry_exercise_id is not null and retry_version is not null))
);
create unique index exercise_attempt_cues_one_source on public.exercise_attempt_cues(source_exercise_id) where not archived;
create index exercise_attempt_cues_source_history on public.exercise_attempt_cues(source_exercise_id,created_at);
create index exercise_attempt_cues_waiting on public.exercise_attempt_cues(client_id,source_workout_exercise_id) where not archived and retry_exercise_id is null;
create index exercise_attempt_cues_retry on public.exercise_attempt_cues(retry_exercise_id) where not archived;
create table public.exercise_cue_receipts (
 actor_auth_user_id uuid not null, request_id uuid not null, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(actor_auth_user_id,request_id)
);
alter table public.exercise_attempt_cues enable row level security;
alter table public.exercise_cue_receipts enable row level security;
revoke all on public.exercise_attempt_cues,public.exercise_cue_receipts from public,anon,authenticated,service_role;
grant select,insert,update on public.exercise_attempt_cues to service_role;
grant select,insert on public.exercise_cue_receipts to service_role;

create function public.protect_exercise_cue() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Cue records are soft-state only'; end if;
 if (new.client_id,new.source_log_id,new.source_exercise_id,new.source_workout_exercise_id,new.program_assignment_id,new.program_day_id,new.workout_assignment_id,new.author_coach_id,new.author_name_snapshot,new.created_at)
  is distinct from (old.client_id,old.source_log_id,old.source_exercise_id,old.source_workout_exercise_id,old.program_assignment_id,old.program_day_id,old.workout_assignment_id,old.author_coach_id,old.author_name_snapshot,old.created_at)
 then raise exception 'Cue source is immutable'; end if;
 if old.retry_exercise_id is not null and (new.text,new.source_version,new.archived,new.retry_log_id,new.retry_exercise_id,new.retry_version,new.linked_at) is distinct from
  (old.text,old.source_version,old.archived,old.retry_log_id,old.retry_exercise_id,old.retry_version,old.linked_at) then raise exception 'Linked cue text and attempt are immutable'; end if;
 return new;
end $$;
create trigger exercise_cue_immutable before update or delete on public.exercise_attempt_cues for each row execute function public.protect_exercise_cue();
create function public.protect_cue_receipt() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Cue receipts are append-only'; end $$;
create trigger exercise_cue_receipt_immutable before update or delete on public.exercise_cue_receipts for each row execute function public.protect_cue_receipt();

-- Locks the current ownership row, independently resolves the verified provider
-- identity. Nullable client auth_user_id is never equated with clients.id.
create function public.authorize_exercise_cue(p_auth_user_id uuid,p_client_id uuid,p_write boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; a public.coaches%rowtype;
begin
 select * into c from public.clients where id=p_client_id and not archived for share;
 if c.id is null or p_auth_user_id is null then raise exception using errcode='P0404',message='Exercise attempt not found'; end if;
 select * into a from public.coaches where auth_user_id=p_auth_user_id and not archived for share;
 if a.id is not null and (a.is_admin or a.id=c.coach_id) then return a.id; end if;
 if a.id is null and c.auth_user_id=p_auth_user_id then
  if not p_write then return null; end if;
  raise exception using errcode='P0403',message='Coach access required';
 end if;
 raise exception using errcode='P0404',message='Exercise attempt not found';
end $$;
create function public.exercise_cue_source_version(p_log_id uuid,p_exercise_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object('exercise',to_jsonb(we),'workout',to_jsonb(w),'program',to_jsonb(p),'day',to_jsonb(pd),'assignment',coalesce(to_jsonb(pa),to_jsonb(wa)),
 'loads',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.program_assignment_exercise_loads l where not l.archived and l.program_assignment_id=pa.id and l.program_day_id=pd.id and l.workout_exercise_id=we.id),
 (select jsonb_agg(to_jsonb(l) order by l.id) from public.workout_assignment_exercise_loads l where not l.archived and l.workout_assignment_id=wa.id and l.workout_exercise_id=we.id),'[]'::jsonb))::text)
 from public.workout_logs wl join public.workout_log_exercises e on e.workout_log_id=wl.id
 join public.workout_exercises we on we.id=e.source_workout_exercise_id and not we.archived
 join public.workouts w on w.id=we.workout_id and not w.archived
 left join public.program_assignments pa on pa.id=wl.program_assignment_id and not pa.archived and pa.client_id=wl.client_id
 left join public.program_days pd on pd.id=wl.program_day_id and pd.program_id=pa.program_id and pd.workout_id=w.id and not pd.archived
 left join public.programs p on p.id=pa.program_id and not p.archived
 left join public.workout_assignments wa on wa.id=wl.workout_assignment_id and wa.client_id=wl.client_id and wa.workout_id=w.id and not wa.archived
 where wl.id=p_log_id and e.id=p_exercise_id and not wl.archived and not e.archived
 and ((pa.id is not null and pd.id is not null and p.id is not null) or wa.id is not null)
$$;
create function public.exercise_cue_retry_version(p_exercise_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(coalesce(jsonb_object_agg(k,v order by k),'{}'::jsonb)::text) from public.workout_log_exercises e,
 lateral jsonb_each(to_jsonb(e)) x(k,v) where e.id=p_exercise_id and not e.archived
 and (k like 'prescribed_%' or k in ('source_workout_exercise_id','exercise_library_id','exercise_name','tracking_type','plan_revision'))
$$;
create function public.exercise_cue_dto(q public.exercise_attempt_cues) returns jsonb
language sql stable security invoker set search_path='' as $$
 select (to_jsonb(q)-'source_version'-'retry_version'-'author_name_snapshot') || jsonb_build_object('author_name',q.author_name_snapshot,
 'retry_status',(select status from public.workout_logs where id=q.retry_log_id),
 'stale',q.retry_exercise_id is null and q.source_version is distinct from public.exercise_cue_source_version(q.source_log_id,q.source_exercise_id),
 'stale_retry',q.retry_exercise_id is not null and q.retry_version is distinct from public.exercise_cue_retry_version(q.retry_exercise_id))
$$;
create function public.read_exercise_cues(p_auth_user_id uuid,p_log_id uuid,p_exercise_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.workout_logs%rowtype; e public.workout_log_exercises%rowtype; version text; performed boolean;
begin
 select * into l from public.workout_logs where id=p_log_id and not archived;
 perform public.authorize_exercise_cue(p_auth_user_id,l.client_id,false);
 select * into e from public.workout_log_exercises where id=p_exercise_id and workout_log_id=p_log_id and not archived;
 if e.id is null then raise exception using errcode='P0404',message='Exercise attempt not found'; end if;
 version:=public.exercise_cue_source_version(l.id,e.id);
 select exists(select 1 from public.workout_log_sets where workout_log_exercise_id=e.id and status='completed' and not archived) into performed;
 return jsonb_build_object('source_version',version,'can_create',l.status='completed' and performed and version is not null,'can_recheck',l.status='completed' and performed,
 'outgoing',coalesce((select jsonb_agg(public.exercise_cue_dto(q) order by q.created_at,q.id) from public.exercise_attempt_cues q where q.client_id=l.client_id and q.source_exercise_id=e.id),'[]'::jsonb),
 'incoming',coalesce((select jsonb_agg(public.exercise_cue_dto(q) order by q.created_at,q.id) from public.exercise_attempt_cues q where q.client_id=l.client_id and q.retry_exercise_id=e.id and not q.archived),'[]'::jsonb));
end $$;

create function public.mutate_exercise_cue(p_auth_user_id uuid,p_log_id uuid,p_exercise_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.workout_logs%rowtype; e public.workout_log_exercises%rowtype; q public.exercise_attempt_cues%rowtype; receipt public.exercise_cue_receipts%rowtype;
 actor uuid; version text; txt text; action text:=p_request->>'action'; rid uuid; expected integer; frozen jsonb; result jsonb;
begin
 select * into l from public.workout_logs where id=p_log_id and not archived;
 -- Same client-first lock as tracked starts: concurrent cue/save/start cannot
 -- miss a committed waiting cue or apply one retroactively to a resumed log.
 perform 1 from public.clients where id=l.client_id for update;
 actor:=public.authorize_exercise_cue(p_auth_user_id,l.client_id,true);
 select * into e from public.workout_log_exercises where id=p_exercise_id and workout_log_id=p_log_id and not archived for share;
 if e.id is null then raise exception using errcode='P0404',message='Exercise attempt not found'; end if;
 begin rid:=(p_request->>'request_id')::uuid; exception when others then raise exception using errcode='P0400',message='Invalid cue request'; end;
 if rid is null or action is null or action not in ('create','edit','cancel','verdict') then raise exception using errcode='P0400',message='Invalid cue request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cue-request:'||p_auth_user_id::text||':'||rid::text,0));
 frozen:=jsonb_build_object('log',p_log_id,'exercise',p_exercise_id,'body',p_request);
 select * into receipt from public.exercise_cue_receipts where actor_auth_user_id=p_auth_user_id and request_id=rid;
 if found then
  if receipt.request<>frozen then raise exception using errcode='P0409',message='Request id already used for a different change'; end if;
  return receipt.result;
 end if;
 if action in ('create','edit') then
  if jsonb_typeof(p_request->'text') is distinct from 'string' then raise exception using errcode='P0400',message='Enter one actionable text cue'; end if;
  txt:=btrim(p_request->>'text');
  if char_length(txt) not between 1 and 500 then raise exception using errcode='P0400',message='Cue must be 1 to 500 characters'; end if;
  version:=public.exercise_cue_source_version(l.id,e.id);
  if version is null or version is distinct from (p_request->>'source_version') then raise exception using errcode='P0409',message='Program or assignment changed. Reload and review the cue'; end if;
  if l.status<>'completed' or not exists(select 1 from public.workout_log_sets where workout_log_exercise_id=e.id and status='completed' and not archived) then raise exception using errcode='P0409',message='Choose a completed performed attempt'; end if;
 end if;
 if action='create' then
  if exists(select 1 from public.exercise_attempt_cues c where not c.archived and (c.source_exercise_id=e.id or (c.client_id=l.client_id and c.retry_exercise_id is null
   and c.source_workout_exercise_id=e.source_workout_exercise_id and c.program_assignment_id is not distinct from l.program_assignment_id and c.program_day_id is not distinct from l.program_day_id and c.workout_assignment_id is not distinct from l.workout_assignment_id))) then
   raise exception using errcode='P0409',message='This attempt or assigned exercise already has a cue waiting for retry'; end if;
  insert into public.exercise_attempt_cues(client_id,source_log_id,source_exercise_id,source_workout_exercise_id,program_assignment_id,program_day_id,workout_assignment_id,text,source_version,author_coach_id,author_name_snapshot)
   select l.client_id,l.id,e.id,e.source_workout_exercise_id,l.program_assignment_id,l.program_day_id,l.workout_assignment_id,txt,version,actor,name from public.coaches where id=actor returning * into q;
 else
  begin
   select * into q from public.exercise_attempt_cues where id=(p_request->>'cue_id')::uuid and client_id=l.client_id and not archived for update;
   expected:=(p_request->>'revision')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='P0400',message='Invalid cue request'; end;
  if q.id is null or (action='verdict' and q.retry_exercise_id is distinct from e.id) or (action<>'verdict' and q.source_exercise_id<>e.id) then raise exception using errcode='P0404',message='Cue not found'; end if;
  if expected is null or q.revision<>expected then raise exception using errcode='P0409',message='Cue changed. Reload before trying again'; end if;
  if action='verdict' then
   if q.retry_version is distinct from public.exercise_cue_retry_version(e.id) then raise exception using errcode='P0409',message='Retry plan changed. This cue belongs to the earlier attempt version'; end if;
   if (p_request->>'verdict') is null or (p_request->>'verdict') not in ('pending','fixed','partial','nochange') then raise exception using errcode='P0400',message='Choose a recheck verdict'; end if;
   if l.status<>'completed' or not exists(select 1 from public.workout_log_sets where workout_log_exercise_id=e.id and status='completed' and not archived) then raise exception using errcode='P0409',message='Complete a performed retry before recording a verdict'; end if;
   update public.exercise_attempt_cues set verdict=p_request->>'verdict',rechecked_by=actor,rechecked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=q.id returning * into q;
  else
   if q.retry_exercise_id is not null then raise exception using errcode='P0409',message='Linked cue text and attempt are frozen'; end if;
   update public.exercise_attempt_cues set text=case when action='edit' then txt else text end,source_version=case when action='edit' then version else source_version end,
    archived=action='cancel',revision=revision+1,updated_at=clock_timestamp() where id=q.id returning * into q;
  end if;
 end if;
 result:=public.exercise_cue_dto(q);
 insert into public.exercise_cue_receipts(actor_auth_user_id,request_id,request,result) values(p_auth_user_id,rid,frozen,result);
 return result;
end $$;

-- Public helper contract for a future combined Rescue start transaction.
create function public.bind_next_exercise_cues(p_log_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare l public.workout_logs%rowtype; e public.workout_log_exercises%rowtype; q public.exercise_attempt_cues%rowtype;
begin
 select * into l from public.workout_logs where id=p_log_id and status='active' and not archived;
 if l.id is null then return; end if;
 perform 1 from public.clients where id=l.client_id for update;
 for e in select * from public.workout_log_exercises where workout_log_id=l.id and not archived order by position,id loop
  for q in select * from public.exercise_attempt_cues c where c.client_id=l.client_id and not c.archived and c.retry_exercise_id is null and c.source_log_id<>l.id
   and c.created_at<=l.started_at and c.source_workout_exercise_id=e.source_workout_exercise_id
   and c.program_assignment_id is not distinct from l.program_assignment_id and c.program_day_id is not distinct from l.program_day_id
   and c.workout_assignment_id is not distinct from l.workout_assignment_id for update loop
   if q.source_version=public.exercise_cue_source_version(q.source_log_id,q.source_exercise_id) then
    update public.exercise_attempt_cues set retry_log_id=l.id,retry_exercise_id=e.id,retry_version=public.exercise_cue_retry_version(e.id),linked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=q.id;
   end if;
  end loop;
 end loop;
end $$;
create function public.start_workout_log_with_cues(p_client_id uuid,p_program_assignment_id uuid,p_program_day_id uuid,p_workout_assignment_id uuid,p_started_by text,p_started_by_coach_id uuid,p_session_id uuid,p_auth_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; result jsonb;
begin
 perform 1 from public.clients where id=p_client_id for update;
 actor:=public.authorize_exercise_cue(p_auth_user_id,p_client_id,false);
 if (actor is null and (p_started_by is distinct from 'client' or p_started_by_coach_id is not null)) or (actor is not null and (p_started_by is distinct from 'coach' or p_started_by_coach_id is distinct from actor)) then raise exception using errcode='P0403',message='Invalid starting actor'; end if;
 result:=public.start_workout_log_v2(p_client_id,p_program_assignment_id,p_program_day_id,p_workout_assignment_id,p_started_by,p_started_by_coach_id,p_session_id);
 if result->>'outcome'='started' then perform public.bind_next_exercise_cues((result->>'workout_log_id')::uuid); end if;
 return result;
end $$;

-- Revoke PUBLIC's default EXECUTE even for invoker helpers. No browser policy.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('protect_exercise_cue','protect_cue_receipt','authorize_exercise_cue','exercise_cue_source_version','exercise_cue_retry_version','exercise_cue_dto','read_exercise_cues','mutate_exercise_cue','bind_next_exercise_cues','start_workout_log_with_cues') loop
 execute format('revoke all on function %s from public, anon, authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
