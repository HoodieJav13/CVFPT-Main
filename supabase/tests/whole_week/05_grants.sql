-- Service-only boundary: RLS on, no policies, no browser grants, least service
-- grants, EXECUTE revoked from PUBLIC/anon/authenticated, invoker functions
-- with a pinned empty search_path, append-only receipts, no hard deletes.
create temp table ww_functions as
 select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('outside_activity_guard','context_preferences_guard','outside_activity_receipt_guard',
  'authorize_whole_week','outside_activity_dto','context_preferences_dto','read_whole_week','mutate_outside_activity','save_context_preferences');
select pg_temp.check((select count(*) from ww_functions)=9, 'all nine functions exist');
select pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.outside_activities'::regclass,'public.outside_activity_receipts'::regclass,'public.client_context_preferences'::regclass)), 'RLS enabled');
select pg_temp.check((select count(*) from pg_policy where polrelid in
  ('public.outside_activities'::regclass,'public.outside_activity_receipts'::regclass,'public.client_context_preferences'::regclass))=0, 'no policies');
select pg_temp.check(not has_table_privilege(r, t, p), format('%s has no %s on %s', r, p, t))
from unnest(array['anon','authenticated']) r,
 unnest(array['public.outside_activities','public.outside_activity_receipts','public.client_context_preferences']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
select pg_temp.check(has_table_privilege('service_role','public.outside_activities','SELECT,INSERT,UPDATE')
  and not has_table_privilege('service_role','public.outside_activities','DELETE')
  and not has_table_privilege('service_role','public.outside_activities','TRUNCATE'), 'activities: select/insert/update only');
select pg_temp.check(has_table_privilege('service_role','public.client_context_preferences','SELECT,INSERT,UPDATE')
  and not has_table_privilege('service_role','public.client_context_preferences','DELETE'), 'preferences: select/insert/update only');
select pg_temp.check(has_table_privilege('service_role','public.outside_activity_receipts','SELECT,INSERT')
  and not has_table_privilege('service_role','public.outside_activity_receipts','UPDATE')
  and not has_table_privilege('service_role','public.outside_activity_receipts','DELETE'), 'receipts: select/insert only');
select pg_temp.check(not has_function_privilege(r, f.oid, 'EXECUTE') , format('%s cannot execute %s', r, f.proname))
from unnest(array['anon','authenticated']) r, ww_functions f;
select pg_temp.check(has_function_privilege('service_role', f.oid, 'EXECUTE'), format('service_role executes %s', f.proname)) from ww_functions f;
select pg_temp.check(not exists(select 1 from pg_proc p join ww_functions f on f.oid=p.oid,
  aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC has no EXECUTE');
select pg_temp.check(p.proconfig @> array['search_path=""'] and not p.prosecdef, format('%s: invoker with pinned search_path', p.proname))
from pg_proc p join ww_functions f on f.oid=p.oid;

-- Browser roles are refused at the boundary.
set role anon;
select pg_temp.expect_error($$select * from public.outside_activities$$,'42501');
select pg_temp.expect_error($$select public.read_whole_week(null,null,'2026-03-02')$$,'42501');
reset role;
set role authenticated;
select pg_temp.expect_error($$select * from public.client_context_preferences$$,'42501');
select pg_temp.expect_error($$select public.mutate_outside_activity(null,null,null,'{}')$$,'42501');
reset role;

-- The service role cannot delete or rewrite history directly.
set role service_role;
select pg_temp.act(111,11,null,pg_temp.create_req(601,'{"activity_type":"run","occurred_on":"2026-03-03","note":"Private note"}'));
select pg_temp.expect_error($$delete from public.outside_activities$$,'42501');
select pg_temp.expect_error($$delete from public.client_context_preferences$$,'42501');
select pg_temp.expect_error($$update public.outside_activity_receipts set committed_revision=9$$,'42501');
reset role;
-- Even the owner meets the triggers: soft archive only, immutable identity/author, append-only receipts.
select pg_temp.expect_error($$delete from public.outside_activities$$,'P0001');
select pg_temp.expect_error($$delete from public.client_context_preferences$$,'P0001');
select pg_temp.expect_error($$update public.outside_activity_receipts set committed_revision=9$$,'P0001');
select pg_temp.expect_error($$delete from public.outside_activity_receipts$$,'P0001');
select pg_temp.expect_error($$update public.outside_activities set client_id=pg_temp.id(12)$$,'P0001');
select pg_temp.expect_error($$update public.outside_activities set created_by_id=pg_temp.id(2), created_by_role='coach'$$,'P0001');
select pg_temp.expect_error($$update public.client_context_preferences set client_id=pg_temp.id(12)$$,'P0001');
update public.outside_activities set archived=true where id=pg_temp.aid(601);
select pg_temp.expect_error($$update public.outside_activities set archived=false where id=pg_temp.aid(601)$$,'P0001');
-- Receipts carry no note/body/answer snapshot: only the hash and committed identity.
select pg_temp.check((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema='public' and table_name='outside_activity_receipts')
  =array['action','activity_id','actor_auth_user_id','client_id','committed_revision','created_at','request_hash','request_id'], 'minimal receipt columns');
select pg_temp.check(not exists(select 1 from public.outside_activity_receipts r where to_jsonb(r)::text like '%Private note%'), 'no note text in receipts');
