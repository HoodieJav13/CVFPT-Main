insert into public.coaches(id,name,email) values
 ('10000000-0000-4000-8000-0000000000a1','Invite Coach','invite-coach@example.invalid'),
 ('10000000-0000-4000-8000-0000000000a2','Other Coach','other-coach@example.invalid');
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'assertion failed: %',label; end if; end $$;
