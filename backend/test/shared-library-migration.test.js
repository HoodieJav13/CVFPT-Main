const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260929120000_shared_training_library.sql'),
  'utf8',
);

const functions = [
  ['set_template_created_by', ''],
  ['clone_workout', 'uuid, uuid, uuid, boolean, uuid'],
  ['resolve_variation_root', 'text, uuid'],
  ['assign_workout_clone', 'uuid, uuid, text, date, text, jsonb'],
  ['assign_program_clone', 'uuid, uuid, text, jsonb'],
  ['save_workout_as_template', 'uuid, uuid, text, uuid'],
  ['save_program_as_template', 'uuid, uuid, text, uuid'],
];

test('shared-library RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of functions) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`),
      `${name} must use invoker security with an empty search path`,
    );
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\)\\s+from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role;`));
  }
});

test('templates and instances are mutually exclusive by constraint', () => {
  for (const table of ['workouts', 'programs']) {
    assert.match(migration, new RegExp(`add constraint ${table}_template_or_instance_check\\s+check \\(\\(is_template and client_id is null\\) or \\(not is_template and client_id is not null\\)\\)`));
    assert.match(migration, new RegExp(`add constraint ${table}_variation_on_template_check\\s+check \\(variation_of is null or is_template\\)`));
  }
});

test('the migration is additive: no drops of tables/columns and no deletes', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
});

test('assigning clones from active, non-hidden templates only', () => {
  assert.match(migration, /assign_workout_clone[\s\S]*?archived = false and is_template and not hidden/);
  assert.match(migration, /assign_program_clone[\s\S]*?archived = false and is_template and not hidden/);
  // Instances belong to the client's coach, not the template author.
  assert.match(migration, /v_client\.coach_id, v_template\.name/);
  // Loads are translated to the cloned ids and reuse the existing validating RPCs.
  assert.match(migration, /return public\.save_program_assignment_with_loads\(/);
  assert.match(migration, /return public\.save_workout_assignment_with_loads\(/);
});

test('saving an instance as a template strips client-specific data and starts hidden', () => {
  assert.match(migration, /v_strip := p_as_template and not v_src\.is_template;/);
  assert.match(migration, /case when v_strip then null else v_ex\.default_load_value end/);
  assert.match(migration, /case when v_strip then null else v_ex\.coach_notes end/);
  assert.match(migration, /v_src\.id, p_variation_of, true, p_coach_id/);
  assert.match(migration, /Day notes on a client instance may be client-specific/);
  assert.match(migration, /case when v_src\.is_template then v_day\.notes else null end/);
  // Variations always attach to the root template.
  assert.match(migration, /select coalesce\(variation_of, id\) into v_root\s+from public\.programs/);
  assert.match(migration, /select coalesce\(variation_of, id\) into v_root\s+from public\.workouts/);
});

test('publisher attribution is filled for templates only and backfilled from coach_id', () => {
  assert.match(migration, /if new\.is_template and new\.created_by is null then\s+new\.created_by := new\.coach_id;/);
  assert.match(migration, /update public\.workouts set created_by = coach_id\s+where is_template and created_by is null and coach_id is not null;/);
  assert.match(migration, /update public\.programs set created_by = coach_id\s+where is_template and created_by is null and coach_id is not null;/);
});

test('archiving an assigned load is never blocked by its archived exercise', () => {
  assert.match(migration, /create or replace function public\.validate_assignment_exercise_load\(\)[\s\S]*?if new\.archived then\s+return new;\s+end if;/);
});
