// Optional import of an OFFLINE draft proposal (the separate MOCK drafting
// companion's export) into the coach's existing program import review. The
// proposal is untrusted: nothing is created until it passes these checks AND a
// coach explicitly confirms; it is saved as a program template only (never
// assigned). No provider or network AI is involved anywhere in PT.
//
// Identity contract with the companion: its catalog snapshot is
// { revision, exercises } hashed as canonical (sorted-key) JSON with SHA-256.
// PT has no catalog revisions, so the revision is derived from the catalog's
// own content: "pt-catalog:" + sha256(canonical(projection)).
import { normalizeName, validateDraft } from './programDraft.js';

export const PROPOSAL_STATUS = 'PROPOSAL — not assigned, not a prescription';
export const PROPOSAL_CONTRACT = 'pt-draft-proposal-v1';
const CATALOG_PREFIX = 'pt-catalog:';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHex64 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256Hex(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The rows the import commit can match (non-archived, hidden included), in the
// companion's catalog-row shape, sorted by id.
export function catalogProjection(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isPlainObject(row) && typeof row.id === 'string' && row.archived !== true)
    .map((row) => ({
      id: row.id,
      name: String(row.name ?? ''),
      category: row.category ?? null,
      equipment: row.equipment ?? null,
      primary_muscle: row.primary_muscle ?? null,
      review_status: row.review_status ?? 'approved',
      archived: false,
      hidden: row.hidden === true,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function catalogIdentity(rows) {
  const exercises = catalogProjection(rows);
  const revision = `${CATALOG_PREFIX}${await sha256Hex(exercises)}`;
  return { revision, sha256: await sha256Hex({ revision, exercises }), exercises };
}

const refuse = (code, errors, message) => ({ ok: false, refusal: { code, message, errors } });

// The exact row paths of a validated draft, in order: days.<d>.exercises.<e>
// with plain decimal indices (no zero padding, signs or other aliases).
export function canonicalRowPaths(draft) {
  return draft.days.flatMap((day, dayIndex) => day.exercises.map((_, exerciseIndex) => `days.${dayIndex}.exercises.${exerciseIndex}`));
}

function rowAt(draft, path) {
  const match = /^days\.(0|[1-9]\d*)\.exercises\.(0|[1-9]\d*)$/.exec(path);
  return match ? draft.days?.[Number(match[1])]?.exercises?.[Number(match[2])] : undefined;
}

// Bindings must map one-to-one onto the draft's canonical row paths: every
// binding names an existing row exactly as canonicalRowPaths spells it, no row
// is bound twice, and no row is left unbound. Its day_number matches the row's day.
function pathBijectionProblems(rows, draft) {
  const errors = [];
  const expected = canonicalRowPaths(draft);
  const known = new Set(expected);
  const bound = new Set();
  rows.forEach((binding, index) => {
    const path = `exercise_bindings.rows.${index}`;
    const rowPath = binding.program_draft_path;
    if (!known.has(rowPath)) {
      errors.push({ path, message: `${rowPath} is not a program row path (expected one of days.<day>.exercises.<row>, as listed in the draft)` });
      return;
    }
    if (bound.has(rowPath)) {
      errors.push({ path, message: `Duplicate binding for ${rowPath}` });
      return;
    }
    bound.add(rowPath);
    const dayIndex = Number(rowPath.split('.')[1]);
    if (binding.day_number !== draft.days[dayIndex].day_number) {
      errors.push({ path, message: `${rowPath} is in day ${draft.days[dayIndex].day_number}, but the binding says day ${binding.day_number}` });
    }
  });
  expected.filter((rowPath) => !bound.has(rowPath)).forEach((rowPath) => {
    errors.push({ path: 'exercise_bindings.rows', message: `No binding for program row ${rowPath}` });
  });
  return errors;
}

// Checks a bound row against the CURRENT catalog: exists, usable, same name,
// and the only row the import's name match can resolve to.
function bindingProblems(bindings, draft, catalog) {
  const errors = [];
  const byId = new Map(catalog.exercises.map((row) => [row.id, row]));
  const nameCounts = new Map();
  catalog.exercises.forEach((row) => nameCounts.set(normalizeName(row.name), (nameCounts.get(normalizeName(row.name)) || 0) + 1));
  bindings.rows.forEach((binding, index) => {
    const path = `exercise_bindings.rows.${index}`;
    const row = rowAt(draft, binding.program_draft_path);
    const current = byId.get(binding.exercise_id);
    if (!row) errors.push({ path, message: `Binding points at a missing row (${binding.program_draft_path})` });
    else if (normalizeName(row.name) !== normalizeName(binding.catalog_name_at_snapshot)) errors.push({ path, message: `Row ${binding.program_draft_path} is "${row.name}", but the proposal bound "${binding.catalog_name_at_snapshot}"` });
    if (!current) { errors.push({ path, message: `Exercise ${binding.exercise_id} is not in the current catalog` }); return; }
    if (current.hidden) errors.push({ path, message: `${current.name} is hidden in the catalog` });
    if (current.review_status !== 'approved') errors.push({ path, message: `${current.name} is not approved in the catalog` });
    if (current.name !== binding.catalog_name_at_snapshot) errors.push({ path, message: `Exercise ${binding.exercise_id} is now named "${current.name}", not "${binding.catalog_name_at_snapshot}"` });
    if ((nameCounts.get(normalizeName(current.name)) || 0) > 1) errors.push({ path, message: `More than one catalog exercise is named "${current.name}"; the import matches by name, so the bound exercise cannot be guaranteed` });
  });
  return errors;
}

export async function verifyOfflineProposal(envelope, libraryRows) {
  if (!isPlainObject(envelope)) return refuse('invalid_proposal_file', [{ path: '', message: 'The file is not a proposal object' }], 'This is not an offline draft proposal file.');
  const shapeErrors = [];
  if (envelope.status !== PROPOSAL_STATUS) shapeErrors.push({ path: 'status', message: `Expected "${PROPOSAL_STATUS}"` });
  if (typeof envelope.provider !== 'string' || !envelope.provider.startsWith('DISABLED / MOCK')) shapeErrors.push({ path: 'provider', message: 'Only MOCK offline proposals are accepted' });
  if (envelope.contract_version !== PROPOSAL_CONTRACT) shapeErrors.push({ path: 'contract_version', message: `Expected ${PROPOSAL_CONTRACT}` });
  for (const key of ['provenance', 'exercise_bindings', 'program_draft']) if (!isPlainObject(envelope[key])) shapeErrors.push({ path: key, message: 'Missing or not an object' });
  if (shapeErrors.length) return refuse('invalid_proposal_file', shapeErrors, 'This is not a valid offline draft proposal.');

  const checked = validateDraft(envelope.program_draft);
  if (!checked.valid) return refuse('draft_invalid', checked.errors.map((error) => ({ path: `program_draft.${error.path}`, message: error.message })), 'The proposal\'s program draft does not pass PT\'s draft rules.');
  const draft = checked.draft;

  const { provenance, exercise_bindings: bindings } = envelope;
  const bindingErrors = [];
  for (const key of ['catalog_revision', 'catalog_sha256', 'accepted_revision', 'accepted_sha256']) {
    if (bindings[key] !== provenance[key]) bindingErrors.push({ path: `exercise_bindings.${key}`, message: 'Does not match the proposal provenance' });
  }
  for (const key of ['catalog_sha256', 'accepted_sha256']) if (!isHex64(provenance[key])) bindingErrors.push({ path: `provenance.${key}`, message: 'Not a SHA-256 hash' });
  const rows = Array.isArray(bindings.rows) ? bindings.rows : null;
  if (!rows) bindingErrors.push({ path: 'exercise_bindings.rows', message: 'Missing binding rows' });
  else {
    const wellFormed = rows.every((binding, index) => {
      const ok = isPlainObject(binding) && typeof binding.exercise_id === 'string' && typeof binding.program_draft_path === 'string'
        && typeof binding.catalog_name_at_snapshot === 'string' && Number.isSafeInteger(binding.day_number);
      if (!ok) bindingErrors.push({ path: `exercise_bindings.rows.${index}`, message: 'Malformed binding' });
      return ok;
    });
    const rowCount = canonicalRowPaths(draft).length;
    if (rows.length !== rowCount) bindingErrors.push({ path: 'exercise_bindings.rows', message: `Expected one binding per program row (${rowCount}), found ${rows.length}` });
    if (wellFormed) bindingErrors.push(...pathBijectionProblems(rows, draft));
  }
  if (bindingErrors.length) return refuse('binding_invalid', bindingErrors, 'The proposal\'s exercise bindings are inconsistent; it may have been edited after export.');

  const catalog = await catalogIdentity(libraryRows);
  if (provenance.catalog_revision !== catalog.revision || provenance.catalog_sha256 !== catalog.sha256) {
    return refuse('catalog_revision_mismatch', [{ path: 'provenance.catalog_revision', message: `Proposal catalog ${provenance.catalog_revision} ≠ current catalog ${catalog.revision}` }],
      'The exercise catalog changed since this proposal was drafted. Draft it again against the current catalog.');
  }
  const exerciseErrors = bindingProblems(bindings, draft, catalog);
  if (exerciseErrors.length) return refuse('exercise_binding_mismatch', exerciseErrors, 'Some proposed exercises cannot be matched to exactly one current catalog exercise.');

  return {
    ok: true,
    draft,
    bindings: bindings.rows.map((binding) => ({ ...binding })),
    identity: {
      proposal_sha256: await sha256Hex(envelope),
      accepted_sha256: provenance.accepted_sha256,
      accepted_revision: provenance.accepted_revision,
      catalog_revision: catalog.revision,
      catalog_sha256: catalog.sha256,
      request_id: provenance.request_id ?? null,
      accepted_by: provenance.accepted_by ?? null,
    },
  };
}

// Just before saving: the catalog is re-read and the coach-edited draft is
// re-checked so a stale catalog or an edited bound row is refused, unsent.
export async function recheckBeforeCommit(verified, currentDraft, freshLibraryRows) {
  const catalog = await catalogIdentity(freshLibraryRows);
  if (catalog.revision !== verified.identity.catalog_revision) {
    return refuse('catalog_revision_mismatch', [{ path: 'catalog', message: `The catalog changed to ${catalog.revision} during review` }], 'The exercise catalog changed during review. Nothing was saved.');
  }
  const checked = validateDraft(currentDraft);
  if (!checked.valid) return refuse('draft_invalid', checked.errors, 'Fix draft errors before saving.');
  const structure = pathBijectionProblems(verified.bindings, checked.draft);
  if (structure.length) return refuse('exercise_binding_mismatch', structure, 'The proposal\'s rows changed during review, so its bindings no longer cover them exactly. Nothing was saved.');
  const errors = bindingProblems({ rows: verified.bindings }, checked.draft, catalog);
  if (errors.length) return refuse('exercise_binding_mismatch', errors, 'A proposed exercise was changed during review. Re-check the proposal; nothing was saved.');
  return { ok: true, draft: checked.draft };
}
