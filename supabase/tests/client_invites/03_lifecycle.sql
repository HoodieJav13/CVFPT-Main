do $$ declare actor uuid:='10000000-0000-4000-8000-0000000000a1'; r jsonb; a uuid; c uuid; lease jsonb; before_count integer; body jsonb:='{"from":"test@example.invalid","to":["same@example.invalid"],"reply_to":"test@example.invalid","subject":"Frozen","html":"Frozen","text":"Frozen"}'; begin
 r:=public.create_client_with_request(actor,'a0000000-0000-4000-8000-000000000031','lifecycle','{"name":"Lifecycle","email":"same@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":true}',body);c:=(r->'client'->>'id')::uuid;a:=(r->>'attempt_id')::uuid;
 update public.clients set archived=true where id=c;lease:=public.admit_invite_call(actor,a);perform pg_temp.check(lease->>'admitted'='false','archive-before-admission blocks');
 update public.clients set archived=false,email='changed@example.invalid' where id=c;lease:=public.admit_invite_call(actor,a);perform pg_temp.check(lease->>'admitted'='false','email edit-before-admission blocks');
 update public.clients set email='same@example.invalid' where id=c;
 insert into auth.users(id) values ('d0000000-0000-4000-8000-000000000031');
 update public.clients set auth_user_id='d0000000-0000-4000-8000-000000000031' where id=c;
 lease:=public.admit_invite_call(actor,a);perform pg_temp.check(lease->>'admitted'='false','claim-before-admission blocks');
 r:=public.apply_invite_action(actor,c,'b0000000-0000-4000-8000-000000000031','switch_off',null,false,null);perform pg_temp.check(r->'result'->>'outcome'='already_claimed' and (select invited from public.clients where id=c),'claimed off preserves permission');
 update public.clients set auth_user_id=null where id=c;
 lease:=public.admit_invite_call(actor,a);r:=public.complete_invite_call(a,(lease->>'lease_token')::uuid,jsonb_build_object('kind','backoff','code','rate_limit_exceeded','retry_after_at',clock_timestamp()+interval '1 minute'));
 perform pg_temp.check(r->>'status'='pending','known backoff is not uncertainty');lease:=public.admit_invite_call(actor,a);perform pg_temp.check(lease->>'admitted'='false','backoff admission blocks');
 update public.client_invite_attempts set retry_after_at=clock_timestamp()-interval '1 second' where id=a;
 lease:=public.admit_invite_call(actor,a);r:=public.complete_invite_call(a,(lease->>'lease_token')::uuid,'{"kind":"unknown","code":"PRIVATE_CANARY"}');
 perform pg_temp.check((select last_error_code='unclassified' from public.client_invite_attempts where id=a),'arbitrary error discarded');
 perform pg_temp.check(not (r ? 'provider_body') and not(r ? 'recipient_email'),'summary excludes body and recipient');
 update public.coaches set archived=true where id=actor;r:=public.create_client_with_request(actor,'a0000000-0000-4000-8000-000000000031','lifecycle','{}',null);perform pg_temp.check(r->>'outcome'='not_found','inactive actor cannot replay');update public.coaches set archived=false where id=actor;
 r:=public.create_client_with_request(actor,'a0000000-0000-4000-8000-000000000032','duplicate-email','{"name":"Separate Client","email":"same@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":false}',null);perform pg_temp.check(r->>'outcome'='created' and (select count(*)=2 from public.clients where email='same@example.invalid'),'no new email uniqueness rule');
end $$;
-- Force a receipt insert failure after the client/attempt inserts, then prove rollback and retry.
create function pg_temp.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'test receipt failure' using errcode='23514';end $$;
create trigger test_fail_receipt before insert on public.client_create_requests for each row execute function pg_temp.fail_receipt();
do $$ declare before_count integer; begin
 select count(*) into before_count from public.clients;
 begin perform public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000033','failure','{"name":"Rollback","email":"rollback@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":true}','{"text":"Frozen"}');raise exception 'failure trigger did not run';exception when check_violation then null;end;
 perform pg_temp.check((select count(*)=before_count from public.clients),'receipt failure rolls back client');
 perform pg_temp.check(not exists(select 1 from public.client_create_requests where request_id='a0000000-0000-4000-8000-000000000033'),'receipt failure leaves identity unused');
end $$;
drop trigger test_fail_receipt on public.client_create_requests;
-- Render happened before an email edit; no newly bound attempt may send the old body.
do $$ declare r jsonb; c uuid; before_count integer; begin
 r:=public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000034','snapshot','{"name":"Snapshot","email":"old@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":false}',null);c:=(r->'client'->>'id')::uuid;
 update public.clients set email='new@example.invalid' where id=c;
 select count(*) into before_count from public.client_invite_attempts where client_id=c;
 r:=public.apply_invite_action('10000000-0000-4000-8000-0000000000a1',c,'b0000000-0000-4000-8000-000000000034','switch_on',null,false,'{"to":["old@example.invalid"],"text":"Frozen"}');
 perform pg_temp.check(r->'result'->>'outcome'='stale' and (select count(*)=before_count from public.client_invite_attempts where client_id=c),'rendered recipient differs from locked client; no attempt');
 r:=public.apply_invite_action('10000000-0000-4000-8000-0000000000a1',c,'b0000000-0000-4000-8000-000000000035','switch_on',null,false,'{"to":["new@example.invalid"],"text":"Frozen"}');
 perform pg_temp.check(r->'result'->>'outcome'='selected','fresh render creates correct attempt');
end $$;
