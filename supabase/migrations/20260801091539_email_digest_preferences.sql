-- Daily email digest preference. Transactional booking/session emails stay
-- always-on; only the non-urgent daily digest can be disabled.
alter table public.clients
  add column if not exists digest_opt_out boolean not null default false;

alter table public.coaches
  add column if not exists digest_opt_out boolean not null default false;

comment on column public.clients.digest_opt_out is
  'When true, skip the daily operational email digest. Instant transactional email remains enabled.';
comment on column public.coaches.digest_opt_out is
  'When true, skip the daily operational email digest. Instant transactional email remains enabled.';

select 'email digest preferences ready' as result;
