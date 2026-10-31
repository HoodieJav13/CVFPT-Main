-- LOCAL/TEST ONLY. Forward capture starts at the first observed supported edit.
-- No backfill. Existing writers stay intact; wrappers add atomic journal writes.
create table public.program_change_revisions (
 id bigint generated always as identity primary key,
 program_id uuid not null references public.programs(id),
 change_id uuid not null,
 snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
 check (snapshot->>'id' is not null and snapshot->>'id'=program_id::text),
 author_coach_id uuid references public.coaches(id),
 author_name_snapshot text,
 recorded_at timestamptz,
 observed_at timestamptz not null default clock_timestamp(),
 source text not null,
 check ((author_coach_id is null and author_name_snapshot is null and recorded_at is null)
     or (author_coach_id is not null and author_name_snapshot is not null and recorded_at is not null))
);
create index program_change_revisions_program on public.program_change_revisions(program_id,id desc);
alter table public.program_change_revisions enable row level security;
revoke all on public.program_change_revisions from public,anon,authenticated,service_role;
grant select,insert on public.program_change_revisions to service_role;
revoke all on sequence public.program_change_revisions_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.program_change_revisions_id_seq to service_role;
create function public.program_history_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Program history is append-only'; end; $$;
create trigger program_history_append_only before update or delete on public.program_change_revisions
 for each row execute function public.program_history_append_only();

create function public.program_history_snapshot(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'frequency_days',p.frequency_days,'days',
 coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'day_number',d.day_number,'notes',d.notes,'workout',
 jsonb_build_object('id',w.id,'name',w.name,'description',w.description,'goal',w.goal,'exercises',
 coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(e.custom_name,''),l.name,'Exercise'),'exercise_library_id',e.exercise_library_id,'sets',e.sets,'reps',e.reps,'rest',e.rest,'rest_seconds',e.rest_seconds,'tempo',e.tempo,'target_rpe',e.target_rpe,'tracking_type',e.tracking_type,'duration_value',e.duration_value,'duration_unit',e.duration_unit,'distance_value',e.distance_value,'distance_unit',e.distance_unit,'default_load_value',e.default_load_value,'default_load_unit',e.default_load_unit,'notes',e.notes,'client_notes',e.client_notes,'coach_notes',e.coach_notes,'video_url',e.video_url,'video_link_mode',e.video_link_mode,'superset_group',e.superset_group) order by e.position,e.id) from public.workout_exercises e
 left join public.exercise_library l on l.id=e.exercise_library_id where e.workout_id=w.id and not e.archived),'[]'::jsonb))) order by d.day_number,d.id)
 from public.program_days d join public.workouts w on w.id=d.workout_id where d.program_id=p.id and not d.archived),'[]'::jsonb))
 from public.programs p where p.id=p_id;
$$;

create function public.program_history_record(p_id uuid,p_before jsonb,p_actor uuid,p_source text) returns void
 language plpgsql security invoker set search_path='' as $$
declare v_after jsonb:=public.program_history_snapshot(p_id); v_last jsonb; v_change uuid:=gen_random_uuid(); v_name text;
begin
 if p_before is not distinct from v_after then return; end if;
 select name into strict v_name from public.coaches where id=p_actor and not archived;
 select snapshot into v_last from public.program_change_revisions where program_id=p_id order by id desc limit 1;
 if p_before is not null and p_before is distinct from v_last then
  insert into public.program_change_revisions(program_id,change_id,snapshot,source)
  values(p_id,v_change,p_before,case when v_last is null then 'First observed snapshot · earlier history unavailable' else 'Observed snapshot · intervening changes unavailable' end);
 end if;
 insert into public.program_change_revisions(program_id,change_id,snapshot,author_coach_id,author_name_snapshot,recorded_at,source)
 values(p_id,v_change,v_after,p_actor,v_name,clock_timestamp(),p_source);
end; $$;

create function public.save_program_with_history(p_program_id uuid,p_actor_coach_id uuid,p_name text,p_description text,p_frequency_days integer,p_days jsonb)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_before jsonb; v_program public.programs; v_admin boolean; v_owner uuid;
begin
 -- Low-volume coach editors share one transaction lock, then lock target rows.
 -- Both wrappers use this ordering; no historical revision can interleave a save.
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
 select is_admin into v_admin from public.coaches where id=p_actor_coach_id and not archived;
 if not found then raise exception 'Program not found'; end if;
 if p_program_id is not null then
  select * into v_program from public.programs where id=p_program_id and not archived for update;
  if not found then raise exception 'Program not found'; end if;
  select coach_id into v_owner from public.clients where id=v_program.client_id and not archived for share;
  if not (v_admin or v_program.is_template or coalesce(v_owner=p_actor_coach_id,false)) then raise exception 'Program not found'; end if;
  v_before:=public.program_history_snapshot(p_program_id);
 end if;
 v_id:=public.save_program(p_program_id,coalesce(v_program.coach_id,p_actor_coach_id),v_admin,p_name,p_description,p_frequency_days,p_days);
 if v_id is not null then perform public.program_history_record(v_id,v_before,p_actor_coach_id,'Stored program edit'); end if;
 return v_id;
end; $$;

create function public.save_workout_with_program_history(p_workout_id uuid,p_actor_coach_id uuid,p_name text,p_description text,p_goal text,p_exercises jsonb)
 returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_workout public.workouts; v_admin boolean; v_owner uuid; v_before jsonb:='[]'; v_row record;
begin
 perform pg_advisory_xact_lock(hashtextextended('cvf:program-history-edit:v1',0));
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

revoke all on function public.program_history_append_only(),public.program_history_snapshot(uuid),public.program_history_record(uuid,jsonb,uuid,text),
 public.save_program_with_history(uuid,uuid,text,text,integer,jsonb),public.save_workout_with_program_history(uuid,uuid,text,text,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.program_history_snapshot(uuid),public.program_history_record(uuid,jsonb,uuid,text),
 public.save_program_with_history(uuid,uuid,text,text,integer,jsonb),public.save_workout_with_program_history(uuid,uuid,text,text,text,jsonb) to service_role;
