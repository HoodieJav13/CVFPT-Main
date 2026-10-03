// Local visual QA only; uses existing frontend Playwright and backend deps.
// No provider/database client, remote API, or live image request is allowed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { chromium } = require('../frontend/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const supabasePath = require.resolve('../backend/src/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: {} } };
const { renderEmail } = require('../backend/src/services/email');
const brand = require('../backend/src/lib/emailBrand');
const fixtureSource = fs.readFileSync(path.join(root, 'design-plans/email-branding/fixtures.json'), 'utf8');
const fixtures = JSON.parse(fixtureSource);
const out = process.env.EMAIL_RENDER_OUT || path.join(root, 'design-plans/email-branding/artifacts');
fs.mkdirSync(out, { recursive: true });
const baselineSha = '3886fef15db67b1177a0d4cf468fd8d654d42b3e';
const oldSource = execFileSync('git', ['show', `${baselineSha}:backend/src/services/email.js`], { cwd: root, encoding: 'utf8' });
const oldSandbox = { module: { exports: {} }, URL, require: name => name === '../lib/emailBrand' ? require('../backend/src/lib/emailBrand') : {}, process: { env: {} } };
vm.runInNewContext(oldSource, oldSandbox);
const baselineRender = oldSandbox.module.exports.renderEmail;
const logo = fs.readFileSync(path.join(root, 'backend/src/assets/cvf-logo.png'));
function luminance(rgb) {
  const values = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
function contrast(a, b) { const [low, high] = [luminance(rgb(a)), luminance(rgb(b))].sort((a, b) => a - b); return (high + 0.05) / (low + 0.05); }
// Model only the color rewrite reported in the received Yahoo desktop email.
// This is a regression fixture, not a Yahoo sanitizer or delivery simulation.
async function yahooColors(page) {
  await page.locator('.email-content').evaluate(el => {
    el.style.setProperty('background', '#2D261B', 'important');
    for (const text of [el, ...el.querySelectorAll('h1,p,li,a'), ...document.querySelectorAll('.email-masthead div,a.email-action')]) {
      text.style.setProperty('color', '#D5CDC3', 'important');
    }
  });
}
async function accentColors(page) {
  return page.locator('.email-masthead div,a.email-action').evaluateAll(els => els.map(el => {
    const style = getComputedStyle(el);
    return { text: el.textContent, color: style.color, fill: style.webkitTextFillColor, background: getComputedStyle(document.querySelector('.email-masthead')).backgroundColor };
  }));
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let blockedImages = false, externalRequests = 0;
    await context.route(/^https?:/, route => {
      if (route.request().url() === 'https://app.example.invalid/logo.png') return blockedImages ? route.abort() : route.fulfill({ body: logo, contentType: 'image/png' });
      externalRequests++;
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let layouts = 0, fallbackLayouts = 0, plainTextComparisons = 0, exactHtmlComparisons = 0, unsupportedFillLayouts = 0;
    const yahooRewrites = [];
    const screenshots = [];
    for (const [kind, input] of Object.entries(fixtures)) {
      const rendered = renderEmail(input);
      assert.equal(rendered.text, baselineRender(input).text);
      plainTextComparisons++;
      // Removing only the three approved inline color additions must recover
      // the complete released HTML, including all copy, links and layout.
      assert.equal(rendered.html.replace(/;-webkit-text-fill-color:#181511/g, '').replace(/<div style="color:#181511;/g, '<div style="'), baselineRender(input).html);
      exactHtmlComparisons++;
      fs.writeFileSync(path.join(out, `${kind}.html`), rendered.html);
      for (const mode of ['light', 'dark']) for (const width of [320, 390, 560, 900]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: mode });
        await page.setContent(rendered.html);
        await page.locator('img').evaluate(img => img.decode());
        const result = await page.evaluate(() => {
          const content = document.querySelector('.email-content'), copy = document.querySelector('.email-copy'), action = document.querySelector('a.email-action');
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            headline: document.querySelector('h1').textContent,
            facts: [...document.querySelectorAll('li')].map(el => el.textContent),
            actions: [...document.querySelectorAll('a')].map(el => ({ text: el.textContent, href: el.getAttribute('href') })),
            actionHeight: action.getBoundingClientRect().height,
            colors: { surface: getComputedStyle(content).backgroundColor, ink: getComputedStyle(content).color, copy: getComputedStyle(copy).color, actionFill: getComputedStyle(action).backgroundColor, actionInk: getComputedStyle(action).color },
          };
        });
        assert.equal(result.overflow, false, `${kind}/${mode}/${width} overflows`);
        assert.equal(result.headline, input.headline);
        assert.deepEqual(result.facts, input.facts || []);
        assert.deepEqual(result.actions[0], { text: input.actionLabel, href: input.actionUrl });
        if (input.footer && input.footerUrl) assert.deepEqual(result.actions[1], { text: input.footerLabel || 'Manage email settings', href: input.footerUrl });
        assert.ok(result.actionHeight >= 44);
        assert.ok(contrast(result.colors.surface, result.colors.ink) >= 4.5);
        assert.ok(contrast(result.colors.surface, result.colors.copy) >= 4.5);
        assert.ok(contrast(result.colors.actionFill, result.colors.actionInk) >= 4.5);
        for (const text of await accentColors(page)) assert.ok(contrast(text.fill, text.background) >= 4.5);
        const expectedSurface = mode === 'dark' ? brand.graphite : brand.paper;
        const actualSurface = '#' + rgb(result.colors.surface).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        assert.equal(actualSurface, expectedSurface);
        layouts++;
        if (['scheduled', 'cancelled'].includes(kind) && [390, 900].includes(width)) {
          const file = `${kind}-${width === 390 ? 'mobile' : 'desktop'}-${mode}.png`;
          await page.locator('body > table').screenshot({ path: path.join(out, file) });
          screenshots.push(file);
        }
      }
      for (const width of [320, 390, 560, 900]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: 'light' });
        await page.setContent(rendered.html.replace(/<style>[\s\S]*?<\/style>/, ''));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${kind}/${width} inline-only overflow`);
        assert.ok(await page.getByRole('link', { name: input.actionLabel, exact: true }).isVisible());
        fallbackLayouts++;
      }
      for (const mode of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: mode });
        await page.setContent(rendered.html.replace(/;-webkit-text-fill-color:[^;"}]+/g, ''));
        for (const text of await accentColors(page)) assert.ok(contrast(text.fill, text.background) >= 4.5, 'normal color fallback');
        unsupportedFillLayouts++;
      }
      for (const width of [320, 390, 560, 900]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.setContent(baselineRender(input).html);
        await yahooColors(page);
        const before = await accentColors(page);
        assert.ok(before.every(text => contrast(text.fill, text.background) < 4.5), 'baseline reproduces reported low contrast');
        await page.setContent(rendered.html);
        await yahooColors(page);
        const after = await accentColors(page);
        assert.ok(after.every(text => contrast(text.fill, text.background) >= 4.5), `${kind}/${width} Yahoo-rewrite contrast`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        yahooRewrites.push({ kind, width, before: before.map(text => contrast(text.fill, text.background)), after: after.map(text => contrast(text.fill, text.background)), effectiveFill: after.map(text => text.fill), rewrittenColor: after.map(text => text.color) });
        if (kind === 'cancelled' && width === 390) {
          await page.locator('body > table').screenshot({ path: path.join(out, 'cancelled-yahoo-rewrite-after.png') });
          await page.setContent(baselineRender(input).html);
          await yahooColors(page);
          await page.locator('body > table').screenshot({ path: path.join(out, 'cancelled-yahoo-rewrite-before.png') });
        }
      }
    }
    blockedImages = true;
    for (const mode of ['light', 'dark']) {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.emulateMedia({ colorScheme: mode });
      await page.setContent(renderEmail(fixtures.cancelled).html);
      assert.ok(await page.getByText('Core Value', { exact: false }).isVisible());
      assert.ok(await page.getByRole('link', { name: 'View sessions' }).isVisible());
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(externalRequests, 0);
    const result = { baselineSha, layouts, inlineOnlyLayouts: fallbackLayouts, unsupportedFillLayouts, plainTextComparisons, exactHtmlComparisons, blockedImageLayouts: 2, yahooRewrites, textAndButtonContrast: '>=4.5:1 in normal layouts and modeled Yahoo rewrite with text-fill retained', pageErrors: errors, externalRequests, screenshots, limitation: 'Chromium rendering and a modeled color-only rewrite from the Yahoo report; no actual mail-client retest or delivery. If a mail client strips/rewrites text-fill too, the reported issue can remain. Unmodified color fallback verified in light/dark.' };
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
