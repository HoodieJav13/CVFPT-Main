const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const routePath = path.join(__dirname, '..', 'src', 'routes', 'programs.js');
const routeSource = fs.readFileSync(routePath, 'utf8');

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

test('structured program create and update accept only one through five days', () => {
  const isSupportedProgramFrequency = vm.runInNewContext(`(${namedFunction(routeSource, 'isSupportedProgramFrequency')})`);
  for (const frequency of [1, 2, 3, 4, 5]) assert.equal(isSupportedProgramFrequency(frequency), true);
  for (const frequency of [0, 6, 1.5, '1', NaN]) assert.equal(isSupportedProgramFrequency(frequency), false);

  const guardedRoutes = routeSource.match(
    /if \(!isSupportedProgramFrequency\(frequency\)\) return res\.status\(400\)\.json\(\{ error: 'Choose 1 to 5 days per week' \}\);/g,
  ) || [];
  assert.equal(guardedRoutes.length, 2, 'both structured program POST and PUT must use the 1-5 day guard');
  assert.doesNotMatch(routeSource, /Choose 3, 4, or 5 days per week/);
});

test('paste parsing is coach-protected, import-limited, and commit sources remain stable', async (t) => {
  assert.match(
    routeSource,
    /router\.post\('\/import\/parse-paste', requireCoach, csvImportLimiter, async \(req, res\) => \{/,
  );
  const supabasePath = require.resolve('../src/supabase');
  const authPath = require.resolve('../src/middleware/auth');
  const programsPath = require.resolve('../src/routes/programs');
  const originalSupabase = require.cache[supabasePath];
  const originalAuth = require.cache[authPath];
  const originalPrograms = require.cache[programsPath];
  const rpcCalls = [];

  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'exercise_library');
      return {
        select() { return this; },
        eq() { return this; },
        async order() {
          return {
            data: [
              { id: 'lib-goblet', name: 'Goblet Squat' },
              { id: 'lib-db-bench', name: 'Bench Press (DB)' },
              { id: 'lib-cable-row', name: 'Cable Row' },
            ],
            error: null,
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: {}, error: null };
    },
  };
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    if (token === 'Bearer coach') {
      req.user = { authUserId: 'coach-auth', role: 'coach', coach: { id: 'coach-id' } };
      return next();
    }
    if (token === 'Bearer client') {
      req.user = { authUserId: 'client-auth', role: 'client', client: { id: 'client-id' } };
      return next();
    }
    return res.status(401).json({ error: 'Missing authorization token' });
  };
  const requireCoach = (req, res, next) => (
    req.user?.role === 'coach' || req.user?.role === 'admin'
      ? next()
      : res.status(403).json({ error: 'Coach access required' })
  );
  const requireClient = (req, res, next) => (
    req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })
  );

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabaseAdmin },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: { requireAuth, requireCoach, requireClient, canAccessClient: () => false },
  };
  delete require.cache[programsPath];

  t.after(() => {
    if (originalSupabase) require.cache[supabasePath] = originalSupabase;
    else delete require.cache[supabasePath];
    if (originalAuth) require.cache[authPath] = originalAuth;
    else delete require.cache[authPath];
    if (originalPrograms) require.cache[programsPath] = originalPrograms;
    else delete require.cache[programsPath];
  });

  const programsRouter = require(programsPath);
  const app = express();
  app.use(express.json());
  app.use('/programs', programsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/programs`;

  const post = (pathname, body, token) => fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const unauthorized = await post('/import/parse-paste', { text: '' });
  assert.equal(unauthorized.status, 401);

  const client = await post('/import/parse-paste', { text: '' }, 'client');
  assert.equal(client.status, 403);

  const empty = await post('/import/parse-paste', { text: '' }, 'coach');
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: "Couldn't find any exercises in this text." });
  assert.match(empty.headers.get('ratelimit-policy') || '', /30/);

  const parsed = await post('/import/parse-paste', { text: 'Goblet Squat 3x8' }, 'coach');
  assert.equal(parsed.status, 422);
  const parsedBody = await parsed.json();
  assert.equal(parsedBody.draft.days.length, 1);
  assert.equal(parsedBody.draft.days[0].exercises[0].name, 'Goblet Squat');
  assert.ok(parsedBody.errors.some((error) => error.path === 'program.name'));

  const draft = {
    program: { name: 'Route source contract', description: '', frequency_days: 1, source: 'paste' },
    days: [{
      day_number: 1,
      name: 'Day 1',
      goal: '',
      notes: '',
      exercises: [{ name: 'Goblet Squat', sets: '3', reps: '8' }],
    }],
    import_meta: { source_type: 'paste', warnings: [] },
  };
  const expectedSources = [
    ['paste', 'manual'],
    ['csv', 'import_csv'],
    ['pdf', 'import_pdf_ai'],
  ];
  for (const [sourceType] of expectedSources) {
    const frequency = sourceType === 'paste' ? 1 : 3;
    const response = await post('/import/commit', {
      draft: {
        ...draft,
        program: { ...draft.program, frequency_days: frequency, source: sourceType },
        days: Array.from({ length: frequency }, (_, index) => ({
          ...draft.days[0],
          day_number: index + 1,
          name: `Day ${index + 1}`,
        })),
        import_meta: { ...draft.import_meta, source_type: sourceType },
      },
    }, 'coach');
    assert.equal(response.status, 201);
  }

  assert.deepEqual(
    rpcCalls.map(({ name, args }) => [name, args.p_source]),
    expectedSources.map(([, source]) => ['commit_program_import', source]),
  );

  const nearDuplicateDraft = {
    ...draft,
    days: [{ ...draft.days[0], exercises: [{ name: 'DB Bench Press', sets: '3', reps: '8' }] }],
  };
  const unresolved = await post('/import/commit', { draft: nearDuplicateDraft }, 'coach');
  assert.equal(unresolved.status, 422);
  const unresolvedBody = await unresolved.json();
  assert.equal(unresolvedBody.error, 'Review similar exercise names before saving.');
  assert.equal(unresolvedBody.errors[0].suggested_exercise_id, 'lib-db-bench');

  const useExisting = await post('/import/commit', {
    draft: {
      ...nearDuplicateDraft,
      days: [{
        ...nearDuplicateDraft.days[0],
        exercises: [{ ...nearDuplicateDraft.days[0].exercises[0], exercise_library_id: 'lib-db-bench' }],
      }],
    },
  }, 'coach');
  assert.equal(useExisting.status, 201);
  assert.equal(rpcCalls.at(-1).args.p_draft.days[0].exercises[0].exercise_library_id, 'lib-db-bench');

  const createNew = await post('/import/commit', {
    draft: {
      ...nearDuplicateDraft,
      days: [{
        ...nearDuplicateDraft.days[0],
        exercises: [{ ...nearDuplicateDraft.days[0].exercises[0], similarity_decision: 'create_new' }],
      }],
    },
  }, 'coach');
  assert.equal(createNew.status, 201);
  assert.equal(rpcCalls.at(-1).args.p_draft.days[0].exercises[0].similarity_decision, 'create_new');
});
