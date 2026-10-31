-- Ledger essentials: required type/date, optional unknowns stay NULL, partial
-- totals, strict calendar dates, Denver future policy and DST week bounds.
set role service_role;

-- Type + date only: unknown duration/effort/label/note stay null (never 0).
select pg_temp.check(r->>'replayed'='false' and (r->>'committed_revision')::int=1
  and r->'resource'->'duration_seconds'='null'::jsonb and r->'resource'->'effort_rpe'='null'::jsonb
  and r->'resource'->'label'='null'::jsonb and r->'resource'->'note'='null'::jsonb
  and r->'resource'->>'occurred_on'='2026-03-04' and r->'resource'->>'created_by_role'='client'
  and r->'resource'->'created_by_name'='null'::jsonb, 'minimal create keeps unknowns null: '||r::text)
from (select pg_temp.act(111,11,null,pg_temp.create_req(201,'{"activity_type":"hike","occurred_on":"2026-03-04"}')) r) s;

select pg_temp.check(r->'resource'->>'label'='Club soccer' and r->'resource'->>'note'='Full second half'
  and (r->'resource'->>'duration_seconds')::int=3600 and (r->'resource'->>'effort_rpe')::int=8, 'text trimmed, values kept')
from (select pg_temp.act(111,11,null,pg_temp.create_req(202,
  '{"activity_type":"game","occurred_on":"2026-03-02","label":"  Club soccer ","duration_seconds":3600,"effort_rpe":8,"note":" Full second half "}')) r) s;

-- Coach on behalf: visibly attributed; blank text normalizes to null.
select pg_temp.check(r->'resource'->>'created_by_role'='coach' and r->'resource'->>'created_by_name'='Week Coach'
  and r->'resource'->'label'='null'::jsonb and r->'resource'->'note'='null'::jsonb, 'coach on-behalf attribution')
