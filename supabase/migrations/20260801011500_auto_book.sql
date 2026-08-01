-- ============================================================
-- Auto-book (roadmap v3 Track 1 item 2, decision D3).
--
-- Per-coach opt-in: when enabled, a client picking an offered open
-- slot books instantly through the existing transactional approve
-- path (approve_booking) instead of waiting on manual approval. Each
-- coach flips their own flag behind a confirmation dialog; default off
-- preserves today's request -> approve flow exactly. Inert until a
-- coach opts in. The coaches table already carries RLS and the
-- service-role grant set from the baseline hardening.
-- ============================================================

alter table public.coaches
  add column if not exists auto_book boolean not null default false;

comment on column public.coaches.auto_book is
  'D3: coach-controlled opt-in. True = offered open slots book instantly via the transactional approve path. Default off.';

-- ---------- Atomic request-plus-optional-approval ----------
-- Creating the request and auto-approving it happen in ONE transaction:
-- if the approval step raises, the insert rolls back with it, so a
-- client retry can never create duplicates and never sees "failed" with
-- a hidden pending row left behind. Only an explicit 'approved' outcome
-- from approve_booking reports auto_booked; a conflict (race) or any
-- unexpected outcome leaves the request pending for the coach.
create or replace function public.request_booking(
  p_client_id uuid,
  p_coach_id uuid,
  p_requested_time timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_note text,
  p_auto_book boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.booking_requests%rowtype;
  v_approval jsonb;
begin
  insert into public.booking_requests (client_id, coach_id, requested_time, duration_minutes, location, note)
  values (p_client_id, p_coach_id, p_requested_time, p_duration_minutes, p_location, p_note)
  returning * into v_request;

  if not coalesce(p_auto_book, false) then
    return jsonb_build_object('outcome', 'pending', 'request', to_jsonb(v_request));
  end if;

  v_approval := public.approve_booking(v_request.id);

  if v_approval is not null and v_approval->>'outcome' = 'approved' then
    return jsonb_build_object(
      'outcome', 'auto_booked',
      'request', v_approval->'booking',
      'session', v_approval->'session'
    );
  end if;

  return jsonb_build_object('outcome', 'pending', 'request', to_jsonb(v_request));
end;
$$;

revoke execute on function public.request_booking(uuid, uuid, timestamptz, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.request_booking(uuid, uuid, timestamptz, integer, text, text, boolean) to service_role;

select 'auto book ready' as result;
