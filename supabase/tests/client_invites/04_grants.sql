do $$ declare f record; begin
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('reject_invite_identity_mutation','invite_actor_access','invite_attempt_summary','create_client_with_request','apply_invite_action','admit_invite_call','complete_invite_call') loop
  perform pg_temp.check(not f.prosecdef,'invoker '||f.proname);
  perform pg_temp.check(not has_function_privilege('anon',f.oid,'execute') and not has_function_privilege('authenticated',f.oid,'execute'),'denied grants '||f.proname);
  perform pg_temp.check(has_function_privilege('service_role',f.oid,'execute'),'service grant '||f.proname);
  perform pg_temp.check(f.proconfig @> array['search_path=""'],'empty search path '||f.proname);
 end loop;
 perform pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.client_create_requests'::regclass,'public.client_invite_actions'::regclass,'public.client_invite_attempts'::regclass)),'RLS enabled');
end $$;
-- Execute as denied roles as well as inspecting catalog grants.
do $$ begin
 begin set local role anon; perform public.admit_invite_call(null,null);raise exception 'anon execution unexpectedly allowed';exception when insufficient_privilege then reset role;end;
 begin set local role authenticated; perform public.admit_invite_call(null,null);raise exception 'authenticated execution unexpectedly allowed';exception when insufficient_privilege then reset role;end;
 begin set local role anon; perform count(*) from public.client_create_requests;raise exception 'anon receipt read unexpectedly allowed';exception when insufficient_privilege then reset role;end;
end $$;
