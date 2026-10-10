do $$ declare r jsonb; replay jsonb; a jsonb; off_result jsonb; attempt uuid; client uuid; lease jsonb; begin
 r := public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001','hash1',
 '{"name":"Fictional Client","email":"invite@example.invalid","coach_id":"10000000-0000-4000-8000-0000000000a1","invite_now":true}',
 '{"from":"test@example.invalid","to":["invite@example.invalid"],"reply_to":"test@example.invalid","subject":"Invite","html":"Hello","text":"Hello"}');
 client := (r->'client'->>'id')::uuid; attempt := (r->>'attempt_id')::uuid;
 perform pg_temp.check(r->>'outcome'='created' and attempt is not null,'create attempt');
 replay := public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001','hash1','{}',null);
 perform pg_temp.check(replay->>'replayed'='true' and replay->>'attempt_id'=attempt::text,'replay bound attempt');
 replay := public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001','hash2','{}',null);
 perform pg_temp.check(replay->>'outcome'='request_mismatch','changed hash mismatch');
 perform pg_temp.check((select count(*)=1 from public.clients where id=client),'one client');
 begin update public.client_create_requests set request_hash='changed' where client_id=client; raise exception 'immutable update accepted'; exception when check_violation then null; end;
 begin delete from public.client_create_requests where client_id=client; raise exception 'immutable delete accepted'; exception when check_violation then null; end;
 lease := public.admit_invite_call('10000000-0000-4000-8000-0000000000a1',attempt);
 perform pg_temp.check(lease->>'admitted'='true','first admission');
 replay := public.admit_invite_call('10000000-0000-4000-8000-0000000000a1',attempt);
 perform pg_temp.check(replay->>'admitted'='false','live lease blocks');
 perform public.complete_invite_call(attempt,(lease->>'lease_token')::uuid,'{"kind":"unknown","code":"timeout"}');
 a := public.apply_invite_action('10000000-0000-4000-8000-0000000000a1',client,'b0000000-0000-4000-8000-000000000001','resend',attempt,false,null);
 perform pg_temp.check(a->'result'->>'attempt_id'=attempt::text and a->'result'->>'outcome'='selected','unknown same-key retry');
 off_result := public.apply_invite_action('10000000-0000-4000-8000-0000000000a1',client,'b0000000-0000-4000-8000-000000000002','switch_off',null,false,null);
 replay := public.apply_invite_action('10000000-0000-4000-8000-0000000000a1',client,'b0000000-0000-4000-8000-000000000001','resend',attempt,false,null);
 perform pg_temp.check(replay->'result'=a->'result','immutable replay');
 lease := public.admit_invite_call('10000000-0000-4000-8000-0000000000a1',attempt);
 perform pg_temp.check(lease->>'admitted'='false' and not (select invited from public.clients where id=client),'off prevents admission');
 update public.clients set coach_id='10000000-0000-4000-8000-0000000000a2' where id=client;
 replay := public.create_client_with_request('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001','hash1','{}',null);
 perform pg_temp.check(replay->>'outcome'='not_found','reauthorize receipt');
end $$;
