-- Whole week: optional outside-activity ledger + role-separated context
-- preferences. Additive, local-only until separately authorized hosted
-- application. Express/service role only: RLS on, no browser policies/grants.
-- occurred_on is a plain America/Denver business DATE (never a timestamp), so a
-- stored historical day can never shift with a viewer's timezone.
-- Nothing here writes programs, workouts, Rescue plans, cues or check-ins.

create table public.outside_activities (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 activity_type text not null check (activity_type in ('sport_practice','game','run','hike','extra_training','other')),
 label text check (label is null or (label=btrim(label) and char_length(label) between 1 and 80)),
 occurred_on date not null,
 -- Unknown stays NULL; never 0. No calories/wearable/session/completion fields.
 duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 86400),
 effort_rpe smallint check (effort_rpe is null or effort_rpe between 1 and 10),
 note text check (note is null or (note=btrim(note) and char_length(note) between 1 and 1000)),
 created_by_role text not null check (created_by_role in ('client','coach','admin')),
 created_by_id uuid not null,
 updated_by_role text not null check (updated_by_role in ('client','coach','admin')),
 updated_by_id uuid not null,
 revision integer not null default 1 check (revision>=1),
 archived boolean not null default false,
 archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check ((archived and archived_at is not null) or (not archived and archived_at is null))
);
create index outside_activities_client_day on public.outside_activities(client_id,occurred_on,id) where not archived;

-- Feature-specific, append-only, data-minimized: no note/body/answer snapshots.
-- Only the server-normalized request hash and the committed row/revision.
create table public.outside_activity_receipts (
 actor_auth_user_id uuid not null,
 request_id uuid not null,
 action text not null check (action in ('create','update','archive')),
 client_id uuid not null references public.clients(id),
 activity_id uuid not null references public.outside_activities(id),
 request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
 committed_revision integer not null check (committed_revision>=1),
 created_at timestamptz not null default clock_timestamp(),
 primary key (actor_auth_user_id,request_id)
);
create index outside_activity_receipts_activity on public.outside_activity_receipts(activity_id);

-- Missing row = outside collection off and check-in prompt hidden. Coach bits
-- and client bits are written only by their own role. Manual check-ins are
-- never gated by these bits.
create table public.client_context_preferences (
 client_id uuid primary key references public.clients(id),
 activity_coach_enabled boolean not null default false,
 activity_client_off boolean not null default false,
 checkin_prompt_coach_enabled boolean not null default false,
 checkin_prompt_client_off boolean not null default false,
 revision integer not null default 1 check (revision>=1),
 updated_by_role text not null check (updated_by_role in ('client','coach','admin')),
 updated_by_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);

alter table public.outside_activities enable row level security;
alter table public.outside_activity_receipts enable row level security;
alter table public.client_context_preferences enable row level security;
revoke all on public.outside_activities,public.outside_activity_receipts,public.client_context_preferences from public,anon,authenticated,service_role;
grant select,insert,update on public.outside_activities,public.client_context_preferences to service_role;
grant select,insert on public.outside_activity_receipts to service_role;

-- Single revision owner: every writer (guarded RPC or direct) increments here;
-- RPCs only compare the expected revision.
create function public.outside_activity_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Outside activities are soft-archive only'; end if;
 if tg_op='INSERT' then
  new.revision:=1; new.archived:=false; new.archived_at:=null;
  new.created_at:=clock_timestamp(); new.updated_at:=new.created_at;
  new.updated_by_role:=new.created_by_role; new.updated_by_id:=new.created_by_id;
  return new;
 end if;
 if old.archived then raise exception 'Archived outside activities are read-only'; end if;
 if (new.id,new.client_id,new.created_by_role,new.created_by_id,new.created_at)
  is distinct from (old.id,old.client_id,old.created_by_role,old.created_by_id,old.created_at)
 then raise exception 'Outside activity identity and author are immutable'; end if;
 new.revision:=old.revision+1; new.updated_at:=clock_timestamp();
 new.archived_at:=case when new.archived then clock_timestamp() else null end;
 return new;
end $$;
create trigger outside_activity_guard before insert or update or delete on public.outside_activities
 for each row execute function public.outside_activity_guard();

create function public.context_preferences_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Context preferences are never deleted'; end if;
 if tg_op='INSERT' then new.revision:=1; new.created_at:=clock_timestamp(); new.updated_at:=new.created_at; return new; end if;
 if (new.client_id,new.created_at) is distinct from (old.client_id,old.created_at) then raise exception 'Context preference owner is immutable'; end if;
 new.revision:=old.revision+1; new.updated_at:=clock_timestamp();
 return new;
