// Exercise demo references (docs/exercise-guides/design.md): strict YouTube
// single-video parsing and live current-demo resolution. The backend CommonJS
// copy and the browser ESM copy are independent runtimes held to the SAME
// vectors here, because the two deploy roots may never import each other.
const test = require('node:test');
const assert = require('node:assert/strict');
const backend = require('../src/lib/exerciseDemo');

const loadFrontend = () => import('../../frontend/src/lib/exerciseDemo.js');
const ID = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;

const ACCEPTED = [
  [`https://www.youtube.com/watch?v=${ID}`, ID],
  [`https://youtube.com/watch?v=${ID}`, ID],
  [`https://m.youtube.com/watch?v=${ID}`, ID],
  [`https://WWW.YouTube.com/watch?v=${ID}`, ID],
  [`  https://www.youtube.com/watch?v=${ID}  `, ID],
  [`https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`, ID],
  // A single video inside a playlist link is still that one video; the list is stripped.
  [`https://www.youtube.com/watch?v=${ID}&list=PLsynthetic000000000000000000000`, ID],
  [`https://www.youtube.com/watch?v=${ID}#t=10`, ID],
  [`https://youtu.be/${ID}`, ID],
  [`https://youtu.be/${ID}?si=sharetracking&t=3`, ID],
  [`https://youtu.be/${ID}/`, ID],
  [`https://www.youtube.com/shorts/${ID}`, ID],
  [`https://youtube.com/shorts/${ID}?feature=share`, ID],
  [`https://www.youtube.com/embed/${ID}`, ID],
  [`https://www.youtube.com/embed/${ID}?start=5`, ID],
  ['https://youtu.be/a_b-C1d2E3f', 'a_b-C1d2E3f'],
];

const REJECTED = [
  null, undefined, 42, {}, '', '   ',
  // Plain HTTP is never embedded (it may stay an external link elsewhere).
  `http://www.youtube.com/watch?v=${ID}`,
  `http://youtu.be/${ID}`,
  // Credentials, ports and deceptive hosts.
  `https://user:pass@www.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com:8443/watch?v=${ID}`,
  `https://www.youtube.com:443/watch?v=${ID}`.replace(':443', ':444'),
  `https://youtube.com.evil.example/watch?v=${ID}`,
  `https://evil.example/www.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com.@evil.example/watch?v=${ID}`,
  `https://notyoutube.com/watch?v=${ID}`,
  `https://www.youtube.co/watch?v=${ID}`,
  `https://youtube.com./watch?v=${ID}`,
  `https://music.youtube.com/watch?v=${ID}`,
  `https://www.youtube-nocookie.com/embed/${ID}`,
  `https://youtu.be.evil.example/${ID}`,
  // Invalid ids.
  'https://www.youtube.com/watch?v=short',
  `https://www.youtube.com/watch?v=${ID}x`,
  'https://www.youtube.com/watch?v=dQw4w9WgXc!',
  'https://www.youtube.com/watch?v=dQw4w9WgXc%20',
  `https://www.youtube.com/watch?v=${ID}&v=aaaaaaaaaaa`,
  'https://youtu.be/',
  `https://youtu.be/${ID}/extra`,
  `https://www.youtube.com/shorts/${ID}/extra`,
  // Playlist, channel and other non single-video pages.
  'https://www.youtube.com/playlist?list=PLsynthetic000000000000000000000',
  `https://www.youtube.com/watch?list=PLsynthetic000000000000000000000`,
  'https://www.youtube.com/@cvfsynthetic',
  'https://www.youtube.com/channel/UCsynthetic000000000000',
  `https://www.youtube.com/live/${ID}`,
  `https://www.youtube.com/v/${ID}`,
  `https://www.youtube.com/watch/${ID}`,
  // Pasted HTML / scripts / other schemes.
  `<iframe src="https://www.youtube.com/embed/${ID}"></iframe>`,
  `https://www.youtube.com/watch?v=${ID}"><script>alert(1)</script>`,
  `javascript:alert('${WATCH}')`,
  `data:text/html,${WATCH}`,
  `//www.youtube.com/watch?v=${ID}`,
  `www.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com/watch?v=${ID}\nhttps://evil.example`,
  `https://www.you\ttube.com/watch?v=${ID}`,
  `https://www.youtube.com/watch?v=${ID}&${'a'.repeat(2100)}`,
];

for (const [label, load] of [['backend', async () => backend], ['frontend', loadFrontend]]) {
  test(`${label}: parseYouTubeDemo accepts only HTTPS single-video forms and canonicalizes`, async () => {
    const { parseYouTubeDemo } = await load();
    for (const [input, id] of ACCEPTED) {
      assert.deepEqual(parseYouTubeDemo(input), { videoId: id, watchUrl: `https://www.youtube.com/watch?v=${id}` }, String(input));
    }
  });

  test(`${label}: parseYouTubeDemo rejects deceptive, unsafe and non single-video inputs`, async () => {
    const { parseYouTubeDemo } = await load();
    for (const input of REJECTED) assert.equal(parseYouTubeDemo(input), null, JSON.stringify(input));
  });
}

const LIB_A = `https://youtu.be/${'A'.repeat(11)}`;
const LIB_B = `https://www.youtube.com/watch?v=${'B'.repeat(11)}`;
const OVERRIDE = `https://youtu.be/${'C'.repeat(11)}`;
const LEGACY = 'https://example.com/legacy-demo';

