const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backend = require('../src/lib/programDraft.cjs');

async function frontendTools() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'programDraft.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('near-duplicate exercise matching is deterministic and does not auto-match distinct movements', async () => {
  const library = [
    { id: 'bench', name: 'Bench Press (DB)' },
    { id: 'row', name: 'Cable Row' },
    { id: 'shoulder', name: 'Shoulder Press' },
  ];
  assert.equal(backend.findSimilarExercise('DB Bench Press', library)?.id, 'bench');
  assert.equal(backend.findSimilarExercise('Bench Pres (DB)', library)?.id, 'bench');
  assert.equal(backend.findSimilarExercise('Cable Fly', library), null);
  assert.equal(backend.findSimilarExercise('Goblet Squat', library), null);

  const frontend = await frontendTools();
  for (const name of ['DB Bench Press', 'Bench Pres (DB)', 'Cable Fly', 'Goblet Squat']) {
    assert.deepEqual(frontend.findSimilarExercise(name, library), backend.findSimilarExercise(name, library));
  }
});
