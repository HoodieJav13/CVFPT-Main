-- Transactional combined contract: fictional data only; run against an owned local stack.
\set ON_ERROR_STOP on
begin;
create function pg_temp.integration_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %',label; end $$;
do $$
declare
 actor uuid := 'f5000000-0000-4000-8000-000000000001';
 other_actor uuid := 'f5000000-0000-4000-8000-000000000002';
 request uuid := 'f6000000-0000-4000-8000-000000000001';
 created jsonb; quick jsonb; a uuid; w uuid; c uuid; t uuid;
begin
 insert into public.coaches(id,name,email) values(actor,'Integration Coach','integration-coach@example.invalid'),(other_actor,'Other Integration Coach','other-integration@example.invalid');
 created := public.create_client_with_request(actor,request,'integration-client',jsonb_build_object('name','Integration Client','email','integration@example.invalid','coach_id',actor,'invite_now',false),null);
 c := (created->'client'->>'id')::uuid;
 perform pg_temp.integration_assert(created->>'outcome'='created' and created->>'attempt_id' is null, 'combined client creation without email transport');
 quick := public.create_quick_session(actor,c,request,'v1:'||repeat('f',64),'2031-05-01','Combined quick',null,'[{"custom_name":"Fictional carry","sets":"2","tracking_type":"distance","distance_value":100,"distance_unit":"m"}]');
 a := (quick->>'assignment_id')::uuid; w := (quick->>'workout_id')::uuid;
 perform pg_temp.integration_assert(quick->>'state'='created' and (select not invited and auth_user_id is null from public.clients where id=c), 'combined quick assignment does not require claim permission or auth identity');
 perform pg_temp.integration_assert((select count(*)=1 from public.client_create_requests where actor_coach_id=actor and request_id=request) and (select count(*)=1 from public.workout_assignments where created_by_coach_id=actor and create_request_id=request), 'same actor/UUID belongs to independent client and quick receipt namespaces');
 perform pg_temp.integration_assert(public.create_client_with_request(actor,request,'integration-client','{}',null)->>'replayed'='true' and public.get_quick_session_request(actor,request)->>'state'='committed', 'both independent receipts recover/replay without duplicate creation');
 perform public.apply_invite_action(actor,c,gen_random_uuid(),'switch_on',null,false,null);
 perform public.save_workout(w,actor,'Edited combined quick',null,null,'[{"custom_name":"Fictional carry","sets":"3","tracking_type":"distance","distance_value":200,"distance_unit":"m"}]');
 t := public.save_workout_as_template(w,actor,null,null);
 perform pg_temp.integration_assert((select name='Edited combined quick' from public.workouts where id=t) and (select count(*)=1 and bool_and(sets='3' and distance_value=200 and tracking_type='distance') from public.workout_exercises where workout_id=t and not archived), 'combined shared writer and generic template clone retain coherent typed prescription');
 perform public.apply_invite_action(actor,c,gen_random_uuid(),'switch_off',null,false,null);
 perform pg_temp.integration_assert(public.get_quick_session_request(actor,request)->>'state'='committed' and (select not invited from public.clients where id=c), 'withdrawal changes invite permission independently of coach workout recovery');
 update public.clients set coach_id=other_actor where id=c;
 perform pg_temp.integration_assert(public.create_client_with_request(actor,request,'integration-client','{}',null)->>'outcome'='not_found' and public.get_quick_session_request(actor,request)->>'state'='not_found', 'reassignment masks both original-owner receipt recoveries');
end $$;
rollback;
