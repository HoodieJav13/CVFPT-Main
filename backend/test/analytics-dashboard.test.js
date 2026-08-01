// Source assertions for the analytics dashboard. The behavioural checks
// live in the Playwright run (tiles, toggle, 390px, incomplete state); these
// pin the contract decisions that are easy to regress silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'frontend', 'src', 'pages', 'coach', 'Analytics.jsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'layout', 'AppShell.jsx'), 'utf8');
const appRoutes = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'frontend', 'src', 'lib', 'previewMode.js'), 'utf8');

test('incomplete coverage replaces the attention list, never footnotes it', () => {
  assert.match(page, /data\.coverage\?\.complete === false/);
  // The list is swapped for an explicit unavailable state...
  assert.match(page, /analytics-attention-unavailable/);
  assert.match(page, /Attention list unavailable/);
  // ...and the incomplete branch is checked BEFORE the rows can render, so
  // no row markup is reachable while coverage is partial.
  const attentionBlock = page.slice(page.indexOf('data-testid="analytics-attention"'));
  const incompleteAt = attentionBlock.indexOf('incomplete ?');
  const rowsAt = attentionBlock.indexOf('analytics-attention-row-');
  assert.ok(incompleteAt !== -1 && rowsAt !== -1 && incompleteAt < rowsAt,
    'the incomplete branch must be evaluated before attention rows');
  // A retry, not a dead end.
  assert.match(page, /analytics-incomplete-retry/);
});

test('fixed-window metrics are labelled with their own window', () => {
  // The toggle governs the tiles only; the check-in tile must say so in its
  // own label rather than inheriting the selected range.
  assert.match(page, /label="Check-ins · last 7 days"/);
  assert.match(page, /fixed windows, not the range above/);
  // Ranged tiles interpolate the selected range.
  assert.match(page, /label=\{`Sessions · \$\{rangeLabel\}`\}/);
  assert.match(page, /label=\{`Adherence · \$\{rangeLabel\}`\}/);
});

test('deltas read from previous and flip direction for cancellations', () => {
  assert.match(page, /data\.previous\?\.sessions\?\.completed/);
  assert.match(page, /data\.previous\?\.adherence\?\.rate/);
  // More cancellations is bad even though the number rose, so the
  // cancellation tile inverts what counts as good.
  assert.match(page, /previous=\{data\.previous\?\.sessions\?\.cancellation_rate\}\s*\n\s*invert/);
  assert.match(page, /no prior period/);
});

test('coach-owned triggers are marked as ours', () => {
  assert.match(page, /const COACH_OWNED = new Set\(\['unanswered_message', 'pending_request'\]\)/);
  assert.match(page, /\(on us\)/);
  // Every row names its own trigger.
  assert.match(page, /analytics-reason-\$\{reason\.code\}|reason\.label/);
});

test('the page is wired into routing and the coach sidebar only', () => {
  assert.match(appRoutes, /path="analytics" element=\{<CoachAnalytics \/>\}/);
  assert.match(shell, /\{ to: '\/coach\/analytics', label: 'Analytics', icon: BarChart3 \}/);
  // Analytics is a periodic review surface, not a daily tab: it must not
  // join the six-slot mobile tab row, which renders from COACH_NAV.
  const navStart = shell.indexOf('const COACH_NAV = [');
  const navBlock = shell.slice(navStart, shell.indexOf('];', navStart));
  assert.ok(navStart !== -1, 'COACH_NAV found');
  assert.doesNotMatch(navBlock, /analytics/i);
  assert.equal((navBlock.match(/\{ to:/g) || []).length, 6, 'mobile tab row stays at six slots');
  assert.match(shell, /sidebarNav[\s\S]{0,160}COACH_EXTRA/);
});

test('stale responses cannot win: only the newest request writes state', () => {
  // Rapid range switching issues overlapping requests; without a guard the
  // slowest (oldest) response arrives last and sits under the newest label.
  assert.match(page, /const requestSeq = useRef\(0\)/);
  assert.match(page, /const seq = requestSeq\.current \+ 1/);
  assert.match(page, /if \(seq !== requestSeq\.current\) return/);
  // The guard covers the error path too — a stale failure must not clobber
  // a fresh success.
  const catchBlock = page.slice(page.indexOf('} catch (error) {'), page.indexOf('}, [rangeKey, attempt])'));
  assert.match(catchBlock, /seq !== requestSeq\.current/);
});

test('mobile can reach analytics through the account menu', () => {
  assert.match(shell, /menu-analytics-link/);
  // Gated to coaches: the item renders in the !isClient branch.
  const menuAt = shell.indexOf('menu-analytics-link');
  const gateAt = shell.lastIndexOf('{!isClient && (', menuAt);
  assert.ok(gateAt !== -1 && menuAt - gateAt < 600, 'analytics menu item sits inside the coach-only branch');
});

test('preview toolbar exposes the incomplete-analytics lever visibly', () => {
  const toolbar = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'PreviewToolbar.jsx'), 'utf8');
  assert.match(toolbar, /preview-incomplete-analytics-checkbox/);
  assert.match(toolbar, /cvf_preview_incomplete_analytics/);
  // The lever hard-loads the page so the flag applies immediately even when
  // already viewing analytics.
  assert.match(toolbar, /window\.location\.assign\('\/coach\/analytics'\)/);
  assert.match(toolbar, /\['Analytics', '\/coach\/analytics'\]/);
});

test('delta and empty copy are honest', () => {
  // A rate delta is a difference of percentages: percentage points, not %.
  assert.match(page, /percentage points/);
  // The empty list claims only what was measured.
  assert.match(page, /No clients currently meet an attention threshold\./);
  assert.doesNotMatch(page, /Every client has trained/);
});

test('preview mode mirrors the response shape the page branches on', () => {
  assert.match(preview, /path === '\/analytics\/coach'/);
  assert.match(preview, /from and to date-times are required/);
  assert.match(preview, /previous: \{/);
  assert.match(preview, /coverage: \{ complete:/);
  // The failure state must be reachable for review rather than theoretical.
  assert.match(preview, /cvf_preview_incomplete_analytics/);
});
