-- Coach-authored whole-workout choices. Additive; no original plan or completed-log rewrite.
-- Express verifies provider auth; these service-only invoker RPCs recheck current database roles/ownership.
create table public.workout_rescue_plans (
 program_day_id uuid primary key references public.program_days(id),
 original_version text not null,
 revision bigint not null check(revision>0),
 branches jsonb not null check(jsonb_typeof(branches)='array'),
 authored_by uuid not null references public.coaches(id),
 author_name_snapshot text not null,
 updated_at timestamptz not null default clock_timestamp()
);
create table public.workout_rescue_start_receipts (
 client_id uuid not null references public.clients(id),
 request_id uuid not null,
 request_hash text not null,
 workout_log_id uuid not null unique references public.workout_logs(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(client_id,request_id)
);
alter table public.workout_logs add column rescue_snapshot jsonb;
alter table public.workout_rescue_plans enable row level security;
alter table public.workout_rescue_start_receipts enable row level security;
revoke all on public.workout_rescue_plans,public.workout_rescue_start_receipts from public,anon,authenticated,service_role;
grant select,insert,update on public.workout_rescue_plans to service_role;
grant select,insert on public.workout_rescue_start_receipts to service_role;
create function public.reject_workout_rescue_receipt_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Rescue receipts are append-only'; end; $$;
create trigger rescue_receipt_append_only before update or delete on public.workout_rescue_start_receipts for each row execute function public.reject_workout_rescue_receipt_mutation();

create function public.workout_rescue_access(p_program_id uuid,p_day_id uuid,p_auth_id uuid,p_assignment_id uuid,p_write boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.programs; d public.program_days; c public.coaches; k public.clients; a public.program_assignments; owner_id uuid;
begin
 -- Shared interface with Program History's edit wrappers; no dependency on its migration.
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 select * into p from public.programs where id=p_program_id and not archived for share;
 select * into d from public.program_days where id=p_day_id and program_id=p.id and not archived for share;
 if p.id is null or d.id is null then raise exception 'Program not found'; end if;
 perform 1 from public.workouts where id=d.workout_id and not archived for share;
 if not found then raise exception 'Program not found'; end if;
 perform 1 from public.workout_exercises where workout_id=d.workout_id order by id for share;
 perform 1 from public.exercise_library where id in(select exercise_library_id from public.workout_exercises where workout_id=d.workout_id) order by id for share;
 select * into c from public.coaches where auth_user_id=p_auth_id and not archived for share;
 select coach_id into owner_id from public.clients where id=p.client_id and not archived for share;
 if c.id is not null then
  if not(c.is_admin or p.is_template or coalesce(owner_id=c.id,false)) then raise exception 'Program not found'; end if;
 else
  if p_write then raise exception 'Coach access required'; end if;
  select * into k from public.clients where auth_user_id=p_auth_id and not archived for share;
  if k.id is null or p_assignment_id is null or p.hidden then raise exception 'Program not found'; end if;
 end if;
 if p_assignment_id is not null then
  select * into a from public.program_assignments where id=p_assignment_id and program_id=p.id and not archived for share;
  select * into k from public.clients where id=a.client_id and not archived for share;
  if a.id is null or k.id is null or not(coalesce(c.is_admin,false) or coalesce(c.id=k.coach_id,false) or (c.id is null and k.auth_user_id=p_auth_id)) then raise exception 'Program not found'; end if;
  perform 1 from public.program_assignment_exercise_loads where program_assignment_id=a.id and program_day_id=d.id order by id for share;
 end if;
 return jsonb_build_object('coach_id',c.id,'client_id',k.id,'role',case when c.id is null then 'client' else 'coach' end);
end; $$;

create function public.workout_rescue_original(p_program_id uuid,p_day_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('program_id',p.id,'program_name',p.name,'program_description',p.description,'frequency_days',p.frequency_days,'day_number',d.day_number,'day_id',d.id,'day_notes',d.notes,
 'workout',jsonb_build_object('id',w.id,'updated_at',w.updated_at,'name',w.name,'description',w.description,'goal',w.goal,'exercises',coalesce((
  select jsonb_agg(jsonb_build_object('id',e.id,'exercise_library_id',e.exercise_library_id,'custom_name',e.custom_name,
   'library_exercise',jsonb_build_object('name',l.name,'equipment',l.equipment,'updated_at',l.updated_at),'sets',e.sets,'reps',e.reps,'target_rpe',e.target_rpe,
   'default_load_value',e.default_load_value,'default_load_unit',e.default_load_unit,'rest',e.rest,'rest_seconds',e.rest_seconds,
   'tempo',e.tempo,'client_notes',coalesce(e.client_notes,e.notes),'tracking_type',e.tracking_type,
   'duration_value',e.duration_value,'duration_unit',e.duration_unit,'distance_value',e.distance_value,'distance_unit',e.distance_unit,
   'superset_group',e.superset_group,'position',e.position) order by e.position,e.id)
  from public.workout_exercises e left join public.exercise_library l on l.id=e.exercise_library_id where e.workout_id=w.id and not e.archived),'[]'::jsonb)))
 from public.programs p join public.program_days d on d.program_id=p.id join public.workouts w on w.id=d.workout_id
 where p.id=p_program_id and d.id=p_day_id and not p.archived and not d.archived and not w.archived;
$$;

create function public.read_workout_rescue(p_program_id uuid,p_day_id uuid,p_auth_id uuid,p_assignment_id uuid default null)
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
 select coalesce(jsonb_agg(case when x.value is null then e.value else e.value||jsonb_build_object('default_load_value',x.value->'load_value','default_load_unit',x.value->'load_unit') end order by e.ordinality),'[]') into visible
 from jsonb_array_elements(o#>'{workout,exercises}') with ordinality e(value,ordinality)
 left join lateral (select value from jsonb_array_elements(loads) where value->>'source_id'=e.value->>'id' limit 1) x on true;
 return jsonb_build_object('original',jsonb_set(o,'{workout,exercises}',visible),'current_version',v,
 'selection_version',md5(jsonb_build_object('original',o,'loads',loads,'assignment',p_assignment_id)::text),
 'stale',plan.program_day_id is not null and plan.original_version<>v,
 'plan',jsonb_build_object('version',coalesce(plan.original_version,v),'revision',coalesce(plan.revision,0),'branches',coalesce(plan.branches,'[]'::jsonb)));
end; $$;

create function public.save_workout_rescue(p_program_id uuid,p_day_id uuid,p_auth_id uuid,p_version text,p_revision bigint,p_branches jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb; o jsonb; plan public.workout_rescue_plans; b jsonb; item jsonb; source jsonb; ids text[]:='{}'; seen text[]; actor uuid;
begin
 a:=public.workout_rescue_access(p_program_id,p_day_id,p_auth_id,null,true);actor:=(a->>'coach_id')::uuid;
 o:=public.workout_rescue_original(p_program_id,p_day_id);
 select * into plan from public.workout_rescue_plans where program_day_id=p_day_id for update;
 if p_version is distinct from 'rescue-'||md5(o::text) or p_revision is distinct from coalesce(plan.revision,0) then raise exception 'Original or options changed. Reload and review before saving.'; end if;
 if jsonb_typeof(p_branches) is distinct from 'array' or jsonb_array_length(p_branches)>6 then raise exception 'Invalid fallback options'; end if;
 for b in select value from jsonb_array_elements(p_branches) loop
  if jsonb_typeof(b->'id') is distinct from 'string' or length(b->>'id') not between 1 and 80 or b->>'id'=any(ids)
    or jsonb_typeof(b->'name') is distinct from 'string' or length(btrim(b->>'name')) not between 1 and 80
    or jsonb_typeof(b->'intent') is distinct from 'string' or length(btrim(b->>'intent')) not between 1 and 400
    or jsonb_typeof(b->'enabled') is distinct from 'boolean' or jsonb_typeof(b->'minutes') is distinct from 'number'
    or (b->>'minutes') !~ '^[0-9]+$' then raise exception 'Invalid fallback name, intent or estimate'; end if;
  if (b->>'minutes')::numeric not between 1 and 50 then raise exception 'Fallback estimate must be 1 to 50 minutes'; end if;
  ids:=array_append(ids,b->>'id');
  if jsonb_typeof(b->'equipment') is distinct from 'array' or exists(select 1 from jsonb_array_elements(b->'equipment') v where jsonb_typeof(v) is distinct from 'string' or v#>>'{}' not in ('dumbbells','cable')) then raise exception 'Invalid fallback equipment'; end if;
  if jsonb_typeof(b->'items') is distinct from 'array' or jsonb_array_length(b->'items')<1 then raise exception 'Keep at least one fallback exercise'; end if;
  seen:='{}';
  for item in select value from jsonb_array_elements(b->'items') loop
   select value into source from jsonb_array_elements(o#>'{workout,exercises}') where value->>'id'=item->>'source_id';
   if source is null or item->>'source_id'=any(seen) or jsonb_typeof(item->'sets') is distinct from 'number' or (item->>'sets') !~ '^[0-9]+$' or (source->>'sets') !~ '^[0-9]+$' then raise exception 'Invalid fallback exercise or set count'; end if;
   if (item->>'sets')::numeric not between 1 and least(20,(source->>'sets')::numeric) then raise exception 'Invalid fallback set count'; end if;
   seen:=array_append(seen,item->>'source_id');
  end loop;
 end loop;
 -- Keep only the reviewed contract; arbitrary prescription/actor fields are never persisted.
 select coalesce(jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','intent',value->'intent','minutes',value->'minutes','equipment',value->'equipment','enabled',value->'enabled','items',
  (select jsonb_agg(jsonb_build_object('source_id',i->'source_id','sets',i->'sets')) from jsonb_array_elements(value->'items') i))),'[]') into p_branches from jsonb_array_elements(p_branches);
 insert into public.workout_rescue_plans(program_day_id,original_version,revision,branches,authored_by,author_name_snapshot)
 select p_day_id,p_version,coalesce(plan.revision,0)+1,p_branches,actor,name from public.coaches where id=actor
 on conflict(program_day_id) do update set original_version=excluded.original_version,revision=excluded.revision,branches=excluded.branches,authored_by=excluded.authored_by,author_name_snapshot=excluded.author_name_snapshot,updated_at=clock_timestamp();
 return public.read_workout_rescue(p_program_id,p_day_id,p_auth_id,null);
end; $$;

create function public.start_workout_rescue(p_auth_id uuid,p_client_id uuid,p_assignment_id uuid,p_day_id uuid,p_request jsonb,p_session_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare program_id uuid; a jsonb; view jsonb; branch jsonb; o jsonb; receipt public.workout_rescue_start_receipts; result jsonb; log_id uuid; req_id uuid; req_hash text; e record; item jsonb; changes jsonb:='[]'; change text;
begin
 select pa.program_id into program_id from public.program_assignments pa where pa.id=p_assignment_id and pa.client_id=p_client_id and not pa.archived;
 if program_id is null then raise exception 'Assigned workout not found'; end if;
 a:=public.workout_rescue_access(program_id,p_day_id,p_auth_id,p_assignment_id,false);
 perform 1 from public.clients where id=p_client_id and not archived for update;
 if not found then raise exception 'Client not found'; end if;
 if jsonb_typeof(p_request) is distinct from 'object' or coalesce(p_request->>'request_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then raise exception 'Invalid fallback request'; end if;
 req_id:=(p_request->>'request_id')::uuid;req_hash:=md5(jsonb_build_object('assignment',p_assignment_id,'day',p_day_id,'request',p_request)::text);
 select * into receipt from public.workout_rescue_start_receipts where client_id=p_client_id and request_id=req_id;
 if found then
  if receipt.request_hash<>req_hash then raise exception 'Rescue request changed. Use the original request to retry.'; end if;
  return jsonb_build_object('outcome','replayed','workout_log_id',receipt.workout_log_id);
 end if;
 view:=public.read_workout_rescue(program_id,p_day_id,p_auth_id,p_assignment_id);o:=view->'original';
 if (view->>'stale')::boolean or (p_request->>'version') is distinct from (view#>>'{plan,version}') or (p_request->'revision') is distinct from (view#>'{plan,revision}') or (p_request->>'selection_version') is distinct from (view->>'selection_version') then raise exception 'Original or options changed. Reload and review before starting.'; end if;
 select value into branch from jsonb_array_elements(view#>'{plan,branches}') where (value->>'id')=(p_request->>'branch_id') and (value->'enabled')='true'::jsonb;
 if branch is null then raise exception 'No saved fallback is available'; end if;
 if jsonb_typeof(p_request->'minutes') is distinct from 'number' or jsonb_typeof(p_request->'equipment') is distinct from 'array' then raise exception 'Invalid fallback context'; end if;
 if (p_request->>'minutes')::numeric < (branch->>'minutes')::numeric or not((p_request->'equipment') @> (branch->'equipment')) then raise exception 'No fallback fits this time and equipment combination'; end if;
 result:=public.start_workout_log_v2(p_client_id,p_assignment_id,p_day_id,null,a->>'role',(a->>'coach_id')::uuid,p_session_id);
 if result->>'outcome'<>'started' then return jsonb_build_object('outcome','conflict','workout_log_id',result->'workout_log_id'); end if;
 log_id:=(result->>'workout_log_id')::uuid;
 for e in select * from public.workout_log_exercises where workout_log_id=log_id order by position,id loop
  select value into item from jsonb_array_elements(branch->'items') where value->>'source_id'=e.source_workout_exercise_id::text;
  if item is null then
   update public.workout_log_sets set archived=true where workout_log_exercise_id=e.id;
   update public.workout_log_exercises set archived=true where id=e.id;
   change:='Dropped';
  else
   update public.workout_log_sets set archived=true where workout_log_exercise_id=e.id and set_number>(item->>'sets')::integer;
   update public.workout_log_exercises set prescribed_sets=item->>'sets' where id=e.id;
   change:=case when e.prescribed_sets=item->>'sets' then 'Unchanged' else e.prescribed_sets||' → '||(item->>'sets')||' sets' end;
  end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('id',e.source_workout_exercise_id,'name',e.exercise_name,'change',change));
 end loop;
 update public.workout_logs set workout_name=workout_name||' · '||(branch->>'name'),rescue_snapshot=jsonb_build_object('branch_id',branch->'id','branch_name',branch->'name','revision',view#>'{plan,revision}','original_version',view#>'{plan,version}','selection_version',view->'selection_version','intent',branch->'intent','changes',changes,'original',o,'request_id',req_id,'authored_by',(select authored_by from public.workout_rescue_plans where program_day_id=p_day_id),'author_name_snapshot',(select author_name_snapshot from public.workout_rescue_plans where program_day_id=p_day_id),'authored_at',(select updated_at from public.workout_rescue_plans where program_day_id=p_day_id)) where id=log_id;
 insert into public.workout_rescue_start_receipts(client_id,request_id,request_hash,workout_log_id) values(p_client_id,req_id,req_hash,log_id);
 return result;
end; $$;

revoke all on function public.reject_workout_rescue_receipt_mutation(),public.workout_rescue_access(uuid,uuid,uuid,uuid,boolean),public.workout_rescue_original(uuid,uuid),public.read_workout_rescue(uuid,uuid,uuid,uuid),public.save_workout_rescue(uuid,uuid,uuid,text,bigint,jsonb),public.start_workout_rescue(uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workout_rescue_access(uuid,uuid,uuid,uuid,boolean),public.workout_rescue_original(uuid,uuid),public.read_workout_rescue(uuid,uuid,uuid,uuid),public.save_workout_rescue(uuid,uuid,uuid,text,bigint,jsonb),public.start_workout_rescue(uuid,uuid,uuid,uuid,jsonb,uuid) to service_role;