// [name, workoutExercise, libraryExercise, expected DemoDTO|null]
const RESOLVE = [
  ['inherit follows the library (YouTube)', { video_link_mode: 'inherit', video_url: null }, { video_url: LIB_A },
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${'A'.repeat(11)}`, video_id: 'A'.repeat(11), source: 'library', current_guide: true }],
  ['inherit after a library replacement shows the replacement', { video_link_mode: 'inherit', video_url: null }, { video_url: LIB_B },
    { kind: 'youtube', url: LIB_B, video_id: 'B'.repeat(11), source: 'library', current_guide: true }],
  ['inherit ignores a stray row URL', { video_link_mode: 'inherit', video_url: OVERRIDE }, { video_url: LIB_A },
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${'A'.repeat(11)}`, video_id: 'A'.repeat(11), source: 'library', current_guide: true }],
  ['inherit with no library demo has no demo', { video_link_mode: 'inherit', video_url: null }, { video_url: null }, null],
  ['inherit with a removed library row has no demo', { video_link_mode: 'inherit', video_url: null }, null, null],
  ['override wins over the library', { video_link_mode: 'override', video_url: OVERRIDE }, { video_url: LIB_A },
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${'C'.repeat(11)}`, video_id: 'C'.repeat(11), source: 'override', current_guide: true }],
  ['override on a custom exercise', { video_link_mode: 'override', video_url: LEGACY }, null,
    { kind: 'external', url: LEGACY, source: 'override', current_guide: true }],
  ['override never falls back to the library', { video_link_mode: 'override', video_url: 'javascript:alert(1)' }, { video_url: LIB_A }, null],
  ['legacy nonempty safe link keeps old precedence', { video_link_mode: null, video_url: LEGACY }, { video_url: LIB_A },
    { kind: 'external', url: LEGACY, source: 'legacy', current_guide: true }],
  ['legacy (mode absent) nonempty link keeps old precedence', { video_url: LEGACY }, { video_url: LIB_A },
    { kind: 'external', url: LEGACY, source: 'legacy', current_guide: true }],
  ['legacy empty link falls back to the library', { video_link_mode: null, video_url: '' }, { video_url: LIB_A },
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${'A'.repeat(11)}`, video_id: 'A'.repeat(11), source: 'library', current_guide: true }],
  ['legacy unsafe link is never rendered and falls back', { video_link_mode: null, video_url: 'javascript:alert(1)' }, { video_url: LEGACY },
    { kind: 'external', url: LEGACY, source: 'library', current_guide: true }],
  ['legacy credential link is never rendered', { video_link_mode: null, video_url: 'https://user:pw@example.com/x' }, null, null],
  ['plain HTTP YouTube stays external-only', { video_link_mode: 'override', video_url: `http://youtu.be/${ID}` }, null,
    { kind: 'external', url: `http://youtu.be/${ID}`, source: 'override', current_guide: true }],
  ['a missing workout row resolves the library', null, { video_url: LEGACY },
    { kind: 'external', url: LEGACY, source: 'library', current_guide: true }],
  ['nothing anywhere', { video_link_mode: null, video_url: null }, { video_url: null }, null],
];

for (const [label, load] of [['backend', async () => backend], ['frontend', loadFrontend]]) {
  test(`${label}: resolveExerciseDemo applies inherit/override/legacy precedence`, async () => {
    const { resolveExerciseDemo } = await load();
    for (const [name, workoutExercise, libraryExercise, expected] of RESOLVE) {
      assert.deepEqual(resolveExerciseDemo({ workoutExercise, libraryExercise }), expected, name);
    }
  });

  test(`${label}: DemoDTO carries only the allowlisted keys and never trusts supplied kind/id`, async () => {
    const { resolveExerciseDemo } = await load();
    const demo = resolveExerciseDemo({
      workoutExercise: { video_link_mode: 'override', video_url: LEGACY, kind: 'youtube', video_id: ID, rights_note: 'secret', storage_key: 'sources/x' },
      libraryExercise: { video_url: LIB_A, notes: 'coach only' },
    });
    assert.deepEqual(Object.keys(demo).sort(), ['current_guide', 'kind', 'source', 'url']);
    assert.equal(demo.kind, 'external');
  });
}

test('backend and frontend copies agree on every shared vector', async () => {
  const frontend = await loadFrontend();
  for (const input of [...ACCEPTED.map(([value]) => value), ...REJECTED]) {
    assert.deepEqual(frontend.parseYouTubeDemo(input), backend.parseYouTubeDemo(input), JSON.stringify(input));
  }
  for (const [name, workoutExercise, libraryExercise] of RESOLVE) {
    assert.deepEqual(frontend.resolveExerciseDemo({ workoutExercise, libraryExercise }), backend.resolveExerciseDemo({ workoutExercise, libraryExercise }), name);
  }
  assert.equal(frontend.YOUTUBE_EMBED_ORIGIN, 'https://www.youtube-nocookie.com');
});

test('resolvedVideoUrl keeps the backward-compatible safe string for the same choice (both copies)', async () => {
  const frontend = await loadFrontend();
  const cases = [
    [{ video_link_mode: 'inherit', video_url: null }, { video_url: LIB_A }, LIB_A],
    [{ video_link_mode: 'override', video_url: ` ${OVERRIDE} ` }, { video_url: LIB_A }, OVERRIDE],
    [{ video_link_mode: null, video_url: LEGACY }, { video_url: LIB_A }, LEGACY],
    [{ video_link_mode: null, video_url: 'javascript:alert(1)' }, { video_url: null }, null],
    [null, { video_url: 'http://example.com/library-2' }, 'http://example.com/library-2'],
  ];
  for (const [workoutExercise, libraryExercise, expected] of cases) {
    assert.equal(backend.resolvedVideoUrl({ workoutExercise, libraryExercise }), expected);
    assert.equal(frontend.resolvedVideoUrl({ workoutExercise, libraryExercise }), expected);
  }
});
