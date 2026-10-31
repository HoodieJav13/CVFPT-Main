-- Role-separated context preferences. Missing row = collection off. Coach
-- enable AND NOT client opt-out permits new entries, for both roles. Opt-out
-- keeps earlier shared records visible and correctable. No check-in data is
-- read or written here (manual check-ins are never gated by these bits).
set role service_role;

-- Client 12 has no row: default off; the read inserts nothing.
select pg_temp.check(w->'preferences'->>'activity_collection'='default_off' and w->'preferences'->>'checkin_prompt'='hidden'
  and (w->'preferences'->>'revision')::int=0 and w->'preferences'->>'stored'='false', 'default off')
from (select pg_temp.week(112,12,'2026-03-02') w) s;
select pg_temp.check(not exists(select 1 from public.client_context_preferences where client_id=pg_temp.id(12)), 'GET does not insert');
select pg_temp.expect_error($$select pg_temp.act(112,12,null,pg_temp.create_req(501,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0409','collection_off');
select pg_temp.expect_error($$select pg_temp.act(102,12,null,pg_temp.create_req(502,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0409','collection_off');

-- Each role changes only its own bits.
select pg_temp.expect_error($$select pg_temp.prefs(112,12,'{"revision":0,"activity_coach_enabled":true}')$$,'P0403');
select pg_temp.expect_error($$select pg_temp.prefs(102,12,'{"revision":0,"activity_client_off":false}')$$,'P0403');
select pg_temp.expect_error($$select pg_temp.prefs(103,12,'{"revision":0,"checkin_prompt_client_off":true}')$$,'P0403');
select pg_temp.expect_error($$select pg_temp.prefs(101,12,'{"revision":0,"activity_coach_enabled":true}')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.prefs(112,12,'{"revision":0,"activity_client_off":"yes"}')$$,'P0400');
select pg_temp.expect_error($$select pg_temp.prefs(112,12,'{"revision":0}')$$,'P0400');
select pg_temp.expect_error($$select pg_temp.prefs(112,12,'{"revision":0,"activity_client_off":true,"note":"x"}')$$,'P0400');
select pg_temp.check(not exists(select 1 from public.client_context_preferences where client_id=pg_temp.id(12)), 'refusals inserted nothing');

-- A client may opt out before the coach ever enables collection.
select pg_temp.check(r->'preferences'->>'activity_collection'='client_opted_out' and (r->'preferences'->>'revision')::int=1, 'early opt-out')
from (select pg_temp.prefs(112,12,'{"revision":0,"activity_client_off":true}') r) s;
select pg_temp.expect_error($$select pg_temp.prefs(102,12,'{"revision":0,"activity_coach_enabled":true}')$$,'P0409','revision_conflict');
-- Coach enables; the client's opt-out still wins, for coach-on-behalf too.
select pg_temp.check(r->'preferences'->>'activity_collection'='client_opted_out' and r->'preferences'->>'activity_coach_enabled'='true', 'opt-out wins over enable')
from (select pg_temp.prefs(102,12,'{"revision":1,"activity_coach_enabled":true}') r) s;
select pg_temp.expect_error($$select pg_temp.act(102,12,null,pg_temp.create_req(503,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0409','collection_off');
select pg_temp.expect_error($$select pg_temp.act(103,12,null,pg_temp.create_req(504,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0409','collection_off');

-- Client reverses its own choice: collection is on for both roles.
select pg_temp.check(r->'preferences'->>'activity_collection'='on' and (r->'preferences'->>'revision')::int=3 and r->'preferences'->>'updated_by_role'='client', 'client re-allows')
from (select pg_temp.prefs(112,12,'{"revision":2,"activity_client_off":false}') r) s;
select pg_temp.act(112,12,null,pg_temp.create_req(505,'{"activity_type":"game","occurred_on":"2026-03-04","duration_seconds":3600}'));
select pg_temp.act(102,12,null,pg_temp.create_req(506,'{"activity_type":"run","occurred_on":"2026-03-05"}'));

-- Opt out again: no new entries for anyone; earlier shared ones stay visible and correctable.
select pg_temp.prefs(112,12,'{"revision":3,"activity_client_off":true}');
select pg_temp.expect_error($$select pg_temp.act(112,12,null,pg_temp.create_req(507,'{"activity_type":"run","occurred_on":"2026-03-06"}'))$$,'P0409','collection_off');
select pg_temp.expect_error($$select pg_temp.act(102,12,null,pg_temp.create_req(508,'{"activity_type":"run","occurred_on":"2026-03-06"}'))$$,'P0409','collection_off');
select pg_temp.check(jsonb_array_length(w->'activities')=2 and w->'preferences'->>'activity_collection'='client_opted_out', 'history stays visible to the coach')
from (select pg_temp.week(102,12,'2026-03-02') w) s;
select pg_temp.act(102,null,pg_temp.aid(506),pg_temp.update_req(509,1,'{"activity_type":"run","occurred_on":"2026-03-05","duration_seconds":1500}'));
select pg_temp.act(112,null,pg_temp.aid(505),pg_temp.archive_req(510,1));
-- Replays of requests committed before the opt-out still confirm (no new write).
select pg_temp.check(r->>'replayed'='true', 'pre-opt-out receipt still replays')
from (select pg_temp.act(112,12,null,pg_temp.create_req(505,'{"activity_type":"game","occurred_on":"2026-03-04","duration_seconds":3600}')) r) s;

-- Check-in reminder bits are separate from collection and role-separated too.
select pg_temp.check(r->'preferences'->>'checkin_prompt'='on' and r->'preferences'->>'activity_collection'='client_opted_out', 'prompt on')
from (select pg_temp.prefs(102,12,'{"revision":4,"checkin_prompt_coach_enabled":true}') r) s;
select pg_temp.check(r->'preferences'->>'checkin_prompt'='hidden', 'client hides prompt')
from (select pg_temp.prefs(112,12,'{"revision":5,"checkin_prompt_client_off":true}') r) s;
select pg_temp.check((select revision from public.client_context_preferences where client_id=pg_temp.id(12))=6, 'every change is revisioned');
reset role;