end $$;
create trigger context_preferences_guard before insert or update or delete on public.client_context_preferences
 for each row execute function public.context_preferences_guard();

create function public.outside_activity_receipt_guard() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Outside activity receipts are append-only'; end $$;
create trigger outside_activity_receipt_guard before update or delete on public.outside_activity_receipts
 for each row execute function public.outside_activity_receipt_guard();

-- Current actor and ownership, resolved from the verified provider identity on
-- every call. Coach first (matches requireAuth). Nullable clients.auth_user_id is
-- never equated with clients.id; an unlinked client cannot be matched at all.
-- The coach row is share-locked so a concurrent role change/archive serializes.
create function public.authorize_whole_week(p_auth_user_id uuid,p_client_id uuid,out actor_role text,out actor_id uuid)
language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; a public.coaches%rowtype;
begin
 if p_auth_user_id is null or p_client_id is null then raise exception using errcode='P0404',message='Client week not found'; end if;
 select * into c from public.clients where id=p_client_id and not archived for share;
 if c.id is null then raise exception using errcode='P0404',message='Client week not found'; end if;
 select * into a from public.coaches where auth_user_id=p_auth_user_id and not archived for share;
 if a.id is not null then
  if a.is_admin then actor_role:='admin'; actor_id:=a.id; return; end if;
  if a.id=c.coach_id then actor_role:='coach'; actor_id:=a.id; return; end if;
  raise exception using errcode='P0404',message='Client week not found';
 end if;
 if c.auth_user_id is not null and c.auth_user_id=p_auth_user_id then actor_role:='client'; actor_id:=c.id; return; end if;
 raise exception using errcode='P0404',message='Client week not found';
end $$;

create function public.outside_activity_dto(a public.outside_activities) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',a.id,'client_id',a.client_id,'activity_type',a.activity_type,'label',a.label,
  'occurred_on',to_char(a.occurred_on,'YYYY-MM-DD'),'duration_seconds',a.duration_seconds,'effort_rpe',a.effort_rpe,'note',a.note,
  'created_by_role',a.created_by_role,
  'created_by_name',case when a.created_by_role='client' then null else (select c.name from public.coaches c where c.id=a.created_by_id) end,
  'updated_by_role',a.updated_by_role,'revision',a.revision,'archived',a.archived,'archived_at',a.archived_at,
  'created_at',a.created_at,'updated_at',a.updated_at)
$$;

create function public.context_preferences_dto(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'revision',coalesce(p.revision,0),'stored',p.client_id is not null,
  'activity_coach_enabled',coalesce(p.activity_coach_enabled,false),'activity_client_off',coalesce(p.activity_client_off,false),
  'activity_collection',case when p.client_id is null then 'default_off' when p.activity_client_off then 'client_opted_out'
   when not p.activity_coach_enabled then 'coach_off' else 'on' end,
  'checkin_prompt_coach_enabled',coalesce(p.checkin_prompt_coach_enabled,false),'checkin_prompt_client_off',coalesce(p.checkin_prompt_client_off,false),
  'checkin_prompt',case when coalesce(p.checkin_prompt_coach_enabled,false) and not coalesce(p.checkin_prompt_client_off,false) then 'on' else 'hidden' end,
  'updated_by_role',p.updated_by_role,'updated_at',p.updated_at)
 from (select 1) one left join public.client_context_preferences p on p.client_id=p_client_id
$$;

