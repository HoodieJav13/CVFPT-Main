-- A10 grants: actual role probes plus catalog checks for every outer RPC and internal helper.
create temp table qs_functions (signature text primary key, outer_rpc boolean not null, probe text);
insert into qs_functions values
  ('public.create_quick_session(uuid,uuid,uuid,text,date,text,text,jsonb)', true,
   $q$select public.create_quick_session('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001',pg_temp.h('g'),'2031-04-01','Grant probe',null,pg_temp.body('G'))$q$),
  ('public.get_quick_session_request(uuid,uuid)', true,
   $q$select public.get_quick_session_request('b1000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001')$q$),
  ('public.save_workout_as_template(uuid,uuid,text,uuid)', true,
   $q$select public.save_workout_as_template((select workout_id from public.workout_assignments where create_request_id='c9000000-0000-4000-8000-000000000001'),'b1000000-0000-4000-8000-000000000001',null,null)$q$),
  ('public.save_quick_session_to_library(uuid,uuid)', true,
   $q$select public.save_quick_session_to_library('b1000000-0000-4000-8000-000000000001',(select id from public.workout_assignments where create_request_id='c9000000-0000-4000-8000-000000000001'))$q$),
  ('public.get_quick_session_completion(uuid,uuid[])', true,
   $q$select public.get_quick_session_completion('b2000000-0000-4000-8000-000000000001',array[]::uuid[])$q$),
  ('public.save_workout(uuid,uuid,text,text,text,jsonb)', true,
   $q$select public.save_workout(null,'b1000000-0000-4000-8000-000000000001','Grant workout',null,null,'[]')$q$),
  ('public.save_workout_assignment_with_loads(uuid,uuid,uuid,text,date,text,jsonb)', true, null),
  ('public.start_workout_log(uuid,uuid,uuid,uuid)', true, null),
  ('public.sync_workout_exercises(uuid,jsonb)', false,
   $q$select public.sync_workout_exercises((select id from public.workouts where name='Grant workout' limit 1),'[]')$q$),
  ('public.lock_quick_session_for_write(uuid)', false,
   $q$select public.lock_quick_session_for_write('c9000000-0000-4000-8000-0000000000ff')$q$),
  ('public.assert_quick_session_not_started(uuid)', false,
   $q$select public.assert_quick_session_not_started('c9000000-0000-4000-8000-0000000000ff')$q$),
  ('public.quick_session_can_access_client(uuid,uuid)', false,
   $q$select public.quick_session_can_access_client('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001')$q$),
  ('public.enforce_workout_assignment_receipt()', false, null);

-- Catalog: invoker, empty search_path, no EXECUTE for public/anon/authenticated, service_role has it.
select pg_temp.assert(bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']), 'A10 every quick function is SECURITY INVOKER with an empty search_path')
from qs_functions f join pg_proc p on p.oid = f.signature::regprocedure;
select pg_temp.assert(bool_and(not has_function_privilege('anon', f.signature, 'EXECUTE')
  and not has_function_privilege('authenticated', f.signature, 'EXECUTE')
  and has_function_privilege('service_role', f.signature, 'EXECUTE')), 'A10 EXECUTE is service-role-only for outer RPCs and helpers')
from qs_functions f;
select pg_temp.assert(not exists (
  select 1 from qs_functions f, aclexplode(coalesce((select proacl from pg_proc where oid = f.signature::regprocedure), acldefault('f', 10))) a
  where a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'A10 PUBLIC holds no EXECUTE on any quick function');

-- Role probes: low-privilege roles are denied at execution time; service_role succeeds.
do $$
declare f record; denied int := 0; allowed int := 0;
begin
  for f in select * from qs_functions where probe is not null order by outer_rpc desc, signature loop
    for i in 1..2 loop
      begin
        perform set_config('role', case i when 1 then 'anon' else 'authenticated' end, true);
        execute f.probe;
        perform set_config('role', 'postgres', true);
        raise exception 'FAIL: % executed as %', f.signature, case i when 1 then 'anon' else 'authenticated' end;
      exception when insufficient_privilege then
        perform set_config('role', 'postgres', true);
        denied := denied + 1;
      end;
    end loop;
  end loop;
  for f in select * from qs_functions where probe is not null order by outer_rpc desc, signature loop
    perform set_config('role', 'service_role', true);
    execute f.probe;
    perform set_config('role', 'postgres', true);
    allowed := allowed + 1;
  end loop;
  perform pg_temp.assert(denied = 2 * (select count(*) from qs_functions where probe is not null)
    and allowed = (select count(*) from qs_functions where probe is not null),
    format('A10 role probes: %s anon/authenticated executions denied, %s service_role executions succeeded', denied, allowed));
end $$;
select pg_temp.assert((select state = 'committed' from (select public.get_quick_session_request('b1000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001') ->> 'state' as state) s),
  'A10 the service_role probe really created the receipt');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'public.workout_assignments'::regclass), 'existing RLS on workout_assignments remains enabled');
