-- Integration only: preserve all three input migrations byte-for-byte.
-- Invoker replacements retain existing service-only ACLs and signatures.
-- Supported history edits, ordinary starts, Rescue starts and cue writes use
-- history advisory -> optional Quick advisory -> current client -> source/assignment/log ordering.

create or replace function public.start_workout_rescue_with_cues(p_auth_id uuid,p_client_id uuid,p_assignment_id uuid,p_day_id uuid,p_request jsonb,p_session_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare program_id uuid; a jsonb; view jsonb; branch jsonb; o jsonb; receipt public.workout_rescue_start_receipts; result jsonb; log_id uuid; req_id uuid; req_hash text; e record; item jsonb; changes jsonb:='[]'; change text;
begin
 -- Shared edit lock first, then current client, then source/assignment rows.
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 perform 1 from public.clients where id=p_client_id and not archived for update;
 if not found then raise exception 'Client not found'; end if;
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
 -- Only fresh starts reach here. Final omissions and prescriptions are frozen
 -- before cue matching; replay/resume never bind. Failure rolls all of it back.
 perform public.bind_next_exercise_cues(log_id);
 insert into public.workout_rescue_start_receipts(client_id,request_id,request_hash,workout_log_id) values(p_client_id,req_id,req_hash,log_id);
 return result;
end; $$;

create or replace function public.start_workout_log_with_cues(p_client_id uuid,p_program_assignment_id uuid,p_program_day_id uuid,p_workout_assignment_id uuid,p_started_by text,p_started_by_coach_id uuid,p_session_id uuid,p_auth_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; result jsonb; quick_workout uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 -- Canonical Quick order is quick advisory -> client -> assignment/workout.
 select workout_id into quick_workout from public.workout_assignments where id=p_workout_assignment_id and kind='quick';
 if quick_workout is not null then perform public.lock_quick_session_for_write(quick_workout); end if;
 perform 1 from public.clients where id=p_client_id for update;
 actor:=public.authorize_exercise_cue(p_auth_user_id,p_client_id,false);
 if (actor is null and (p_started_by is distinct from 'client' or p_started_by_coach_id is not null)) or (actor is not null and (p_started_by is distinct from 'coach' or p_started_by_coach_id is distinct from actor)) then raise exception using errcode='P0403',message='Invalid starting actor'; end if;
 -- Assignment row locks also fence supported load saves (including new load rows).
 perform 1 from public.program_assignments where id=p_program_assignment_id for share;
 perform 1 from public.workout_assignments where id=p_workout_assignment_id for share;
 result:=public.start_workout_log_v2(p_client_id,p_program_assignment_id,p_program_day_id,p_workout_assignment_id,p_started_by,p_started_by_coach_id,p_session_id);
 if result->>'outcome'='started' then perform public.bind_next_exercise_cues((result->>'workout_log_id')::uuid); end if;
 return result;
end $$;

create or replace function public.mutate_exercise_cue(p_auth_user_id uuid,p_log_id uuid,p_exercise_id uuid,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.workout_logs%rowtype; e public.workout_log_exercises%rowtype; q public.exercise_attempt_cues%rowtype; receipt public.exercise_cue_receipts%rowtype;
 actor uuid; quick_workout uuid; version text; txt text; action text:=p_request->>'action'; rid uuid; expected integer; frozen jsonb; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 select * into l from public.workout_logs where id=p_log_id and not archived;
 select workout_id into quick_workout from public.workout_assignments where id=l.workout_assignment_id and kind='quick';
 if quick_workout is not null then perform public.lock_quick_session_for_write(quick_workout); end if;
 -- Same client-first lock as tracked starts: concurrent cue/save/start cannot
 -- miss a committed waiting cue or apply one retroactively to a resumed log.
 perform 1 from public.clients where id=l.client_id for update;
 actor:=public.authorize_exercise_cue(p_auth_user_id,l.client_id,true);
 perform 1 from public.program_assignments where id=l.program_assignment_id for share;
 perform 1 from public.workout_assignments where id=l.workout_assignment_id for share;
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

revoke all on function public.start_workout_rescue_with_cues(uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.start_workout_rescue_with_cues(uuid,uuid,uuid,uuid,jsonb,uuid) to service_role;

-- History-wrapped Quick edits must also preserve the canonical Quick order.
create or replace function public.save_workout_with_program_history(p_workout_id uuid,p_actor_coach_id uuid,p_name text,p_description text,p_goal text,p_exercises jsonb)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_workout public.workouts; v_admin boolean; v_owner uuid; v_before jsonb:='[]'; v_row record;
begin
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 -- Canonical save_workout takes this same Quick lock; acquire before source rows.
 perform public.lock_quick_session_for_write(p_workout_id);
 select is_admin into v_admin from public.coaches where id=p_actor_coach_id and not archived;
 if not found then raise exception 'Workout not found'; end if;
 select * into v_workout from public.workouts where id=p_workout_id and not archived for update;
 if not found then raise exception 'Workout not found'; end if;
 select coach_id into v_owner from public.clients where id=v_workout.client_id and not archived for share;
 if not(v_admin or v_workout.is_template or coalesce(v_owner=p_actor_coach_id,false)) then raise exception 'Workout not found'; end if;
 for v_row in select distinct p.id from public.programs p join public.program_days d on d.program_id=p.id
   where d.workout_id=p_workout_id and not p.archived and not d.archived order by p.id loop
  v_before:=v_before||jsonb_build_array(jsonb_build_object('id',v_row.id,'snapshot',public.program_history_snapshot(v_row.id)));
 end loop;
 v_id:=public.save_workout(p_workout_id,v_workout.coach_id,p_name,p_description,p_goal,p_exercises);
 for v_row in select value from jsonb_array_elements(v_before) loop
  perform public.program_history_record((v_row.value->>'id')::uuid,v_row.value->'snapshot',p_actor_coach_id,'Stored workout prescription edit');
 end loop;
 return v_id;
end; $$;