-- Read never inserts a preference row or changes any record.
create function public.read_whole_week(p_auth_user_id uuid,p_client_id uuid,p_week_start date,p_cursor jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_role text; v_actor uuid; v_end date; v_rows jsonb; v_summary jsonb; v_total integer; v_pt jsonb; v_cursor_date date; v_cursor_id uuid; v_next jsonb; v_last jsonb;
begin
 if p_week_start is null or extract(isodow from p_week_start)<>1 then
  raise exception using errcode='P0400',message='Choose a week that starts on a Monday';
 end if;
 select actor_role,actor_id into v_role,v_actor from public.authorize_whole_week(p_auth_user_id,p_client_id);
 v_end:=p_week_start+6;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor) is distinct from 'object' or
   (select array_agg(k order by k) from jsonb_object_keys(p_cursor) k) is distinct from array['client_id','id','occurred_on','week_start']::text[] then
   raise exception using errcode='P0400',message='Invalid activity page cursor';
  end if;
  if p_cursor->>'client_id' is distinct from p_client_id::text or p_cursor->>'week_start' is distinct from to_char(p_week_start,'YYYY-MM-DD')
   or jsonb_typeof(p_cursor->'occurred_on') is distinct from 'string' or (p_cursor->>'occurred_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_cursor->'id') is distinct from 'string' or (p_cursor->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   raise exception using errcode='P0400',message='Invalid activity page cursor';
  end if;
  begin v_cursor_date:=(p_cursor->>'occurred_on')::date;v_cursor_id:=(p_cursor->>'id')::uuid;
  exception when others then raise exception using errcode='P0400',message='Invalid activity page cursor';end;
  if to_char(v_cursor_date,'YYYY-MM-DD')<>p_cursor->>'occurred_on' or v_cursor_date not between p_week_start and v_end then
   raise exception using errcode='P0400',message='Invalid activity page cursor';
  end if;
 end if;
 select count(*)::integer,jsonb_build_object('activity_count',count(*),'known_duration_seconds',coalesce(sum(a.duration_seconds),0),
  'known_duration_count',count(a.duration_seconds),'unknown_duration_count',count(*) filter (where a.duration_seconds is null),
  'unknown_effort_count',count(*) filter (where a.effort_rpe is null))
  into v_total,v_summary
  from public.outside_activities a where a.client_id=p_client_id and not a.archived and a.occurred_on between p_week_start and v_end;
 select coalesce(jsonb_agg(public.outside_activity_dto(s.a) order by (s.a).occurred_on,(s.a).id),'[]'::jsonb) into v_rows
  from (select a from public.outside_activities a where a.client_id=p_client_id and not a.archived and a.occurred_on between p_week_start and v_end
   and (v_cursor_id is null or (a.occurred_on,a.id)>(v_cursor_date,v_cursor_id))
   order by a.occurred_on,a.id limit 100) s;
 if jsonb_array_length(v_rows)>0 then
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  if exists(select 1 from public.outside_activities a where a.client_id=p_client_id and not a.archived and a.occurred_on between p_week_start and v_end
   and (a.occurred_on,a.id)>((v_last->>'occurred_on')::date,(v_last->>'id')::uuid)) then
   v_next:=jsonb_build_object('client_id',p_client_id,'week_start',to_char(p_week_start,'YYYY-MM-DD'),'occurred_on',v_last->>'occurred_on','id',v_last->>'id');
  end if;
 end if;
 -- Counts remain in the same client-locked authorization transaction. A
 -- failed secondary data read is explicit partial availability, never zero.
 begin
  with counts as (
   select (completed_at at time zone 'America/Denver')::date as day,count(*) as n
   from public.workout_logs where client_id=p_client_id and not archived and status='completed'
    and completed_at >= (p_week_start::timestamp at time zone 'America/Denver')
    and completed_at < ((p_week_start+7)::timestamp at time zone 'America/Denver')
   group by 1
  ), days as (select p_week_start+i as day from generate_series(0,6) i)
  select jsonb_build_object('status','available','completed_count',coalesce(sum(c.n),0),
   'by_day',jsonb_object_agg(to_char(d.day,'YYYY-MM-DD'),coalesce(c.n,0))) into v_pt
  from days d left join counts c on c.day=d.day;
 exception when others then
  v_pt:=jsonb_build_object('status','unavailable','completed_count',null,'by_day',null);
 end;
 return jsonb_build_object('client_id',p_client_id,'viewer_role',v_role,
  'client_name',(select name from public.clients where id=p_client_id),
  'coach_name',(select co.name from public.clients c join public.coaches co on co.id=c.coach_id where c.id=p_client_id),
  'week_start',to_char(p_week_start,'YYYY-MM-DD'),'week_end',to_char(v_end,'YYYY-MM-DD'),
  'preferences',public.context_preferences_dto(p_client_id),
  'activities',v_rows,'next_cursor',v_next,'truncated',v_next is not null,'summary',v_summary,'pt_workouts',v_pt);
end $$;

-- One guarded domain RPC: create/update/archive. Order: validate -> client-first
-- lock (the same row reassignment/archive/link updates take) -> current actor
-- and ownership -> request lock -> receipt replay -> gates -> write -> receipt.
create function public.mutate_outside_activity(p_auth_user_id uuid,p_client_id uuid,p_activity_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 v_action text; v_rid uuid; v_expected integer; v_client uuid; v_role text; v_actor uuid;
 v_fields jsonb; v_type text; v_date date; v_label text; v_duration integer; v_effort integer; v_note text;
 v_today date; v_normalized jsonb; v_typed_fields jsonb; v_hash text;
 r public.outside_activity_receipts%rowtype; a public.outside_activities%rowtype; p public.client_context_preferences%rowtype;
begin
 if jsonb_typeof(p_request) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('action','request_id','revision','fields')) then
  raise exception using errcode='P0400',message='Invalid activity request';
 end if;
 v_action:=p_request->>'action';
 if v_action is null or v_action not in ('create','update','archive') then raise exception using errcode='P0400',message='Invalid activity request'; end if;
 begin v_rid:=(p_request->>'request_id')::uuid; exception when others then v_rid:=null; end;
 if v_rid is null then raise exception using errcode='P0400',message='Invalid activity request'; end if;
 if jsonb_typeof(p_request->'revision') is distinct from 'number' or (p_request->>'revision') !~ '^[0-9]{1,9}$' then
  raise exception using errcode='P0400',message='Invalid activity revision';
 end if;
 v_expected:=(p_request->>'revision')::integer;

 if v_action='create' then
  if p_activity_id is not null or p_client_id is null or v_expected<>0 then raise exception using errcode='P0400',message='Invalid activity request'; end if;
  v_client:=p_client_id;
 else
  if p_activity_id is null or v_expected<1 then raise exception using errcode='P0400',message='Invalid activity request'; end if;
  select client_id into v_client from public.outside_activities where id=p_activity_id;
  if v_client is null or (p_client_id is not null and p_client_id<>v_client) then raise exception using errcode='P0404',message='Activity not found'; end if;
 end if;

 if v_action='archive' then
  if p_request ? 'fields' then raise exception using errcode='P0400',message='Invalid activity request'; end if;
 else
  v_fields:=p_request->'fields';
  if jsonb_typeof(v_fields) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(v_fields) k where k not in ('activity_type','occurred_on','label','duration_seconds','effort_rpe','note')) then
   raise exception using errcode='P0400',message='Invalid activity fields';
  end if;
  if v_action='update' and (select count(*) from jsonb_object_keys(v_fields))=0 then
   raise exception using errcode='P0400',message='Choose an activity field to correct';
  end if;
  v_type:=v_fields->>'activity_type';
  if v_action='create' or v_fields ? 'activity_type' then
  if jsonb_typeof(v_fields->'activity_type') is distinct from 'string' or v_type not in ('sport_practice','game','run','hike','extra_training','other') then
   raise exception using errcode='P0400',message='Choose an activity type';
  end if;
  end if;
  if v_action='create' or v_fields ? 'occurred_on' then
  if jsonb_typeof(v_fields->'occurred_on') is distinct from 'string' or (v_fields->>'occurred_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception using errcode='P0400',message='Choose a real calendar date';
  end if;
  begin v_date:=(v_fields->>'occurred_on')::date; exception when others then v_date:=null; end;
  if v_date is null or to_char(v_date,'YYYY-MM-DD')<>(v_fields->>'occurred_on') then raise exception using errcode='P0400',message='Choose a real calendar date'; end if;
  v_today:=(clock_timestamp() at time zone 'America/Denver')::date;
  if v_date>v_today then raise exception using errcode='P0400',message='Activity dates cannot be in the future (America/Denver)'; end if;
  end if;
  if coalesce(jsonb_typeof(v_fields->'label'),'null') not in ('null','string') or coalesce(jsonb_typeof(v_fields->'note'),'null') not in ('null','string') then
   raise exception using errcode='P0400',message='Invalid activity text';
  end if;
  v_label:=nullif(btrim(v_fields->>'label'),'');
  if char_length(v_label)>80 then raise exception using errcode='P0400',message='Label must be 80 characters or fewer'; end if;
  v_note:=nullif(btrim(v_fields->>'note'),'');
  if char_length(v_note)>1000 then raise exception using errcode='P0400',message='Note must be 1,000 characters or fewer'; end if;
  -- Shape is checked before any cast (SQL OR does not promise short-circuit).
  if coalesce(jsonb_typeof(v_fields->'duration_seconds'),'null')<>'null' then
   if jsonb_typeof(v_fields->'duration_seconds')<>'number' or (v_fields->>'duration_seconds') !~ '^[0-9]{1,5}$' then
    raise exception using errcode='P0400',message='Duration must be a whole number of seconds from 1 to 86400, or unknown';
   end if;
   v_duration:=(v_fields->>'duration_seconds')::integer;
   if v_duration not between 1 and 86400 then
    raise exception using errcode='P0400',message='Duration must be a whole number of seconds from 1 to 86400, or unknown';
   end if;
  end if;
  if coalesce(jsonb_typeof(v_fields->'effort_rpe'),'null')<>'null' then
   if jsonb_typeof(v_fields->'effort_rpe')<>'number' or (v_fields->>'effort_rpe') !~ '^[0-9]{1,2}$' then
    raise exception using errcode='P0400',message='Effort must be a whole number from 1 to 10, or unknown';
   end if;
   v_effort:=(v_fields->>'effort_rpe')::integer;
   if v_effort not between 1 and 10 then raise exception using errcode='P0400',message='Effort must be a whole number from 1 to 10, or unknown'; end if;
  end if;
 end if;

 -- Client-first lock, then current authorization inside this transaction.
 perform 1 from public.clients where id=v_client for update;
 select actor_role,actor_id into v_role,v_actor from public.authorize_whole_week(p_auth_user_id,v_client);

 v_typed_fields:=jsonb_build_object('activity_type',v_type,'occurred_on',to_char(v_date,'YYYY-MM-DD'),
  'label',v_label,'duration_seconds',v_duration,'effort_rpe',v_effort,'note',v_note);
 -- Updates freeze the normalized PATCH itself, including presence. Omission
 -- retains the locked row; explicit null clears an optional field.
 if v_action='update' then
  select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) into v_typed_fields from jsonb_each(v_typed_fields) x(k,v) where v_fields ? k;
 end if;
 v_normalized:=jsonb_build_object('action',v_action,'client_id',v_client,'activity_id',p_activity_id,'revision',v_expected,
  'fields',case when v_action='archive' then null else v_typed_fields end);
 v_hash:=encode(sha256(convert_to(v_normalized::text,'UTF8')),'hex');

 perform pg_advisory_xact_lock(hashtextextended('outside-activity-request:'||p_auth_user_id::text||':'||v_rid::text,0));
 select * into r from public.outside_activity_receipts where actor_auth_user_id=p_auth_user_id and request_id=v_rid;
 if found then
  if r.request_hash<>v_hash or r.client_id<>v_client then
   raise exception using errcode='P0409',message='This request id was already used for a different change',hint='request_mismatch';
  end if;
  select * into a from public.outside_activities where id=r.activity_id;
  -- committed_revision is the receipt's; resource is the latest authorized row.
  return jsonb_build_object('resource',public.outside_activity_dto(a),'committed_revision',r.committed_revision,
   'request_id',v_rid,'replayed',true,'action',r.action);
 end if;

 if v_action='create' then
  select * into p from public.client_context_preferences where client_id=v_client;
  if coalesce(p.activity_client_off,false) then
   raise exception using errcode='P0409',message='Outside activity logging is turned off by the client',hint='collection_off';
  end if;
  if not coalesce(p.activity_coach_enabled,false) then
   raise exception using errcode='P0409',message='Outside activity logging is not turned on for this client',hint='collection_off';
  end if;
  insert into public.outside_activities(client_id,activity_type,label,occurred_on,duration_seconds,effort_rpe,note,created_by_role,created_by_id,updated_by_role,updated_by_id)
   values(v_client,v_type,v_label,v_date,v_duration,v_effort,v_note,v_role,v_actor,v_role,v_actor) returning * into a;
 else
  select * into a from public.outside_activities where id=p_activity_id for update;
  if a.archived then raise exception using errcode='P0409',message='This activity was removed. Reload the week',hint='archived'; end if;
  if a.revision<>v_expected then raise exception using errcode='P0409',message='This activity changed elsewhere. Reload before saving',hint='revision_conflict'; end if;
  if v_action='update' then
   update public.outside_activities set
    activity_type=case when v_fields ? 'activity_type' then v_type else a.activity_type end,
    label=case when v_fields ? 'label' then v_label else a.label end,
    occurred_on=case when v_fields ? 'occurred_on' then v_date else a.occurred_on end,
    duration_seconds=case when v_fields ? 'duration_seconds' then v_duration else a.duration_seconds end,
    effort_rpe=case when v_fields ? 'effort_rpe' then v_effort else a.effort_rpe end,
    note=case when v_fields ? 'note' then v_note else a.note end,
    updated_by_role=v_role,updated_by_id=v_actor where id=a.id returning * into a;
  else
   update public.outside_activities set archived=true,updated_by_role=v_role,updated_by_id=v_actor where id=a.id returning * into a;
  end if;
 end if;

 insert into public.outside_activity_receipts(actor_auth_user_id,request_id,action,client_id,activity_id,request_hash,committed_revision)
  values(p_auth_user_id,v_rid,v_action,v_client,a.id,v_hash,a.revision);
 return jsonb_build_object('resource',public.outside_activity_dto(a),'committed_revision',a.revision,'request_id',v_rid,'replayed',false,'action',v_action);
