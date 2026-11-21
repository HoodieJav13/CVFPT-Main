-- Request receipts, replay-once, changed-body conflict, stale revision edits,
-- older replay vs newer row, soft archive, rollback and immutability.
set role service_role;

-- 301 creates activity A once; the identical request replays without a second row.
select pg_temp.act(111,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3600}'));
select pg_temp.check(r->>'replayed'='true' and (r->>'committed_revision')::int=1 and r->'resource'->>'id'=pg_temp.aid(301)::text, 'identical replay returns the receipt')
from (select pg_temp.act(111,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3600}')) r) s;
-- Omitted and explicit-null optional fields normalize to the same request.
select pg_temp.check(r->>'replayed'='true', 'explicit nulls replay the same request')
from (select pg_temp.act(111,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3600,"label":null,"effort_rpe":null,"note":"  "}')) r) s;
select pg_temp.check((select count(*) from public.outside_activities where client_id=pg_temp.id(11))=1, 'replay committed once');
select pg_temp.check((select count(*) from public.outside_activity_receipts where request_id=pg_temp.id(301))=1, 'one receipt');

-- Same request id, changed body / action / resource => conflict, no write.
select pg_temp.expect_error($$select pg_temp.act(111,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3601}'))$$,'P0409','request_mismatch');
select pg_temp.expect_error($$select pg_temp.act(111,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-04","duration_seconds":3600}'))$$,'P0409','request_mismatch');
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),jsonb_build_object('action','archive','request_id',pg_temp.id(301),'revision',1))$$,'P0409','request_mismatch');
select pg_temp.check((pg_temp.row_of(pg_temp.aid(301))).revision=1 and not (pg_temp.row_of(pg_temp.aid(301))).archived, 'mismatch changed nothing');

-- A deliberate repeat with a NEW request id is a legitimate second activity.
select pg_temp.act(111,11,null,pg_temp.create_req(302,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3600}'));
select pg_temp.check(pg_temp.aid(302)<>pg_temp.aid(301) and (select count(*) from public.outside_activities where client_id=pg_temp.id(11))=2, 'new id => second row');
-- Receipts are keyed per actor: another actor's identical id is its own request.
select pg_temp.act(101,11,null,pg_temp.create_req(301,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":3600}'));
select pg_temp.check((select count(*) from public.outside_activity_receipts where request_id=pg_temp.id(301))=2, 'actor-scoped receipts');

-- Two devices read revision 1; the first correction wins, the stale one fails without overwrite.
select pg_temp.check((r->>'committed_revision')::int=2 and (r->'resource'->>'revision')::int=2 and r->'resource'->>'updated_by_role'='client'
  and (r->'resource'->>'duration_seconds')::int=2700, 'correction 1 -> 2')
from (select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(303,1,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":2700}')) r) s;
select pg_temp.expect_error($$select pg_temp.act(101,null,pg_temp.aid(301),pg_temp.update_req(305,1,'{"activity_type":"run","occurred_on":"2026-03-03","duration_seconds":600}'))$$,'P0409','revision_conflict');
select pg_temp.check((pg_temp.row_of(pg_temp.aid(301))).duration_seconds=2700 and (pg_temp.row_of(pg_temp.aid(301))).activity_type='game', 'stale edit did not overwrite');
select pg_temp.check(not exists(select 1 from public.outside_activity_receipts where request_id=pg_temp.id(305)), 'stale edit left no receipt');

-- Coach corrects 2 -> 3; the author metadata stays the client's.
select pg_temp.act(101,null,pg_temp.aid(301),pg_temp.update_req(304,2,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":2700,"effort_rpe":7,"note":"Coach added effort after talking"}'));
select pg_temp.check((pg_temp.row_of(pg_temp.aid(301))).revision=3 and (pg_temp.row_of(pg_temp.aid(301))).created_by_role='client'
  and (pg_temp.row_of(pg_temp.aid(301))).updated_by_role='coach', 'immutable creator, attributed corrector');

-- An older replay reports its own committed revision next to the newer row.
select pg_temp.check(r->>'replayed'='true' and (r->>'committed_revision')::int=2 and (r->'resource'->>'revision')::int=3
  and (r->'resource'->>'effort_rpe')::int=7, 'older receipt never masquerades as the latest row')
from (select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(303,1,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":2700}')) r) s;
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(303,1,'{"activity_type":"game","occurred_on":"2026-03-03","duration_seconds":2701}'))$$,'P0409','request_mismatch');

-- Empty corrections are rejected; partial field semantics are tested in06.
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),jsonb_build_object('action','update','request_id',pg_temp.id(306),'revision',3,
  'fields','{}'::jsonb))$$,'P0400');
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(306,0,'{"activity_type":"game","occurred_on":"2026-03-03"}'))$$,'P0400');

-- A direct/legacy writer still advances the revision, so a later guarded stale write fails.
reset role;
update public.outside_activities set duration_seconds=2400, updated_by_role='admin', updated_by_id=pg_temp.id(3) where id=pg_temp.aid(301);
set role service_role;
select pg_temp.check((pg_temp.row_of(pg_temp.aid(301))).revision=4, 'single incrementer owns revisions');
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(307,3,'{"activity_type":"game","occurred_on":"2026-03-03"}'))$$,'P0409','revision_conflict');

-- A failed receipt insert rolls the correction back too.
reset role;
create function public.ww_test_fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end $$;
create trigger ww_test_fail_receipt before insert on public.outside_activity_receipts for each row execute function public.ww_test_fail_receipt();
set role service_role;
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(308,4,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0001');
select pg_temp.check((pg_temp.row_of(pg_temp.aid(301))).revision=4 and (pg_temp.row_of(pg_temp.aid(301))).activity_type='game', 'no correction without its receipt');
reset role;
drop trigger ww_test_fail_receipt on public.outside_activity_receipts;
drop function public.ww_test_fail_receipt();
set role service_role;

-- Soft archive; its replay confirms the archived tombstone; later writes are refused.
select pg_temp.check((r->>'committed_revision')::int=5 and r->'resource'->>'archived'='true', 'archive 4 -> 5')
from (select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.archive_req(309,4)) r) s;
select pg_temp.check(r->>'replayed'='true' and r->'resource'->>'archived'='true' and r->>'action'='archive', 'lost archive response replays')
from (select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.archive_req(309,4)) r) s;
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.aid(301),pg_temp.update_req(310,5,'{"activity_type":"game","occurred_on":"2026-03-03"}'))$$,'P0409','archived');
select pg_temp.expect_error($$select pg_temp.act(101,null,pg_temp.aid(301),pg_temp.archive_req(311,5))$$,'P0409','archived');
-- Remaining: B (request 302) and the coach's own activity from its request 301.
select pg_temp.check(jsonb_array_length(w->'activities')=2 and (w->'summary'->>'activity_count')::int=2
  and not (w->'activities' @> jsonb_build_array(jsonb_build_object('id',pg_temp.aid(301)))), 'archived rows leave the week and its totals')
from (select pg_temp.week(111,11,'2026-03-02') w) s;
select pg_temp.check(exists(select 1 from public.outside_activities where id=pg_temp.aid(301) and archived and archived_at is not null), 'record kept, not deleted');

-- Receipts hold only the normalized hash and committed identity/revision.
select pg_temp.check((select bool_and(request_hash ~ '^[0-9a-f]{64}$') from public.outside_activity_receipts), 'sha256 hex hashes');
select pg_temp.check((select array_agg(committed_revision order by created_at) from public.outside_activity_receipts where actor_auth_user_id=pg_temp.id(111) and activity_id=pg_temp.aid(301))=array[1,2,5], 'committed revisions per receipt');
reset role;
