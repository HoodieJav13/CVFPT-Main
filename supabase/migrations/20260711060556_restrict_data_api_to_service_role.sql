-- The application uses Supabase's Data API only from the isolated Express
-- backend. New-project defaults vary, so make the intended boundary explicit:
-- anon/authenticated cannot reach application tables, while service_role can
-- perform the non-destructive operations used by routes and RPCs.
revoke all privileges on all tables in schema public
  from public, anon, authenticated, service_role;
grant select, insert, update on all tables in schema public to service_role;

revoke all privileges on all sequences in schema public
  from public, anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

-- Apply the same least-privilege boundary to future objects created by the
-- migration owner. DELETE remains intentionally ungranted: business records
-- are archived rather than hard-deleted.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update on tables to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