end $$;

-- Revision-guarded, role-separated preference write. No receipt: an unknown
-- response reconciles by refetching current state.
create function public.save_context_preferences(p_auth_user_id uuid,p_client_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_role text; v_actor uuid; v_expected integer; v_allowed text[]; v_key text; p public.client_context_preferences%rowtype;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request->'revision') is distinct from 'number'
  or (p_request->>'revision') !~ '^[0-9]{1,9}$' then
  raise exception using errcode='P0400',message='Invalid preference request';
 end if;
 v_expected:=(p_request->>'revision')::integer;
 for v_key in select k from jsonb_object_keys(p_request) k where k<>'revision' loop
  if v_key not in ('activity_coach_enabled','activity_client_off','checkin_prompt_coach_enabled','checkin_prompt_client_off')
   or jsonb_typeof(p_request->v_key)<>'boolean' then
   raise exception using errcode='P0400',message='Invalid preference request';
  end if;
 end loop;
 if (select count(*) from jsonb_object_keys(p_request))<2 then raise exception using errcode='P0400',message='Choose a preference to change'; end if;

 perform 1 from public.clients where id=p_client_id for update;
 select actor_role,actor_id into v_role,v_actor from public.authorize_whole_week(p_auth_user_id,p_client_id);
 v_allowed:=case when v_role='client' then array['revision','activity_client_off','checkin_prompt_client_off']
  else array['revision','activity_coach_enabled','checkin_prompt_coach_enabled'] end;
 if exists(select 1 from jsonb_object_keys(p_request) k where not (k=any(v_allowed))) then
  raise exception using errcode='P0403',message=case when v_role='client' then 'Only your coach can turn this on' else 'Only the client can change their own choice' end;
 end if;

 select * into p from public.client_context_preferences where client_id=p_client_id for update;
 if coalesce(p.revision,0)<>v_expected then
  raise exception using errcode='P0409',message='Preferences changed elsewhere. Reload before saving',hint='revision_conflict';
 end if;
 if p.client_id is null then
  insert into public.client_context_preferences(client_id,activity_coach_enabled,activity_client_off,checkin_prompt_coach_enabled,checkin_prompt_client_off,updated_by_role,updated_by_id)
   values(p_client_id,coalesce((p_request->>'activity_coach_enabled')::boolean,false),coalesce((p_request->>'activity_client_off')::boolean,false),
    coalesce((p_request->>'checkin_prompt_coach_enabled')::boolean,false),coalesce((p_request->>'checkin_prompt_client_off')::boolean,false),v_role,v_actor);
 else
  update public.client_context_preferences set
   activity_coach_enabled=coalesce((p_request->>'activity_coach_enabled')::boolean,activity_coach_enabled),
   activity_client_off=coalesce((p_request->>'activity_client_off')::boolean,activity_client_off),
   checkin_prompt_coach_enabled=coalesce((p_request->>'checkin_prompt_coach_enabled')::boolean,checkin_prompt_coach_enabled),
   checkin_prompt_client_off=coalesce((p_request->>'checkin_prompt_client_off')::boolean,checkin_prompt_client_off),
   updated_by_role=v_role,updated_by_id=v_actor where client_id=p_client_id;
 end if;
 return jsonb_build_object('preferences',public.context_preferences_dto(p_client_id));
end $$;

-- Revoke PUBLIC's default EXECUTE even for invoker helpers; service role only.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('outside_activity_guard','context_preferences_guard','outside_activity_receipt_guard','authorize_whole_week','outside_activity_dto',
  'context_preferences_dto','read_whole_week','mutate_outside_activity','save_context_preferences') loop
 execute format('revoke all on function %s from public, anon, authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
