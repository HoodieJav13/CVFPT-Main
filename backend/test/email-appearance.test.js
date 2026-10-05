const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Rendering is pure; prevent the email service import from constructing a
// database client. No provider is instantiated by these tests.
const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: {} } };
const { renderEmail } = require('../src/services/email');
const input = {
  headline: 'Your 2 sessions were cancelled',
  intro: 'These sessions are no longer on the calendar. Message your coach if you need other times.',
  facts: ['Tue, Jun 10, 5:00 PM', 'Tue, Jun 17, 5:00 PM', 'With Sam'],
  actionLabel: 'View sessions', actionUrl: 'https://app.example.invalid/client/sessions',
};

test('notification HTML uses the real app logo and readable live brand name', () => {
  const { html } = renderEmail(input);
  assert.match(html, /src="https:\/\/app\.example\.invalid\/logo\.png"/);
  assert.match(html, /width="88" height="88"/);
  assert.match(html, /Core Value/);
  assert.match(html, /Fitness/);
  assert.match(html, /PERSONAL TRAINING/);
  assert.doesNotMatch(html, /data:image|<script|@font-face/);
});

test('logo follows preview and production origins without copying action query data', () => {
  for (const origin of ['https://app.corevaluefit.com', 'https://cvf-preview.example.invalid', 'http://localhost:5173']) {
    const { html } = renderEmail({ ...input, actionUrl: `${origin}/reset-password?token=private-link-value` });
    assert.match(html, new RegExp(`src="${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/logo\\.png"`));
    assert.equal((html.match(/private-link-value/g) || []).length, 1, 'token belongs only in the action link');
  }
});

test('relative or malformed actions retain live branding without a broken logo request', () => {
  for (const actionUrl of ['/client/sessions', 'not a URL', 'mailto:hello@example.invalid']) {
    const { html, text } = renderEmail({ ...input, actionUrl });
    assert.match(html, /Core Value/);
    assert.doesNotMatch(html, /<img/);
    assert.ok(text.includes(`View sessions: ${actionUrl}`));
  }
});

test('email brand colors stay synchronized with app CSS tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../frontend/src/index.css'), 'utf8');
  const { html } = renderEmail(input);
  for (const name of ['primary', 'foreground', 'primary-foreground', 'card', 'border', 'muted-foreground']) {
    const match = css.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
    const [h, s, l] = match.slice(1).map(Number);
    const S = s / 100, L = l / 100, c = (1 - Math.abs(2 * L - 1)) * S;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = L - c / 2;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hex = '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    assert.ok(html.includes(hex), `email is missing current --${name} (${hex})`);
  }
});

test('HTML keeps exact facts, copy and both links while plain text remains unchanged', () => {
  const digest = { ...input, footer: 'Your existing footer.', footerUrl: 'https://app.example.invalid/client?email-settings=1', footerLabel: 'Email settings' };
  const { html, text } = renderEmail(digest);
  assert.equal(text, [digest.headline, digest.intro, ...digest.facts, `View sessions: ${digest.actionUrl}`, digest.footer, `Email settings: ${digest.footerUrl}`].join('\n\n'));
  for (const fact of digest.facts) assert.ok(html.includes(`>${fact}</li>`));
  assert.ok(html.includes(`href="${digest.actionUrl}"`));
  assert.ok(html.includes(`href="${digest.footerUrl}"`));
  assert.ok(html.includes('Your existing footer.'));
});

test('all inserted fields remain escaped, including footer links and labels', () => {
  const value = '<img src=x onerror=alert(1)> & "quote"';
  const { html } = renderEmail({ headline: value, intro: value, facts: [value], actionLabel: value, actionUrl: 'https://example.invalid/?x="&y=<bad>', footer: value, footerUrl: 'https://example.invalid/?x="&y=<bad>', footerLabel: value });
  assert.doesNotMatch(html, /<img src=x|<bad>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quote&quot;/);
  assert.match(html, /href="https:\/\/example\.invalid\/\?x=&quot;&amp;y=&lt;bad&gt;"/);
});

test('essential layout is inline and dark/mobile styles are progressive enhancements', () => {
  const { html } = renderEmail(input);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /role="presentation"/);
  assert.match(html, /bgcolor="#5EC4D4"/);
  assert.match(html, /color:#181511/);
  assert.match(html, /font-size:16px;line-height:24px/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /max-width:\s*420px/);
});

test('teal-backed action and live wordmark retain an explicit text fill against client color rewrites', () => {
  const { html } = renderEmail(input);
  const protectedText = html.match(/<(?:a|div)\b[^>]*style="[^"]*-webkit-text-fill-color:#181511[^>]*>/g) || [];
  assert.equal(protectedText.length, 3, 'protect only action, wordmark and subtitle, not adaptive body copy');
  for (const element of protectedText) assert.match(element, /(?:"|;)color:#181511;/);
});
