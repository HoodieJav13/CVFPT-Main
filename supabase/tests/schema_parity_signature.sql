-- Read-only parity signature for application columns and constraints.
-- Run after all versioned migrations locally and against the hosted development project.
with app_tables as (
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
), columns_inventory as (
  select
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    coalesce(c.column_default, '') as column_default
  from information_schema.columns c
  join app_tables t using (table_name)
  where c.table_schema = 'public'
), constraints_inventory as (
  select
    cl.relname as table_name,
    con.conname,
    con.contype,
    regexp_replace(
      pg_get_constraintdef(con.oid, true),
      '[[:space:]]+',
      ' ',
      'g'
    ) as definition
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public'
    and cl.relkind = 'r'
)
select
  (select count(*) from columns_inventory) as column_count,
  (
    select md5(string_agg(
      concat_ws(
        '|', table_name, ordinal_position, column_name, data_type,
        udt_name, is_nullable, column_default
      ),
      E'\n' order by table_name, ordinal_position
    ))
    from columns_inventory
  ) as column_signature,
  (select count(*) from constraints_inventory) as constraint_count,
  (
    select md5(string_agg(
      concat_ws('|', table_name, conname, contype, definition),
      E'\n' order by table_name, conname
    ))
    from constraints_inventory
  ) as constraint_signature;
