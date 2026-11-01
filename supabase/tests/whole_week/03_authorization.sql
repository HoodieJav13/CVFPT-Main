-- Current actor + ownership are re-resolved inside every call, before replay
-- and before mutation. Auth user != client. Refusals are masked 404s that
-- reveal no row or receipt.
set role service_role;
select pg_temp.act(111,11,null,pg_temp.create_req(401,'{"activity_type":"run","occurred_on":"2026-03-03","duration_seconds":1200}'));

-- Unrelated coach, other client, unlinked user: no read, write or replay.
select pg_temp.expect_error($$select pg_temp.week(102,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(102,11,null,pg_temp.create_req(402,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(102,null,pg_temp.aid(401),pg_temp.archive_req(403,1))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.week(112,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(112,null,pg_temp.aid(401),pg_temp.archive_req(404,1))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.week(199,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.week(111,12,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(111,12,null,pg_temp.create_req(405,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0404');
-- A forged client id beside a real activity id never redirects the write.
select pg_temp.expect_error($$select public.mutate_outside_activity(pg_temp.id(111),pg_temp.id(12),pg_temp.aid(401),pg_temp.archive_req(406,1))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(111,null,pg_temp.id(999),pg_temp.archive_req(407,1))$$,'P0404');
-- Auth user != client: a client id used as an auth id, or a null auth id, matches nobody.
select pg_temp.expect_error($$select public.read_whole_week(pg_temp.id(11),pg_temp.id(11),'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select public.read_whole_week(null,pg_temp.id(13),'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select public.mutate_outside_activity(null,pg_temp.id(13),null,pg_temp.create_req(408,'{"activity_type":"run","occurred_on":"2026-03-03"}'))$$,'P0404');
select pg_temp.check(not exists(select 1 from public.outside_activity_receipts where request_id in (pg_temp.id(402),pg_temp.id(403),pg_temp.id(404),pg_temp.id(405),pg_temp.id(406),pg_temp.id(407),pg_temp.id(408))), 'refusals wrote nothing');

-- Admin may read and record on behalf, visibly attributed.
select pg_temp.check(pg_temp.week(103,11,'2026-03-02')->>'viewer_role'='admin', 'admin reads');
select pg_temp.check(r->'resource'->>'created_by_role'='admin' and r->'resource'->>'created_by_name'='Admin Coach', 'admin on-behalf attribution')
from (select pg_temp.act(103,11,null,pg_temp.create_req(409,'{"activity_type":"extra_training","occurred_on":"2026-03-05"}')) r) s;

-- Ownership changes after coach A committed request 410 (response "lost").
select pg_temp.act(101,11,null,pg_temp.create_req(410,'{"activity_type":"game","occurred_on":"2026-03-04"}'));
reset role;
update public.clients set coach_id=pg_temp.id(2) where id=pg_temp.id(11);
set role service_role;
-- The former coach's replay is refused before the receipt is consulted: no disclosure.
select pg_temp.expect_error($$select pg_temp.act(101,11,null,pg_temp.create_req(410,'{"activity_type":"game","occurred_on":"2026-03-04"}'))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(101,11,null,pg_temp.create_req(411,'{"activity_type":"game","occurred_on":"2026-03-04"}'))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(101,null,pg_temp.aid(410),pg_temp.archive_req(412,1))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.week(101,11,'2026-03-02')$$,'P0404');
-- The current coach sees all shared history with original attribution.
select pg_temp.check(jsonb_array_length(w->'activities')=3 and w->>'viewer_role'='coach' and w->>'coach_name'='Other Coach'
  and w->'activities' @> jsonb_build_array(jsonb_build_object('created_by_name','Week Coach')), 'new coach reads shared history')
from (select pg_temp.week(102,11,'2026-03-02') w) s;
select pg_temp.act(102,null,pg_temp.aid(410),pg_temp.update_req(413,1,'{"activity_type":"game","occurred_on":"2026-03-04","duration_seconds":5400}'));
-- The client keeps access throughout.
select pg_temp.check(jsonb_array_length(pg_temp.week(111,11,'2026-03-02')->'activities')=3, 'client unaffected by reassignment');

-- Active role change: a demoted admin loses non-owned access, including its own replay.
reset role;
update public.coaches set is_admin=false where id=pg_temp.id(3);
set role service_role;
select pg_temp.expect_error($$select pg_temp.act(103,11,null,pg_temp.create_req(409,'{"activity_type":"extra_training","occurred_on":"2026-03-05"}'))$$,'P0404');
select pg_temp.expect_error($$select pg_temp.week(103,11,'2026-03-02')$$,'P0404');
-- An archived coach account loses access.
reset role;
update public.coaches set archived=true where id=pg_temp.id(2);
set role service_role;
select pg_temp.expect_error($$select pg_temp.week(102,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(102,null,pg_temp.aid(410),pg_temp.archive_req(414,2))$$,'P0404');
-- Removing the client's auth link removes client access (and its replays).
reset role;
update public.clients set auth_user_id=null where id=pg_temp.id(11);
set role service_role;
select pg_temp.expect_error($$select pg_temp.week(111,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(111,11,null,pg_temp.create_req(401,'{"activity_type":"run","occurred_on":"2026-03-03","duration_seconds":1200}'))$$,'P0404');
-- An archived client is unreachable even for a restored admin.
reset role;
update public.coaches set is_admin=true where id=pg_temp.id(3);
update public.clients set archived=true where id=pg_temp.id(11);
set role service_role;
select pg_temp.expect_error($$select pg_temp.week(103,11,'2026-03-02')$$,'P0404');
select pg_temp.expect_error($$select pg_temp.act(103,null,pg_temp.aid(401),pg_temp.archive_req(415,1))$$,'P0404');
-- None of the refused calls left a receipt.
select pg_temp.check((select count(*) from public.outside_activity_receipts where request_id in (pg_temp.id(411),pg_temp.id(412),pg_temp.id(414),pg_temp.id(415)))=0, 'refused writes left no receipts');
reset role;
