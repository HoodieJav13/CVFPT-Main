// Click-to-load YouTube demo helpers (docs/exercise-guides/design.md): a fixed
// privacy-enhanced embed origin, nothing derived from a tampered DTO, honest
// error copy, a player never smaller than 200x200, and one active player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoForRow, trustedDemo, youtubeEmbedUrl } from '../../src/lib/exerciseDemo.js';
import {
  IFRAME_API_URL, createActivePlayerGuard, playerErrorMessage, playerFrameSize,
} from '../../src/components/training/media/youtubePlayer.js';

const ID = 'AAAAAAAAAAA';

test('embed URLs use only the fixed privacy-enhanced origin and the app origin', () => {
  assert.equal(youtubeEmbedUrl(ID, { origin: 'https://app.example.invalid' }),
    `https://www.youtube-nocookie.com/embed/${ID}?playsinline=1&rel=0&cc_load_policy=1&enablejsapi=1&autoplay=1&origin=https%3A%2F%2Fapp.example.invalid`);
  // Only the origin of a full location is passed; no path, query or fragment.
  assert.match(youtubeEmbedUrl(ID, { origin: 'https://app.example.invalid/client/workouts/log-1/track?x=1#y' }), /origin=https%3A%2F%2Fapp\.example\.invalid$/);
  assert.equal(youtubeEmbedUrl(ID, { origin: 'javascript:alert(1)' }), `https://www.youtube-nocookie.com/embed/${ID}?playsinline=1&rel=0&cc_load_policy=1&enablejsapi=1&autoplay=1`);
  for (const bad of ['short', `${ID}x`, '../../evil', 'AAAAAAAAAA"', null, 42]) assert.equal(youtubeEmbedUrl(bad), null, String(bad));
  assert.equal(IFRAME_API_URL, 'https://www.youtube.com/iframe_api');
});

test('a server DemoDTO is re-derived from its URL: a tampered kind or id never becomes an embed', () => {
  assert.deepEqual(trustedDemo({ kind: 'youtube', url: `https://youtu.be/${ID}`, video_id: ID, source: 'library', current_guide: true }),
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${ID}`, video_id: ID, source: 'library', current_guide: true });
  assert.deepEqual(trustedDemo({ kind: 'youtube', url: 'https://example.com/clip', video_id: ID, source: 'override' }),
    { kind: 'external', url: 'https://example.com/clip', source: 'override', current_guide: true });
  assert.equal(trustedDemo({ kind: 'external', url: 'javascript:alert(1)', source: 'override' }), null);
  assert.equal(trustedDemo({ kind: 'youtube', url: `https://youtu.be/${ID}`, source: 'evil' }).source, 'library');
  assert.equal(trustedDemo(null), null);
});

test('rows from an older API without `demo` still resolve from the safe video_url', () => {
  assert.equal(demoForRow({ demo: { kind: 'external', url: 'https://example.com/a', source: 'override' }, video_url: `https://youtu.be/${ID}` }).kind, 'external');
  assert.deepEqual(demoForRow({ video_url: `https://youtu.be/${ID}` }), { kind: 'youtube', url: `https://www.youtube.com/watch?v=${ID}`, video_id: ID, source: 'legacy', current_guide: true });
  assert.equal(demoForRow({ video_url: 'javascript:alert(1)' }), null);
  assert.equal(demoForRow({}), null);
  // An older API that still sends the library row: the legacy precedence applies.
  assert.deepEqual(demoForRow({ video_url: null, library_exercise: { video_url: `https://youtu.be/${ID}` } }),
    { kind: 'youtube', url: `https://www.youtube.com/watch?v=${ID}`, video_id: ID, source: 'library', current_guide: true });
});

test('player errors explain the cause and always point to the external fallback', () => {
  assert.match(playerErrorMessage(100), /removed|private/i);
  for (const code of [101, 150]) assert.match(playerErrorMessage(code), /embed|play it here/i);
  assert.match(playerErrorMessage(153), /identif/i);
  assert.match(playerErrorMessage('api_unavailable'), /could not load/i);
  for (const code of [100, 101, 150, 153, 2, 5, 'api_unavailable', 'anything']) assert.match(playerErrorMessage(code), /YouTube/);
});

test('the player is never smaller than 200x200, even on a 320px phone', () => {
  for (const available of [180, 200, 240, 288, 320, 358, 600, 1200]) {
    const size = playerFrameSize(available);
    assert.ok(size.width >= 200 && size.height >= 200, `${available}: ${JSON.stringify(size)}`);
    assert.ok(size.width <= Math.max(200, available) || available < 200, `${available} fits`);
  }
  assert.deepEqual(playerFrameSize(288), { width: 288, height: 200 });
  assert.deepEqual(playerFrameSize(640), { width: 640, height: 360 });
  assert.deepEqual(playerFrameSize(1600), { width: 960, height: 540 });
});

test('only one guide plays at a time: activating a player tears down the previous one', () => {
  const guard = createActivePlayerGuard();
  const torn = [];
  const a = { destroy: () => torn.push('a') };
  const b = { destroy: () => torn.push('b') };
  guard.activate(a);
  guard.activate(b);
  assert.deepEqual(torn, ['a']);
  guard.release(a);
  assert.equal(guard.current(), b, 'releasing a stale player leaves the active one');
  guard.release(b);
  assert.equal(guard.current(), null);
  assert.deepEqual(torn, ['a', 'b']);
});
