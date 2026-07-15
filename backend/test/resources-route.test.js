const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'resources.js'), 'utf8');
const categorySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'resourceCategories.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const rateLimitSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'rateLimits.js'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260712060335_coach_managed_pdf_resource_library.sql'),
  'utf8',
);
const archiveMigrationSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260715005452_archive_resource_with_assignment_choice.sql'),
  'utf8',
);

function namedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not read ${name}`);
}

test('resource migration creates service-role-only soft-state tables and a private PDF bucket', () => {
  for (const table of ['resource_categories', 'resource_library', 'resource_assignments']) {
    assert.match(migrationSource, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migrationSource, new RegExp(`grant select, insert, update on table public\\.${table} to service_role`));
  }
  assert.match(migrationSource, /unique\(resource_id, client_id\)/);
  assert.match(migrationSource, /on public\.resource_categories \(lower\(btrim\(name\)\)\)/);
  assert.match(migrationSource, /insert into storage\.buckets/);
  assert.match(migrationSource, /'resource-library',[\s\S]*?false,[\s\S]*?10485760,[\s\S]*?array\['application\/pdf'\]/);
  assert.doesNotMatch(migrationSource, /grant\s+delete/i);
  assert.doesNotMatch(migrationSource, /security\s+definer/i);
});

test('resource routes use existing auth, coach guards, upload rate limiting, and soft assignment state', () => {
  assert.match(routeSource, /router\.use\(requireAuth\)/);
  assert.match(routeSource, /router\.post\('\/', requireCoach, resourceUploadLimiter, resourceUpload/);
  assert.match(routeSource, /router\.patch\('\/:id', requireCoach/);
  assert.match(routeSource, /router\.post\('\/:id\/archive', requireCoach/);
  assert.match(routeSource, /router\.post\('\/:id\/assign', requireCoach/);
  assert.match(routeSource, /router\.patch\('\/:id\/assignments\/:clientId', requireCoach/);
  assert.match(routeSource, /canAccessClient\(user, data\)/);
  assert.match(routeSource, /upsert\([\s\S]*?active: true[\s\S]*?onConflict: 'resource_id,client_id'/);
  assert.match(routeSource, /update\(\{ active: false \}\)/);
  assert.match(routeSource, /insert\(\{ resource_id: resource\.id, client_id: client\.id, active: false \}\)/);
  assert.doesNotMatch(routeSource, /\.delete\(/);
  assert.match(rateLimitSource, /identifier: 'resource-upload-pdf'[\s\S]*?limit: 10/);
  assert.match(appSource, /app\.use\('\/api\/resources', require\('\.\/routes\/resources'\)\)/);
  assert.match(appSource, /app\.use\('\/api\/resource-categories', require\('\.\/routes\/resourceCategories'\)\)/);
});

test('resource archival requires an explicit access choice and preserves assigned archived downloads', () => {
  assert.match(routeSource, /\['keep', 'revoke'\]\.includes\(assignmentAccess\)/);
  assert.match(routeSource, /\.rpc\('archive_resource',[\s\S]*?p_revoke_assigned_access: assignmentAccess === 'revoke'/);
  assert.match(routeSource, /and\(archived\.eq\.false,is_public\.eq\.true\),id\.in/);
  assert.match(routeSource, /includeArchived: req\.user\.role === 'client'/);
  assert.match(routeSource, /Use the resource archive action to choose assigned client access/);
  assert.match(archiveMigrationSource, /create or replace function public\.archive_resource/);
  assert.match(archiveMigrationSource, /security invoker[\s\S]*?set search_path = ''/);
  assert.match(archiveMigrationSource, /update public\.resource_assignments[\s\S]*?set active = false/);
  assert.match(archiveMigrationSource, /revoke execute on function public\.archive_resource\(uuid, boolean\)[\s\S]*?from public, anon, authenticated/);
  assert.match(archiveMigrationSource, /grant execute on function public\.archive_resource\(uuid, boolean\) to service_role/);
});

test('PDF validation requires the MIME type and PDF signature', () => {
  const isPdfFile = vm.runInNewContext(`(${namedFunction(routeSource, 'isPdfFile')})`, { Buffer });
  assert.equal(isPdfFile({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') }), true);
  assert.equal(isPdfFile({ mimetype: 'text/plain', buffer: Buffer.from('%PDF-1.4\n%%EOF') }), false);
  assert.equal(isPdfFile({ mimetype: 'application/pdf', buffer: Buffer.from('not a PDF') }), false);
  assert.equal(isPdfFile(null), false);
});

test('client responses omit storage paths and signing happens only after permission checks', () => {
  const fieldsMatch = routeSource.match(/const RESOURCE_FIELDS = \[([\s\S]*?)\]\.join\(','\);/);
  assert.ok(fieldsMatch);
  assert.doesNotMatch(fieldsMatch[1], /storage_path/);
  const downloadStart = routeSource.indexOf("router.get('/:id/download-link'");
  const downloadRoute = routeSource.slice(downloadStart, downloadStart + 1_800);
  assert.ok(downloadRoute.indexOf('clientCanAccessResource') < downloadRoute.indexOf('createSignedUrl'));
  assert.match(downloadRoute, /return res\.status\(404\)\.json\(\{ error: 'Resource not found' \}\)/);
  assert.match(downloadRoute, /signed_url: data\.signedUrl/);
  assert.doesNotMatch(downloadRoute, /storage_path:/);
});

test('resource categories reuse case-insensitive matches and handle concurrent uniqueness races', () => {
  assert.match(categorySource, /normalizedCategoryName\(category\.name\)\.toLowerCase\(\) === name\.toLowerCase\(\)/);
  assert.match(categorySource, /error\.code === '23505'/);
  assert.match(categorySource, /reused: true/);
});

test('failed database inserts trigger best-effort orphaned storage cleanup only', () => {
  assert.match(routeSource, /if \(uploadedPath\)[\s\S]*?\.remove\(\[uploadedPath\]\)/);
  assert.match(routeSource, /uploadedPath = null;[\s\S]*?return res\.status\(201\)/);
  assert.doesNotMatch(routeSource, /remove\(\[resource\.storage_path\]\)/);
});
