-- LOCAL DRAFT: independent SQL review and separate hosted approval required.
create table public.client_invite_attempts (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 created_by uuid not null references public.coaches(id), origin text not null check(origin in ('create','switch','resend')),
 recipient_email text not null, provider_body jsonb,
 status text not null default 'pending' check(status in ('pending','accepted','failed','unknown','unconfigured')),
 uncertain boolean not null default false, retry_disabled boolean not null default false,
 provider_message_id text, last_error_code text, retry_after_at timestamptz,
 first_provider_call_at timestamptz, lease_token uuid, lease_expires_at timestamptz,
 admitted_calls integer not null default 0, completed_calls integer not null default 0,
 closed_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index client_invite_attempts_latest on public.client_invite_attempts(client_id,created_at desc,id desc);
create table public.client_create_requests (
 id uuid primary key default gen_random_uuid(), actor_coach_id uuid not null references public.coaches(id),
 request_id uuid not null, request_hash text not null, client_id uuid not null references public.clients(id),
 create_attempt_id uuid references public.client_invite_attempts(id), created_at timestamptz not null default now(),
 unique(actor_coach_id,request_id)
);
create table public.client_invite_actions (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 actor_coach_id uuid not null references public.coaches(id), action_id uuid not null,
 kind text not null check(kind in ('switch_on','switch_off','resend')), result jsonb not null,
 attempt_id uuid references public.client_invite_attempts(id), created_at timestamptz not null default now(),
 unique(actor_coach_id,action_id)
);
alter table public.client_invite_attempts enable row level security;
alter table public.client_create_requests enable row level security;
alter table public.client_invite_actions enable row level security;
revoke all on public.client_invite_attempts,public.client_create_requests,public.client_invite_actions from public,anon,authenticated;
grant select,insert,update,delete on public.client_invite_attempts,public.client_create_requests,public.client_invite_actions to service_role;

create function public.reject_invite_identity_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Immutable invite identity' using errcode='23514'; end $$;
create trigger immutable_create_receipt before update or delete on public.client_create_requests for each row execute function public.reject_invite_identity_mutation();
create trigger immutable_invite_action before update or delete on public.client_invite_actions for each row execute function public.reject_invite_identity_mutation();

create function public.invite_actor_access(p_actor uuid,p_coach uuid) returns boolean language sql security invoker set search_path='' as $$
 select exists(select 1 from public.coaches where id=p_actor and not archived and (is_admin or id=p_coach));
$$;
create function public.invite_attempt_summary(p_attempt public.client_invite_attempts) returns jsonb language sql security invoker set search_path='' as $$
 select case when p_attempt.id is null then null else jsonb_build_object(
 'attempt_id',p_attempt.id,'status',case when p_attempt.status='pending' and p_attempt.admitted_calls>p_attempt.completed_calls and p_attempt.lease_expires_at<=clock_timestamp() then 'unknown' else p_attempt.status end,
 'retryable',p_attempt.status<>'accepted' and p_attempt.closed_at is null and not p_attempt.retry_disabled and p_attempt.provider_body is not null
   and (p_attempt.first_provider_call_at is null or p_attempt.first_provider_call_at>clock_timestamp()-interval '23 hours'),
 'next_retry_at',p_attempt.retry_after_at,
 'needs_confirmation',p_attempt.status<>'accepted' and (p_attempt.uncertain or p_attempt.admitted_calls>p_attempt.completed_calls)
   and (p_attempt.retry_disabled or p_attempt.closed_at is not null or p_attempt.first_provider_call_at<=clock_timestamp()-interval '23 hours'),
 'message_key',case when p_attempt.status='pending' and p_attempt.admitted_calls>p_attempt.completed_calls and p_attempt.lease_expires_at<=clock_timestamp() then 'unknown' else p_attempt.status end) end;
$$;

create function public.create_client_with_request(p_actor uuid,p_request_id uuid,p_hash text,p_client jsonb,p_provider_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.client_create_requests%rowtype; c public.clients%rowtype; a uuid; target uuid; begin
 if p_actor is null or p_request_id is null or p_hash is null then raise exception 'Identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('client-create/'||p_actor::text||'/'||p_request_id::text,0));
 select * into r from public.client_create_requests where actor_coach_id=p_actor and request_id=p_request_id;
 if r.id is not null then
  select * into c from public.clients where id=r.client_id for update;
  if not public.invite_actor_access(p_actor,c.coach_id) then return jsonb_build_object('outcome','not_found'); end if;
  return jsonb_build_object('outcome',case when r.request_hash=p_hash then 'created' else 'request_mismatch' end,
   'client',to_jsonb(c),'attempt_id',r.create_attempt_id,'replayed',true);
 end if;
 target:=(p_client->>'coach_id')::uuid;
 if not public.invite_actor_access(p_actor,target) or not exists(select 1 from public.coaches where id=target and not archived) then
  return jsonb_build_object('outcome','not_found');
 end if;
 if nullif(btrim(p_client->>'name'),'') is null or (coalesce((p_client->>'invite_now')::boolean,false) and nullif(p_client->>'email','') is null) then raise exception 'Invalid client'; end if;
 insert into public.clients(coach_id,name,email,phone,goals,health_notes,invited)
 values(target,p_client->>'name',p_client->>'email',p_client->>'phone',p_client->>'goals',p_client->>'health_notes',coalesce((p_client->>'invite_now')::boolean,false)) returning * into c;
 if c.invited then
  insert into public.client_invite_attempts(client_id,created_by,origin,recipient_email,provider_body,status)
  values(c.id,p_actor,'create',c.email,p_provider_body,case when p_provider_body is null then 'unconfigured' else 'pending' end) returning id into a;
 end if;
 insert into public.client_create_requests(actor_coach_id,request_id,request_hash,client_id,create_attempt_id) values(p_actor,p_request_id,p_hash,c.id,a);
 return jsonb_build_object('outcome','created','client',to_jsonb(c),'attempt_id',a,'replayed',false);
end $$;

create function public.apply_invite_action(p_actor uuid,p_client_id uuid,p_action_id uuid,p_kind text,p_supersedes_attempt_id uuid,p_confirm_duplicate_risk boolean,p_provider_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; old public.client_invite_actions%rowtype; a public.client_invite_attempts%rowtype; result jsonb; attempt uuid; begin
 if p_actor is null or p_action_id is null or p_kind not in ('switch_on','switch_off','resend') then raise exception 'Invalid action'; end if;
 perform pg_advisory_xact_lock(hashtextextended('client-invite-action/'||p_actor::text||'/'||p_action_id::text,0));
 select * into old from public.client_invite_actions where actor_coach_id=p_actor and action_id=p_action_id;
 -- Lock the original binding on replay; never use a supplied different client to authorize it.
 select * into c from public.clients where id=coalesce(old.client_id,p_client_id) for update;
 if c.id is null or not public.invite_actor_access(p_actor,c.coach_id) then return jsonb_build_object('outcome','not_found'); end if;
 if old.id is not null then
  if old.client_id<>p_client_id or old.kind<>p_kind then return jsonb_build_object('outcome','action_mismatch'); end if;
  return jsonb_build_object('action_id',p_action_id,'replayed',true,'result',old.result,'attempt_id',old.attempt_id);
 end if;
 if p_kind='switch_off' then
  if c.auth_user_id is not null then result:=jsonb_build_object('outcome','already_claimed');
  else update public.clients set invited=false,updated_at=clock_timestamp() where id=c.id; result:=jsonb_build_object('outcome','switched_off'); end if;
 elsif c.auth_user_id is not null or c.archived or nullif(c.email,'') is null then result:=jsonb_build_object('outcome','ineligible');
 elsif p_kind='resend' and not c.invited then result:=jsonb_build_object('outcome','withdrawn');
 else
  if p_kind='switch_on' then update public.clients set invited=true,updated_at=clock_timestamp() where id=c.id; end if;
  select * into a from public.client_invite_attempts where client_id=c.id order by created_at desc,id desc limit 1 for update;
  if a.first_provider_call_at<=clock_timestamp()-interval '23 hours' then
   update public.client_invite_attempts set provider_body=null,retry_disabled=true where id=a.id returning * into a;
  end if;
  if p_supersedes_attempt_id is distinct from a.id then result:=jsonb_build_object('outcome','stale','invite',public.invite_attempt_summary(a));
  elsif a.id is not null and a.recipient_email=c.email and a.status<>'accepted' and a.closed_at is null and not a.retry_disabled and a.provider_body is not null then
   attempt:=a.id; result:=jsonb_build_object('outcome','selected','attempt_id',attempt);
  elsif a.id is not null and a.status<>'accepted' and (a.uncertain or a.admitted_calls>a.completed_calls) and not coalesce(p_confirm_duplicate_risk,false) then
   result:=jsonb_build_object('outcome','needs_confirmation','invite',public.invite_attempt_summary(a));
  elsif p_provider_body is not null and (p_provider_body->'to') is distinct from jsonb_build_array(c.email) then
   -- A profile email edit may have committed after the route rendered. Never bind its old body to the new recipient.
   result:=jsonb_build_object('outcome','stale','invite',public.invite_attempt_summary(a));
  else
   insert into public.client_invite_attempts(client_id,created_by,origin,recipient_email,provider_body,status)
   values(c.id,p_actor,case when p_kind='switch_on' then 'switch' else 'resend' end,c.email,p_provider_body,case when p_provider_body is null then 'unconfigured' else 'pending' end) returning id into attempt;
   result:=jsonb_build_object('outcome','selected','attempt_id',attempt);
  end if;
 end if;
 insert into public.client_invite_actions(client_id,actor_coach_id,action_id,kind,result,attempt_id) values(c.id,p_actor,p_action_id,p_kind,result,attempt);
 return jsonb_build_object('action_id',p_action_id,'replayed',false,'result',result,'attempt_id',attempt);
end $$;

create function public.admit_invite_call(p_actor uuid,p_attempt_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; a public.client_invite_attempts%rowtype; begin
 select c0.* into c from public.clients c0 join public.client_invite_attempts a0 on a0.client_id=c0.id where a0.id=p_attempt_id for update of c0;
 if c.id is null or not public.invite_actor_access(p_actor,c.coach_id) then return jsonb_build_object('admitted',false,'outcome','not_found'); end if;
 select * into a from public.client_invite_attempts where id=p_attempt_id for update;
 if a.first_provider_call_at<=clock_timestamp()-interval '23 hours' then
  update public.client_invite_attempts set retry_disabled=true,provider_body=null where id=a.id returning * into a;
 end if;
 if not c.invited or c.auth_user_id is not null or c.archived or a.recipient_email is distinct from c.email
  or a.status='accepted' or a.closed_at is not null or a.retry_disabled or a.provider_body is null
  or a.retry_after_at>clock_timestamp() or a.lease_expires_at>clock_timestamp() then
  return jsonb_build_object('admitted',false,'invite',public.invite_attempt_summary(a));
 end if;
 update public.client_invite_attempts set
 uncertain=uncertain or (lease_token is not null and lease_expires_at<=clock_timestamp()),
 status=case when uncertain or (lease_token is not null and lease_expires_at<=clock_timestamp()) then 'unknown' else 'pending' end,
 first_provider_call_at=coalesce(first_provider_call_at,clock_timestamp()),lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '30 seconds',
 admitted_calls=admitted_calls+1,updated_at=clock_timestamp() where id=a.id returning * into a;
 return jsonb_build_object('admitted',true,'lease_token',a.lease_token,'provider_body',a.provider_body,'admitted_calls',a.admitted_calls);
end $$;

create function public.complete_invite_call(p_attempt_id uuid,p_lease_token uuid,p_outcome jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.client_invite_attempts%rowtype; k text:=p_outcome->>'kind'; code text:=p_outcome->>'code'; begin
 select * into a from public.client_invite_attempts where id=p_attempt_id for update;
 if a.id is null then return null; end if;
 if a.lease_token is distinct from p_lease_token or a.lease_token is null or a.status='accepted' then return public.invite_attempt_summary(a); end if;
 if code is null or code not in ('timeout','network','unclassified','invalid_idempotency_key','validation_error','missing_api_key','restricted_api_key','invalid_permission','suspended_api_key','invalid_attachment','invalid_parameter','missing_required_field','missing_required_parameter','concurrent_idempotent_requests','invalid_idempotent_request','rate_limit_exceeded','daily_quota_exceeded','monthly_quota_exceeded') then code:='unclassified'; end if;
 if k='accepted' and (p_outcome->>'provider_message_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  a.status:='accepted'; a.uncertain:=false; a.provider_message_id:=p_outcome->>'provider_message_id'; a.closed_at:=clock_timestamp(); a.provider_body:=null;
 elsif k='rejected' and not a.uncertain then a.status:='failed'; a.closed_at:=clock_timestamp(); a.provider_body:=null;
 elsif k='backoff' then a.retry_after_at:=(p_outcome->>'retry_after_at')::timestamptz;
 elsif k='disabled' then a.retry_disabled:=true;
 else a.status:='unknown'; a.uncertain:=true; a.retry_disabled:=a.retry_disabled or k='rejected' or code='invalid_idempotent_request'; end if;
 if a.uncertain then a.status:='unknown'; end if;
 update public.client_invite_attempts set status=a.status,uncertain=a.uncertain,retry_disabled=a.retry_disabled,provider_message_id=a.provider_message_id,
 last_error_code=case when k='accepted' then null else code end,retry_after_at=a.retry_after_at,closed_at=a.closed_at,provider_body=a.provider_body,
 lease_token=null,lease_expires_at=null,completed_calls=completed_calls+1,updated_at=clock_timestamp() where id=a.id;
 select * into a from public.client_invite_attempts where id=a.id;
 return public.invite_attempt_summary(a);
end $$;

-- Functions are backend-only; invoker never elevates caller authority.
revoke execute on function public.reject_invite_identity_mutation(),public.invite_actor_access(uuid,uuid),public.invite_attempt_summary(public.client_invite_attempts),
 public.create_client_with_request(uuid,uuid,text,jsonb,jsonb),public.apply_invite_action(uuid,uuid,uuid,text,uuid,boolean,jsonb),
 public.admit_invite_call(uuid,uuid),public.complete_invite_call(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reject_invite_identity_mutation(),public.invite_actor_access(uuid,uuid),public.invite_attempt_summary(public.client_invite_attempts),
 public.create_client_with_request(uuid,uuid,text,jsonb,jsonb),public.apply_invite_action(uuid,uuid,uuid,text,uuid,boolean,jsonb),
 public.admit_invite_call(uuid,uuid),public.complete_invite_call(uuid,uuid,jsonb) to service_role;
