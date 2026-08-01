# Closed-loop operations upgrade

Status: implemented on `codex/closed-loop-operations`; production activation is intentionally held for owner review.

## What changed

1. **Coach Today queue** — the coach dashboard combines past-due open sessions, pending bookings, unread client messages, check-ins needing review, and the approved analytics attention signals. Every row has a direct resolution action. If analytics coverage fails, the queue says so and still shows the independently verified work.
2. **Client Today plan** — the client home chooses one honest next action: resume an active workout, start a due assignment, continue the next program day, open coach feedback, check in, read a message, or show that training data is unavailable. Programs is split into URL-stable Current, Other, and History sections.
3. **Email notification implementation** — instant booking/session events and the daily operational digest are implemented behind owner-controlled configuration. Provider errors cannot break the scheduling action. Digest reads are fully paged, contain counts rather than message content, and use deterministic idempotency keys.
4. **First-party operations telemetry** — privacy-filtered events record the major training, booking, message, check-in, PWA, and frontend-error moments. The server derives actor identity, enforces fixed event/property vocabularies, reduces routes to non-identifying templates, rate-limits writes, and returns a request ID on every API response. Sanitized 5xx logs contain only request ID, method, route template, status, and duration.
5. **Mobile/accessibility hardening** — shared page actions stack safely on narrow screens; the Sessions action row stays in view; Client Detail tabs announce their overflow; and touched primary controls measure at least 44px at 390px.

## Owner stops before merge

### Database apply

Review and apply both migrations from this branch in one push:

- `20260801091539_email_digest_preferences.sql`
- `20260801091657_product_telemetry.sql`

Run `supabase db push` only after reviewing the PR. Both migrations were replayed with the complete migration history on a disposable local database. Neither has been applied to the hosted project by this branch.

### Email activation

Email remains inert until every required value is configured. After the database apply:

1. Create/confirm the Resend account and verify `corevaluefitness.com`.
2. Add `RESEND_API_KEY`, `CRON_SECRET`, and `NOTIFY_REPLY_TO` to the **backend production project**. Keep the existing `FRONTEND_URL` value.
3. Use a random `CRON_SECRET` of at least 16 characters. Vercel sends it as the bearer token for the digest route.
4. Deploy the backend, then create one test booking request, approve it, and cancel its resulting test session. Confirm the expected coach/client emails and links.

The digest runs at 13:00 UTC, matching the approved 6 AM MST / 7 AM MDT compromise. Transactional emails remain on; users may opt out only from the daily digest.

## Operational checks

The telemetry table deliberately stores no message bodies, notes, email addresses, health data, or arbitrary properties. Useful aggregate checks are:

```sql
select event_name, count(*)
from public.product_events
where archived = false
  and occurred_at >= now() - interval '30 days'
group by event_name
order by count(*) desc;
```

```sql
select properties->>'route' as route, count(*) as frontend_errors
from public.product_events
where archived = false
  and event_name = 'frontend_error'
  and occurred_at >= now() - interval '7 days'
group by properties->>'route'
order by frontend_errors desc;
```

For an API 5xx, copy the response `x-request-id` and search the backend runtime logs for the same request ID. Logs intentionally omit raw URLs, request values, message content, and stack traces from client-visible output.

## Verification evidence

- Complete 27-migration replay plus direct RLS, grant, constraint, and rollback probes on a disposable local Postgres database.
- Backend suite: 215 passing.
- Preview browser suite: 19 passing, 8 hosted-auth cases correctly skipped without hosted credentials.
- Production frontend build: passing.
- Changed-file React review: no findings.
- Dependency audit: zero production vulnerabilities in frontend and backend.
- Real-browser review at 390px and 1440px: no horizontal overflow; touched primary controls measured at 44px.
