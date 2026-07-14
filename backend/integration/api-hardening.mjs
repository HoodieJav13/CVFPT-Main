import { randomBytes } from 'node:crypto';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required integration-test environment variable: ${name}`);
  return value;
};

const environment = required('CVF_TEST_ENV').toLowerCase();
if (!['development', 'preview'].includes(environment)) {
  throw new Error('CVF_TEST_ENV must be development or preview');
}
if (process.env.CVF_TEST_ALLOW_MUTATIONS !== 'true') {
  throw new Error('Refusing mutating integration tests without CVF_TEST_ALLOW_MUTATIONS=true');
}

const baseUrl = new URL(required('CVF_TEST_BASE_URL'));
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('CVF_TEST_BASE_URL must use HTTP(S)');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const allowedHosts = new Set(
  (process.env.CVF_TEST_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
);
if (!localHosts.has(baseUrl.hostname) && !allowedHosts.has(baseUrl.hostname.toLowerCase())) {
  throw new Error('Refusing unapproved remote target; allow its exact hostname in CVF_TEST_ALLOWED_HOSTS');
}

const accounts = {
  admin: { email: required('CVF_TEST_ADMIN_EMAIL'), password: required('CVF_TEST_ADMIN_PASSWORD') },
  coachA: { email: required('CVF_TEST_COACH_A_EMAIL'), password: required('CVF_TEST_COACH_A_PASSWORD') },
  coachB: { email: required('CVF_TEST_COACH_B_EMAIL'), password: required('CVF_TEST_COACH_B_PASSWORD') },
  client: { email: required('CVF_TEST_CLIENT_EMAIL'), password: required('CVF_TEST_CLIENT_PASSWORD') },
};

const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const cleanup = [];
let passed = 0;
let failed = 0;

function endpoint(path) {
  return new URL(`${baseUrl.pathname.replace(/\/$/, '')}${path}`, baseUrl).toString();
}

async function request(path, { method = 'GET', token, json, body, expected = 200 } = {}) {
  if (method === 'DELETE') throw new Error('Hard-delete requests are forbidden by this harness');
  const response = await fetch(endpoint(path), {
    method,
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json === undefined ? body : JSON.stringify(json),
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  if (response.status !== expected) {
    const safeError = payload && typeof payload === 'object' && !ArrayBuffer.isView(payload)
      ? payload.error || payload.message || 'request failed'
      : 'request failed';
    throw new Error(`${method} ${path}: expected ${expected}, received ${response.status} (${safeError})`);
  }
  return { response, payload };
}

async function check(name, action) {
  try {
    const value = await action();
    passed += 1;
    console.log(`PASS ${name}`);
    return value;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
    return null;
  }
}

async function login(account, role) {
  const result = await request('/auth/login', { method: 'POST', json: account, expected: 200 });
  if (!result.payload?.access_token || result.payload.role !== role) throw new Error(`expected ${role} login`);
  return result.payload;
}

async function main() {
  console.log(`Integration target: ${environment} (${baseUrl.hostname}); run ${runId}`);

  await check('health endpoint', () => request('/health'));
  await check('protected route rejects anonymous access', () => request('/dashboard/coach', { expected: 401 }));

  const admin = await check('admin login', () => login(accounts.admin, 'admin'));
  const coachA = await check('coach A login', () => login(accounts.coachA, 'coach'));
  const coachB = await check('coach B login', () => login(accounts.coachB, 'coach'));
  const client = await check('client login', () => login(accounts.client, 'client'));
  if (!admin || !coachA || !coachB || !client) throw new Error('Required fake-data accounts could not log in');

  for (const [name, session] of Object.entries({ admin, coachA, coachB, client })) {
    await check(`${name} /auth/me`, async () => {
      const { payload } = await request('/auth/me', { token: session.access_token });
      if (!payload.profile?.id) throw new Error('profile missing');
    });
  }
  await check('client is blocked from coach dashboard', () => request('/dashboard/coach', { token: client.access_token, expected: 403 }));
  await check('coach dashboard', () => request('/dashboard/coach', { token: coachA.access_token }));
  await check('client dashboard includes assigned coach', async () => {
    const { payload } = await request('/dashboard/client', { token: client.access_token });
    if (payload.coach_name !== coachA.profile.name) throw new Error('assigned coach name missing');
  });
  await check('admin overview', () => request('/admin/overview', { token: admin.access_token }));

  const resourceCategory = await check('resource category creation reuses case-insensitive matches', async () => {
    const { payload } = await request('/resource-categories', {
      method: 'POST', token: coachA.access_token, json: { name: '  general   info  ' },
    });
    if (payload.name !== 'General Info' || payload.reused !== true) throw new Error('seed category was not reused');
    return payload;
  });
  await check('resource upload rejects a non-PDF payload', async () => {
    const form = new FormData();
    form.set('title', `CVF TEST INVALID RESOURCE ${runId}`);
    form.set('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'invalid.txt');
    return request('/resources', { method: 'POST', token: coachA.access_token, body: form, expected: 400 });
  });
  const resource = await check('coach uploads private PDF resource', async () => {
    if (!resourceCategory) throw new Error('resource category unavailable');
    const form = new FormData();
    form.set('title', `CVF TEST RESOURCE ${runId}`);
    form.set('description', 'Automated resource access verification');
    form.set('category_id', resourceCategory.id);
    form.set('is_public', 'false');
    form.set('file', new Blob(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'], { type: 'application/pdf' }), `CVF-TEST-${runId}.pdf`);
    const { payload } = await request('/resources', {
      method: 'POST', token: coachA.access_token, body: form, expected: 201,
    });
    if (payload.storage_path || payload.signed_url) throw new Error('storage internals leaked from upload response');
    cleanup.push(() => request(`/resources/${payload.id}`, {
      method: 'PATCH', token: coachA.access_token, json: { archived: true },
    }));
    cleanup.push(() => request(`/resources/${payload.id}/assignments/${client.profile.id}`, {
      method: 'PATCH', token: coachA.access_token,
    }));
    return payload;
  });
  if (resource) {
    await check('other coach sees and manages resource regardless of uploader', async () => {
      const { payload: resources } = await request('/resources', { token: coachB.access_token });
      if (!resources.some((row) => row.id === resource.id)) throw new Error('cross-coach resource missing');
      const { payload } = await request(`/resources/${resource.id}`, {
        method: 'PATCH', token: coachB.access_token,
        json: { description: `CVF TEST CROSS-COACH UPDATED ${runId}` },
      });
      if (payload.description !== `CVF TEST CROSS-COACH UPDATED ${runId}`) throw new Error('cross-coach update failed');
    });
    await check('unassigned private resource is hidden with direct-link 404', async () => {
      const { payload } = await request('/resources', { token: client.access_token });
      if (payload.some((row) => row.id === resource.id)) throw new Error('private resource leaked into client list');
      return request(`/resources/${resource.id}/download-link`, { token: client.access_token, expected: 404 });
    });
    await check('public resource is visible and signed for client without leaking storage path', async () => {
      await request(`/resources/${resource.id}`, {
        method: 'PATCH', token: coachA.access_token, json: { is_public: true },
      });
      const { payload } = await request('/resources', { token: client.access_token });
      const visible = payload.find((row) => row.id === resource.id);
      if (!visible || visible.storage_path) throw new Error('public resource visibility or response shape mismatch');
      const { payload: link } = await request(`/resources/${resource.id}/download-link`, { token: client.access_token });
      if (!link.signed_url || link.storage_path || link.expires_in !== 60) throw new Error('signed-link response mismatch');
    });
    await check('private assignment grants client access', async () => {
      await request(`/resources/${resource.id}`, {
        method: 'PATCH', token: coachA.access_token, json: { is_public: false },
      });
      await request(`/resources/${resource.id}/assign`, {
        method: 'POST', token: coachA.access_token, expected: 201, json: { client_id: client.profile.id },
      });
      const { payload } = await request('/resources', { token: client.access_token });
      if (!payload.some((row) => row.id === resource.id)) throw new Error('assigned resource missing');
      return request(`/resources/${resource.id}/download-link`, { token: client.access_token });
    });
    await check('unassign revokes access and reassign reactivates the same pair', async () => {
      await request(`/resources/${resource.id}/assignments/${client.profile.id}`, {
        method: 'PATCH', token: coachA.access_token,
      });
      await request(`/resources/${resource.id}/download-link`, { token: client.access_token, expected: 404 });
      await request(`/resources/${resource.id}/assign`, {
        method: 'POST', token: coachA.access_token, expected: 201, json: { client_id: client.profile.id },
      });
      return request(`/resources/${resource.id}/download-link`, { token: client.access_token });
    });
  }

  const email = `cvf-test-${runId}@example.invalid`;
  const created = await check('coach creates isolated fake client', async () => {
    const { payload } = await request('/clients', {
      method: 'POST', token: coachA.access_token, expected: 201,
      json: { name: `CVF TEST ${runId}`, email, goals: 'Automated development verification' },
    });
    cleanup.push(() => request(`/clients/${payload.id}/archive`, {
      method: 'PATCH', token: coachA.access_token, json: { archived: true },
    }));
    return payload;
  });
  if (created) {
    await check('owning coach can read fake client', () => request(`/clients/${created.id}`, { token: coachA.access_token }));
    await check('other coach receives ownership-safe 404', () => request(`/clients/${created.id}`, { token: coachB.access_token, expected: 404 }));
    await check('admin can read fake client', () => request(`/clients/${created.id}`, { token: admin.access_token }));
    await check('owning coach edits fake client', async () => {
      const { payload } = await request(`/clients/${created.id}`, {
        method: 'PUT', token: coachA.access_token,
        json: { name: `CVF TEST EDITED ${runId}`, goals: 'Updated automated development verification' },
      });
      if (payload.name !== `CVF TEST EDITED ${runId}`) throw new Error('client edit did not persist');
    });
    await check('non-invited signup is rejected', () => request('/auth/signup', {
      method: 'POST', expected: 403, json: { email, password: randomBytes(24).toString('base64url') },
    }));

    const coachCheckIn = await check('coach creates fake check-in', async () => {
      const { payload } = await request(`/check-ins/clients/${created.id}`, {
        method: 'POST', token: coachA.access_token, expected: 201,
        json: { check_in_date: new Date().toISOString().slice(0, 10), energy: 3, coach_notes: `CVF TEST ${runId}` },
      });
      return payload;
    });
    if (coachCheckIn) {
      await check('coach updates and reviews fake check-in', () => request(`/check-ins/${coachCheckIn.id}`, {
        method: 'PUT', token: coachA.access_token,
        json: { energy: 4, review_status: 'reviewed', coach_notes: `CVF TEST REVIEWED ${runId}` },
      }));
      await check('coach soft-archives fake check-in', () => request(`/check-ins/${coachCheckIn.id}/archive`, {
        method: 'PATCH', token: coachA.access_token,
      }));
    }

    const packageRow = await check('admin creates fake package', async () => {
      const { payload } = await request('/packages', {
        method: 'POST', token: admin.access_token, expected: 201,
        json: { name: `CVF TEST ${runId}`, description: 'Automated development verification', price: 99, session_credits: 2, is_recurring: false },
      });
      cleanup.push(() => request(`/packages/${payload.id}/archive`, {
        method: 'PATCH', token: admin.access_token, json: { archived: true },
      }));
      return payload;
    });
    if (packageRow) {
      await check('admin updates fake package', () => request(`/packages/${packageRow.id}`, {
        method: 'PUT', token: admin.access_token,
        json: { description: 'Updated automated development verification', price: 100 },
      }));
      await check('coach records fake manual purchase', () => request('/payments/manual', {
        method: 'POST', token: coachA.access_token, expected: 201,
        json: { client_id: created.id, package_id: packageRow.id, amount: 100 },
      }));
      await check('manual purchase grants two credits', async () => {
        const { payload } = await request(`/payments/credits/${created.id}`, { token: coachA.access_token });
        if (payload.balance !== 2) throw new Error(`expected 2 credits, received ${payload.balance}`);
      });
    }

    const session = await check('coach creates fake session', async () => {
      const { payload } = await request('/sessions', {
        method: 'POST', token: coachA.access_token, expected: 201,
        json: { client_id: created.id, scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), duration_minutes: 60, location: 'CVF TEST Studio' },
      });
      return payload;
    });
    if (session) {
      await check('coach edits fake session', () => request(`/sessions/${session.id}`, {
        method: 'PUT', token: coachA.access_token,
        json: { duration_minutes: 45, location: 'CVF TEST Updated Studio' },
      }));
      const note = await check('coach adds shared session note', async () => {
        const { payload } = await request(`/sessions/${session.id}/notes`, {
          method: 'POST', token: coachA.access_token, expected: 201,
          json: { content: `CVF TEST NOTE ${runId}`, shared_with_client: true },
        });
        return payload;
      });
      if (note) {
        await check('coach edits session note sharing', () => request(`/sessions/notes/${note.id}`, {
          method: 'PUT', token: coachA.access_token,
          json: { content: `CVF TEST NOTE UPDATED ${runId}`, shared_with_client: false },
        }));
      }
      await check('coach completes fake session', () => request(`/sessions/${session.id}/complete`, {
        method: 'PATCH', token: coachA.access_token,
      }));
      await check('session completion deducts one credit', async () => {
        const { payload } = await request(`/payments/credits/${created.id}`, { token: coachA.access_token });
        if (payload.balance !== 1) throw new Error(`expected 1 credit, received ${payload.balance}`);
      });
      await check('completed session cannot complete twice', () => request(`/sessions/${session.id}/complete`, {
        method: 'PATCH', token: coachA.access_token, expected: 400,
      }));
    }

    const libraryExercise = await check('coach creates fake library exercise', async () => {
      const { payload } = await request('/programs/exercise-library', {
        method: 'POST', token: coachA.access_token, expected: 201,
        json: { name: `CVF TEST EXERCISE ${runId}`, category: 'Strength', video_url: 'https://example.com/cvf-test-video' },
      });
      return payload;
    });
    if (libraryExercise) {
      await check('coach updates fake library exercise', () => request(`/programs/exercise-library/${libraryExercise.id}`, {
        method: 'PUT', token: coachA.access_token,
        json: { notes: `CVF TEST UPDATED ${runId}`, review_status: 'approved' },
      }));
      await check('coach soft-archives fake library exercise', () => request(`/programs/exercise-library/${libraryExercise.id}/archive`, {
        method: 'PATCH', token: coachA.access_token, json: { archived: true },
      }));
    }

    const workout = await check('coach creates fake workout with video exercise', async () => {
      const { payload } = await request('/programs/workouts', {
        method: 'POST', token: coachA.access_token, expected: 201,
        json: {
          name: `CVF TEST WORKOUT ${runId}`,
          goal: 'Automated development verification',
          exercises: [{ name: 'CVF Test Movement', sets: '3', reps: '8', video_url: 'https://example.com/cvf-test-video', position: 0 }],
        },
      });
      return payload;
    });
    if (workout) {
      await check('coach updates fake workout', () => request(`/programs/workouts/${workout.id}`, {
        method: 'PUT', token: coachA.access_token,
        json: { description: `CVF TEST UPDATED ${runId}`, exercises: workout.exercises },
      }));
      const workoutAssignment = await check('coach assigns fake workout to client', async () => {
        const { payload } = await request('/programs/workout-assignments', {
          method: 'POST', token: coachA.access_token, expected: 201,
          json: { client_id: client.profile.id, workout_id: workout.id, assignment_mode: 'active', notes: `CVF TEST ${runId}` },
        });
        return payload;
      });
      if (workoutAssignment) {
        await check('client sees assigned workout and video link', async () => {
          const { payload } = await request('/programs/client/assigned', { token: client.access_token });
          const found = payload.workouts?.find((row) => row.id === workoutAssignment.id);
          if (!found?.workout?.exercises?.some((exercise) => exercise.video_url === 'https://example.com/cvf-test-video')) {
            throw new Error('assigned workout video link missing');
          }
        });
        await check('coach soft-archives workout assignment', () => request(`/programs/workout-assignments/${workoutAssignment.id}/archive`, {
          method: 'PATCH', token: coachA.access_token,
        }));
      }

      const program = await check('coach creates fake three-day program', async () => {
        const { payload } = await request('/programs', {
          method: 'POST', token: coachA.access_token, expected: 201,
          json: {
            name: `CVF TEST PROGRAM ${runId}`,
            description: 'Automated development verification',
            frequency_days: 3,
            days: [1, 2, 3].map((day) => ({ day_number: day, workout_id: workout.id, notes: `CVF TEST DAY ${day}` })),
          },
        });
        return payload;
      });
      if (program) {
        await check('coach updates fake program', () => request(`/programs/${program.id}`, {
          method: 'PUT', token: coachA.access_token,
          json: { description: `CVF TEST PROGRAM UPDATED ${runId}` },
        }));
        const assignment = await check('coach assigns fake program', async () => {
          const { payload } = await request(`/programs/${program.id}/assign`, {
            method: 'POST', token: coachA.access_token, expected: 201,
            json: { client_id: created.id, notes: `CVF TEST ${runId}` },
          });
          return payload;
        });
        if (assignment) {
          await check('coach soft-archives program assignment', () => request(`/programs/assignments/${assignment.id}/archive`, {
            method: 'PATCH', token: coachA.access_token,
          }));
        }
        await check('coach soft-archives fake program', () => request(`/programs/${program.id}/archive`, {
          method: 'PATCH', token: coachA.access_token,
        }));
      }
      await check('coach soft-archives fake workout', () => request(`/programs/workouts/${workout.id}/archive`, {
        method: 'PATCH', token: coachA.access_token,
      }));
    }

    await check('admin reassigns fake client to coach B', () => request(`/admin/clients/${created.id}/reassign`, {
      method: 'PATCH', token: admin.access_token, json: { coach_id: coachB.profile.id },
    }));
    await check('former coach loses access after reassignment', () => request(`/clients/${created.id}`, {
      token: coachA.access_token, expected: 404,
    }));
    await check('new coach gains access after reassignment', () => request(`/clients/${created.id}`, {
      token: coachB.access_token,
    }));
    await check('admin reassigns fake client back to coach A', () => request(`/admin/clients/${created.id}/reassign`, {
      method: 'PATCH', token: admin.access_token, json: { coach_id: coachA.profile.id },
    }));
  }

  const clientMetric = await check('coach creates metric for authenticated client', async () => {
    const { payload } = await request(`/progress/clients/${client.profile.id}/metrics`, {
      method: 'POST', token: coachA.access_token, expected: 201,
      json: { name: `CVF TEST METRIC ${runId}`, unit: 'reps', improvement_direction: 'higher' },
    });
    if (payload.improvement_direction !== 'higher') throw new Error('metric improvement direction was not persisted');
    cleanup.push(() => request(`/progress/metrics/${payload.id}/archive`, { method: 'PATCH', token: coachA.access_token }));
    return payload;
  });
  if (clientMetric) {
    await check('coach updates metric improvement direction', async () => {
      const { payload } = await request(`/progress/metrics/${clientMetric.id}`, {
        method: 'PATCH', token: coachA.access_token,
        json: { improvement_direction: 'higher' },
      });
      if (payload.improvement_direction !== 'higher') throw new Error('metric improvement direction update failed');
      return payload;
    });
    const entry = await check('client logs permitted progress entry', async () => {
      const { payload } = await request(`/progress/metrics/${clientMetric.id}/entries`, {
        method: 'POST', token: client.access_token, expected: 201,
        json: { value: 8, notes: `CVF TEST ${runId}` },
      });
      if (payload.is_personal_best !== false) throw new Error('first metric entry must establish a baseline, not a personal best');
      return payload;
    });
    if (entry) {
      const personalBest = await check('client receives personal-best semantics for improved entry', async () => {
        const { payload } = await request(`/progress/metrics/${clientMetric.id}/entries`, {
          method: 'POST', token: client.access_token, expected: 201,
          json: { value: 9, notes: `CVF TEST PR ${runId}` },
        });
        if (!payload.is_personal_best || payload.improvement_amount !== 1) throw new Error('improved entry was not marked as a personal best');
        return payload;
      });
      await check('client edits own progress entry', () => request(`/progress/entries/${entry.id}`, {
        method: 'PUT', token: client.access_token, json: { value: 8.5, notes: `CVF TEST UPDATED ${runId}` },
      }));
      await check('coach soft-archives progress entry', () => request(`/progress/entries/${entry.id}/archive`, {
        method: 'PATCH', token: coachA.access_token,
      }));
      if (personalBest) {
        await check('coach soft-archives personal-best progress entry', () => request(`/progress/entries/${personalBest.id}/archive`, {
          method: 'PATCH', token: coachA.access_token,
        }));
      }
    }
  }

  const booking = await check('client creates booking for approval', async () => {
    const { payload } = await request('/bookings', {
      method: 'POST', token: client.access_token, expected: 201,
      json: { requested_time: new Date(Date.now() + 5 * 86_400_000).toISOString(), duration_minutes: 60, location: 'CVF TEST Studio', note: `CVF TEST ${runId}` },
    });
    return payload;
  });
  if (booking) {
    const approved = await check('coach approves booking atomically', async () => {
      const { payload } = await request(`/bookings/${booking.id}/approve`, { method: 'PATCH', token: coachA.access_token });
      if (!payload.session?.id || payload.booking?.status !== 'approved') throw new Error('approval response missing session');
      return payload;
    });
    if (approved) {
      await check('client sees approved booking session', async () => {
        const { payload } = await request('/sessions/client/mine', { token: client.access_token });
        if (!payload.some((row) => row.id === approved.session.id)) throw new Error('approved session missing from client view');
      });
      await check('coach cancels approved test session', () => request(`/sessions/${approved.session.id}/cancel`, {
        method: 'PATCH', token: coachA.access_token,
      }));
    }
  }

  await check('client sends fake message', () => request('/messages/mine', {
    method: 'POST', token: client.access_token, expected: 201, json: { content: `CVF TEST CLIENT MESSAGE ${runId}` },
  }));
  await check('coach reads authenticated client thread', () => request(`/messages/with/${client.profile.id}`, {
    token: coachA.access_token,
  }));
  await check('coach replies to fake client message', () => request(`/messages/with/${client.profile.id}`, {
    method: 'POST', token: coachA.access_token, expected: 201, json: { content: `CVF TEST COACH MESSAGE ${runId}` },
  }));

  await check('Training Builder paste parser preserves flat eight-exercise input', async () => {
    const text = [
      'ATG DB Incline 3x12',
      'DB fly 2x12',
      'Lower traps 3x8',
      'Powell raise 2x10',
      'Flat bench 2x7 to true failure',
      'Decline bench 2x7 to true failure',
      'Pullovers 2x12',
      'Tiddy lift 2x10',
    ].join('\n');
    const { payload } = await request('/programs/import/parse-paste', {
      method: 'POST', token: coachA.access_token, json: { text }, expected: 422,
    });
    if (payload.draft?.program?.frequency_days !== 1 || payload.draft?.days?.[0]?.exercises?.length !== 8) {
      throw new Error('flat paste did not produce one day with eight exercises');
    }
    const flatBench = payload.draft.days[0].exercises.find((exercise) => exercise.name === 'Flat bench');
    if (flatBench?.sets !== '2' || flatBench?.reps !== '7' || flatBench?.client_notes !== 'to true failure') {
      throw new Error('flat paste lost sets, reps, or trailing cue');
    }
  });

  const template = await check('Training Builder CSV template', () => request('/programs/import/template.csv', { token: coachA.access_token }));
  const parsed = await check('Training Builder CSV parse', async () => {
    if (!template) throw new Error('template unavailable');
    const form = new FormData();
    form.set('file', new Blob([template.payload], { type: 'text/csv' }), `CVF-TEST-${runId}.csv`);
    const { payload } = await request('/programs/import/parse-csv', {
      method: 'POST', token: coachA.access_token, body: form, expected: 200,
    });
    payload.draft.program.name = `CVF TEST ${runId}`;
    payload.draft.days = payload.draft.days.map((day, dayIndex) => ({
      ...day,
      name: `CVF TEST ${runId} DAY ${dayIndex + 1}`,
      exercises: day.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        name: `CVF TEST ${runId} D${dayIndex + 1} E${exerciseIndex + 1}`,
      })),
    }));
    return payload.draft;
  });
  const imported = await check('Training Builder atomic import', async () => {
    if (!parsed) throw new Error('parsed draft unavailable');
    const { payload } = await request('/programs/import/commit', {
      method: 'POST', token: coachA.access_token, json: { draft: parsed }, expected: 201,
    });
    const programId = payload.program_id || payload.program?.id;
    if (!programId) throw new Error('program id missing');
    cleanup.push(() => request(`/programs/${programId}/archive`, { method: 'PATCH', token: coachA.access_token }));
    return { programId };
  });
  if (imported) {
    await check('imported program PDF export', async () => {
      const { response, payload } = await request(`/programs/${imported.programId}/export.pdf`, { token: coachA.access_token });
      if (!response.headers.get('content-type')?.includes('application/pdf') || payload.byteLength < 100) throw new Error('invalid PDF response');
    });
    await check('other coach cannot read imported program', () => request(`/programs/${imported.programId}`, { token: coachB.access_token, expected: 404 }));
  }

  const pasted = await check('Training Builder one-day paste uses the atomic import path', async () => {
    const reusedName = `CVF TEST ${runId} D1 E1`;
    const newExerciseName = `CVF TEST PASTE ${runId}`;
    const text = `${reusedName.toLowerCase().replace(/ /g, '  ')} 2x7 to true failure\n${newExerciseName} 3x8`;
    const { payload: parsedPaste } = await request('/programs/import/parse-paste', {
      method: 'POST', token: coachA.access_token, json: { text }, expected: 422,
    });
    parsedPaste.draft.program.name = `CVF TEST PASTE PROGRAM ${runId}`;
    parsedPaste.draft.days[0].name = `CVF TEST PASTE DAY ${runId}`;
    const { payload } = await request('/programs/import/commit', {
      method: 'POST', token: coachA.access_token, json: { draft: parsedPaste.draft }, expected: 201,
    });
    const programId = payload.program_id || payload.program?.id;
    if (!programId || payload.program?.frequency_days !== 1) throw new Error('one-day pasted program missing');
    cleanup.push(() => request(`/programs/${programId}/archive`, { method: 'PATCH', token: coachA.access_token }));
    return { programId, reusedName, newExerciseName, result: payload };
  });
  if (pasted) {
    await check('paste import reuses normalized names and tags new exercises manual', async () => {
      const normalizedReusedName = pasted.reusedName.toLowerCase().trim().replace(/\s+/g, ' ');
      if (!pasted.result.reused_exercises?.some((exercise) => (
        String(exercise.name || '').toLowerCase().trim().replace(/\s+/g, ' ') === normalizedReusedName
      ))) {
        throw new Error('normalized exercise was not reused');
      }
      const { payload } = await request('/programs/exercise-library', { token: coachA.access_token });
      const createdExercise = payload.find((exercise) => exercise.name === pasted.newExerciseName);
      if (createdExercise?.source !== 'manual' || createdExercise?.review_status !== 'needs_review') {
        throw new Error('pasted exercise source/review state mismatch');
      }
    });
    await check('one-day pasted program remains editable', async () => {
      const { payload: current } = await request(`/programs/${pasted.programId}`, { token: coachA.access_token });
      const { payload } = await request(`/programs/${pasted.programId}`, {
        method: 'PUT', token: coachA.access_token,
        json: {
          name: current.name,
          description: `CVF TEST PASTE UPDATED ${runId}`,
          frequency_days: 1,
          days: current.days.map((day) => ({ day_number: day.day_number, workout_id: day.workout_id, notes: day.notes || '' })),
        },
      });
      if (payload.frequency_days !== 1 || payload.description !== `CVF TEST PASTE UPDATED ${runId}`) {
        throw new Error('one-day pasted program edit did not persist');
      }
    });
  }

  await check('client assigned-program view', () => request('/programs/client/assigned', { token: client.access_token }));
  await check('client check-in view', () => request('/check-ins/mine', { token: client.access_token }));
  await check('client progress view', () => request('/progress/mine', { token: client.access_token }));
  await check('client messages view', () => request('/messages/mine', { token: client.access_token }));
  await check('client waiver status', () => request('/waivers/my-status', { token: client.access_token }));
  await check('payment configuration is test-safe or disabled', async () => {
    const { payload } = await request('/payments/config', { token: client.access_token });
    if (payload.publishable_key && !String(payload.publishable_key).startsWith('pk_test_')) throw new Error('non-test publishable key returned');
  });
  await check('client payment history', () => request('/payments/history', { token: client.access_token }));
  await check('client credit balance', () => request('/payments/credits', { token: client.access_token }));
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`FAIL harness: ${error.message}`);
} finally {
  for (const action of cleanup.reverse()) {
    try { await action(); } catch (error) { failed += 1; console.error(`FAIL cleanup: ${error.message}`); }
  }
  console.log(`Integration result: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
