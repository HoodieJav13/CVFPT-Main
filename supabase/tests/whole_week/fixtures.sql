-- Fictional actors (example.invalid only). Runs inside each group's
-- transaction, as the owner, before the group switches to service_role.
--  coach A (auth 101) owns client 11 (auth 111) and unclaimed client 13
--  coach B (auth 102) owns client 12 (auth 112); admin (auth 103); unlinked auth 199
create function pg_temp.id(n integer) returns uuid language sql immutable as
 $$ select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

insert into auth.users(id) select pg_temp.id(n) from unnest(array[101,102,103,111,112,199]) n;
insert into public.coaches(id,auth_user_id,name,email,is_admin) values
 (pg_temp.id(1),pg_temp.id(101),'Week Coach','week-coach@example.invalid',false),
 (pg_temp.id(2),pg_temp.id(102),'Other Coach','other-coach@example.invalid',false),
 (pg_temp.id(3),pg_temp.id(103),'Admin Coach','admin-coach@example.invalid',true);
insert into public.clients(id,coach_id,name,auth_user_id) values
 (pg_temp.id(11),pg_temp.id(1),'Week Client',pg_temp.id(111)),
 (pg_temp.id(12),pg_temp.id(2),'Other Client',pg_temp.id(112)),
 (pg_temp.id(13),pg_temp.id(1),'Unclaimed Client',null);
-- Client 11 has outside collection switched on by its coach; 12 and 13 have no row (default off).
insert into public.client_context_preferences(client_id,activity_coach_enabled,updated_by_role,updated_by_id)
 values (pg_temp.id(11),true,'coach',pg_temp.id(1));

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'assertion failed: %', label; end if; end $$;

-- Runs p_sql and requires the exact SQLSTATE (and hint, when given). The
-- inner block is a savepoint, so the failed statement leaves no effect.
create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
 begin
  execute p_sql;
 exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state is distinct from p_state or (p_hint is not null and v_hint is distinct from p_hint) then
   raise exception 'expected % % but got % % for: %', p_state, coalesce(p_hint,''), v_state, coalesce(v_hint,''), p_sql;
  end if;
  return;
 end;
 raise exception 'expected % but the statement succeeded: %', p_state, p_sql;
end $$;

create function pg_temp.act(p_auth integer, p_client integer, p_activity uuid, p_request jsonb) returns jsonb language sql as
 $$ select public.mutate_outside_activity(pg_temp.id(p_auth), case when p_client is null then null else pg_temp.id(p_client) end, p_activity, p_request) $$;
create function pg_temp.create_req(p_rid integer, p_fields jsonb) returns jsonb language sql immutable as
 $$ select jsonb_build_object('action','create','request_id',pg_temp.id(p_rid),'revision',0,'fields',p_fields) $$;
create function pg_temp.update_req(p_rid integer, p_revision integer, p_fields jsonb) returns jsonb language sql immutable as
 $$ select jsonb_build_object('action','update','request_id',pg_temp.id(p_rid),'revision',p_revision,'fields',
   jsonb_build_object('activity_type',null,'occurred_on',null,'label',null,'duration_seconds',null,'effort_rpe',null,'note',null) || p_fields) $$;
create function pg_temp.archive_req(p_rid integer, p_revision integer) returns jsonb language sql immutable as
 $$ select jsonb_build_object('action','archive','request_id',pg_temp.id(p_rid),'revision',p_revision) $$;
create function pg_temp.aid(p_rid integer) returns uuid language sql as
 $$ select activity_id from public.outside_activity_receipts where request_id=pg_temp.id(p_rid) order by created_at limit 1 $$;
create function pg_temp.row_of(p_id uuid) returns public.outside_activities language sql as
 $$ select * from public.outside_activities where id=p_id $$;
create function pg_temp.week(p_auth integer, p_client integer, p_week date) returns jsonb language sql as
 $$ select public.read_whole_week(pg_temp.id(p_auth), pg_temp.id(p_client), p_week) $$;
create function pg_temp.prefs(p_auth integer, p_client integer, p_request jsonb) returns jsonb language sql as
 $$ select public.save_context_preferences(pg_temp.id(p_auth), pg_temp.id(p_client), p_request) $$;