from (select pg_temp.act(101,11,null,pg_temp.create_req(203,
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":1800,"label":"","note":"   "}')) r) s;

-- Monday 2026-03-09 belongs to the next week.
select pg_temp.act(111,11,null,pg_temp.create_req(204,'{"activity_type":"other","occurred_on":"2026-03-09","duration_seconds":600}'));

-- Spring-forward week (Sun 2026-03-08 is the DST change): Mon..Sun inclusive.
select pg_temp.check(w->'summary'='{"activity_count":3,"known_duration_seconds":5400,"known_duration_count":2,"unknown_duration_count":1,"unknown_effort_count":2}'::jsonb,
  'partial totals: known subtotal + missing-duration count: '||(w->'summary')::text)
from (select pg_temp.week(111,11,'2026-03-02') w) s;
select pg_temp.check(jsonb_array_length(w->'activities')=3 and w->'activities'->0->>'occurred_on'='2026-03-02'
  and w->'activities'->2->>'occurred_on'='2026-03-08' and w->>'week_start'='2026-03-02' and w->>'week_end'='2026-03-08'
  and w->>'viewer_role'='client' and w->>'coach_name'='Week Coach' and w->>'truncated'='false', 'week bounds/order/metadata')
from (select pg_temp.week(111,11,'2026-03-02') w) s;

-- Fall-back week (Sun 2025-11-02): the stored day string is returned unchanged.
select pg_temp.act(111,11,null,pg_temp.create_req(205,'{"activity_type":"sport_practice","occurred_on":"2025-11-02","effort_rpe":6}'));
select pg_temp.check(jsonb_array_length(w->'activities')=1 and w->'activities'->0->>'occurred_on'='2025-11-02'
  and (w->'summary'->>'unknown_duration_count')::int=1 and (w->'summary'->>'known_duration_seconds')::int=0, 'fall-back week')
from (select pg_temp.week(111,11,'2025-10-27') w) s;

-- An empty week is an explicit empty result (the UI says "nothing logged", not rest).
select pg_temp.check(w->'activities'='[]'::jsonb and (w->'summary'->>'activity_count')::int=0, 'empty week')
from (select pg_temp.week(111,11,'2026-02-23') w) s;

-- Leap day is a real date; boundary values are accepted.
select pg_temp.act(111,11,null,pg_temp.create_req(206,'{"activity_type":"run","occurred_on":"2024-02-29","duration_seconds":86400,"effort_rpe":10}'));
select pg_temp.act(111,11,null,pg_temp.create_req(207,'{"activity_type":"run","occurred_on":"2024-03-01","duration_seconds":1,"effort_rpe":1}'));
-- Denver "today" is accepted; Denver tomorrow is refused.
select pg_temp.act(111,11,null,jsonb_build_object('action','create','request_id',pg_temp.id(208),'revision',0,'fields',
  jsonb_build_object('activity_type','run','occurred_on',to_char((clock_timestamp() at time zone 'America/Denver')::date,'YYYY-MM-DD'))));
select pg_temp.expect_error($$select pg_temp.act(111,11,null,jsonb_build_object('action','create','request_id',pg_temp.id(209),'revision',0,'fields',
  jsonb_build_object('activity_type','run','occurred_on',to_char((clock_timestamp() at time zone 'America/Denver')::date+1,'YYYY-MM-DD'))))$$,'P0400');

-- Strict validation: nothing invalid commits.
select pg_temp.expect_error(format($$select pg_temp.act(111,11,null,pg_temp.create_req(210,%L::jsonb))$$, f),'P0400')
from unnest(array[
  '{"activity_type":"run","occurred_on":"2026-02-30"}',
  '{"activity_type":"run","occurred_on":"2026-02-29"}',
  '{"activity_type":"run","occurred_on":"2026-3-08"}',
  '{"activity_type":"run","occurred_on":"2026-03-08T00:00:00Z"}',
  '{"activity_type":"run","occurred_on":20260308}',
  '{"activity_type":"nap","occurred_on":"2026-03-08"}',
  '{"occurred_on":"2026-03-08"}',
  '{"activity_type":"run"}',
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":0}',
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":86401}',
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":90.5}',
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":"3600"}',
  '{"activity_type":"run","occurred_on":"2026-03-08","duration_seconds":-60}',
  '{"activity_type":"run","occurred_on":"2026-03-08","effort_rpe":0}',
  '{"activity_type":"run","occurred_on":"2026-03-08","effort_rpe":11}',
  '{"activity_type":"run","occurred_on":"2026-03-08","effort_rpe":7.5}',
  '{"activity_type":"run","occurred_on":"2026-03-08","label":42}',
  '{"activity_type":"run","occurred_on":"2026-03-08","calories":300}',
  '{"activity_type":"run","occurred_on":"2026-03-08","created_by_role":"coach"}'
]) f;
select pg_temp.expect_error(format($$select pg_temp.act(111,11,null,pg_temp.create_req(211,%L::jsonb))$$,
  jsonb_build_object('activity_type','run','occurred_on','2026-03-08','label',repeat('x',81))),'P0400');
select pg_temp.expect_error(format($$select pg_temp.act(111,11,null,pg_temp.create_req(212,%L::jsonb))$$,
  jsonb_build_object('activity_type','run','occurred_on','2026-03-08','note',repeat('n',1001))),'P0400');
select pg_temp.act(111,11,null,pg_temp.create_req(213,jsonb_build_object('activity_type','run','occurred_on','2026-03-07','label',repeat('x',80),'note',repeat('n',1000))));
-- Request envelope: revision 0 for create, real request id, no extra keys, no activity id on create.
select pg_temp.expect_error($$select pg_temp.act(111,11,null,jsonb_build_object('action','create','request_id',pg_temp.id(214),'revision',1,'fields','{"activity_type":"run","occurred_on":"2026-03-08"}'::jsonb))$$,'P0400');
select pg_temp.expect_error($$select pg_temp.act(111,11,null,jsonb_build_object('action','create','request_id','not-a-uuid','revision',0,'fields','{"activity_type":"run","occurred_on":"2026-03-08"}'::jsonb))$$,'P0400');
select pg_temp.expect_error($$select pg_temp.act(111,11,null,pg_temp.create_req(215,'{"activity_type":"run","occurred_on":"2026-03-08"}')||'{"client_id":"00000000-0000-4000-8000-000000000012"}')$$,'P0400');
select pg_temp.expect_error($$select pg_temp.act(111,11,pg_temp.id(999),pg_temp.create_req(216,'{"activity_type":"run","occurred_on":"2026-03-08"}'))$$,'P0400');
select pg_temp.expect_error($$select pg_temp.act(111,11,null,'{"action":"delete","request_id":"00000000-0000-4000-8000-000000000217","revision":0}')$$,'P0400');
select pg_temp.check((select count(*) from public.outside_activity_receipts where request_id between pg_temp.id(209) and pg_temp.id(212))=0, 'refused requests left no receipts');
select pg_temp.check((select count(*) from public.outside_activities where client_id=pg_temp.id(11))=9, 'exactly the accepted rows exist');

-- Weeks must start on Monday; reads never insert preference rows.
select pg_temp.expect_error($$select pg_temp.week(111,11,'2026-03-03')$$,'P0400');
select pg_temp.check(w->'preferences'->>'activity_collection'='default_off' and (w->'preferences'->>'revision')::int=0, 'unclaimed client default off')
from (select pg_temp.week(101,13,'2026-03-02') w) s;
select pg_temp.check(not exists(select 1 from public.client_context_preferences where client_id=pg_temp.id(13)), 'read did not insert a preference row');
reset role;
