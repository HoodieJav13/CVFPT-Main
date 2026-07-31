-- ============================================================
-- Relocate btree_gist out of public (Supabase security lint,
-- extension_in_public). The conflict-protection migration installed it
-- with the repo's plain `create extension` convention, which lands in
-- public on hosted Supabase.
--
-- Safe for the live exclusion constraints: operator-class bindings in
-- existing indexes are by OID, not by name/search_path — verified on a
-- scratch replay (constraint still rejects overlaps, schedule_session
-- unaffected after relocation). Future fresh replays create the
-- extension in public and immediately relocate it here.
-- ============================================================

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

alter extension btree_gist set schema extensions;

select 'btree_gist relocated to extensions schema' as result;
