// Synthetic-proof tooling only. Never imported by the app and never starts an SDK.
import { eligibleReplayProof, REPLAY_PROOF_POLICY } from './replayProofPolicy.js';

const LABELS = Object.freeze({ '/coach': 'Overview', '/coach/sessions': 'Sessions', '/coach/programs': 'Programs', '/coach/resources': 'Resources' });
const REDACTED = '[redacted]';
// Literal layout classes reviewed in AppShell. Unknown tokens are discarded, not copied.
const CLASSES = new Set(`light dark min-h-dvh app-noise top-glow fixed inset-x-0 top-0 h-64 pointer-events-none lg:grid lg:grid-cols-[250px_1fr] hidden lg:flex lg:flex-col lg:h-dvh lg:sticky lg:top-0 border-r border-border bg-card/40 px-4 py-6 z-10 flex items-center gap-2.5 px-2 font-display font-semibold leading-none mt-8 space-y-1 flex-1 gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors bg-primary/10 text-primary mb-1 min-h-11 w-full text-left rounded border bg-secondary px-1.5 py-0.5 text-[10px] mb-2 relative lg:hidden sticky z-40 justify-between border-b bg-background/80 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur gap-2 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 lg:px-8 lg:pb-10 lg:pt-8 max-w-5xl mx-auto bottom-0 left-0 right-0 z-50 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] supports-[backdrop-filter]:bg-background/70 grid grid-cols-6 h-16 flex-col justify-center gap-1 absolute -top-px h-[2px] w-10 rounded-full bg-primary ph-no-capture rr-block object-contain h-8 w-8 h-9 w-9 h-5 w-5 h-[18px] w-[18px] rounded-lg text-xs`.split(/\s+/));
const TAGS = new Set('html head body div aside nav main header footer a p span kbd button input select option textarea label section style title ul li'.split(' '));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number = (v, limit = 10000000) => Number.isFinite(v) && Math.abs(v) <= limit;
const id = (v) => Number.isInteger(v) && v >= -1 && v < 10000000;
const pickNumbers = (value, keys) => {
  const result = {};
  for (const key of keys) if (number(value?.[key])) result[key] = value[key];
  return result;
};
const text = (value) => typeof value === 'string' && !value.trim() ? '' : Object.values(LABELS).includes(value?.trim?.()) ? value.trim() : REDACTED;
const layoutClass = (value) => typeof value === 'string' ? value.split(/\s+/).filter((token) => CLASSES.has(token)).join(' ') : '';

export function proofReplayUrl(value, allowedOrigin) {
  try {
    const url = new URL(value, allowedOrigin);
    if (![allowedOrigin, 'https://cvfpt-synthetic.invalid'].includes(url.origin) || url.search || url.hash || !LABELS[url.pathname]) return null;
    return `https://cvfpt-synthetic.invalid${url.pathname}`;
  } catch { return null; }
}

function attributes(values, origin) {
  const safe = {};
  if (typeof values?.class === 'string') safe.class = layoutClass(values.class);
  if (values?.['aria-current'] === 'page') safe['aria-current'] = 'page';
  const href = proofReplayUrl(values?.href, origin);
  if (href && values?.href) safe.href = href;
  // rrweb's synthetic blocked-node geometry, not DOM attributes or inline styles.
  for (const key of ['rr_width', 'rr_height', 'rr_left', 'rr_top']) {
    if (typeof values?.[key] === 'string' && /^-?\d+(?:\.\d+)?px$/.test(values[key]) && Math.abs(parseFloat(values[key])) < 10000) safe[key] = values[key];
  }
  if (['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(values?.rr_position)) safe.rr_position = values.rr_position;
  return safe;
}

// Only exact reviewed, static stylesheets may enter a snapshot. Strip all resource
// URLs/imports/comments even from those sheets; replay never needs external assets.
export function proofStyleRegistry(reviewedStyles = []) {
  const result = new Map();
  for (const css of reviewedStyles) {
    if (typeof css !== 'string' || css.length > 1000000) throw Error('Invalid reviewed stylesheet');
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/gi, '').replace(/url\([^)]*\)/gi, 'none');
    if (/https?:|data:|file:|@import|url\(/i.test(clean)) throw Error('Unsupported stylesheet resource');
    result.set(css, clean);
  }
  return result;
}

function sanitizeNode(node, context, parentTag = '') {
  if (!node || !id(node.id) || ![0, 1, 2, 3].includes(node.type)) return null;
  const safe = { type: node.type, id: node.id };
  if (node.type === 1) return { ...safe, name: 'html', publicId: '', systemId: '' };
  if (node.type === 3) {
    context.tags.set(node.id, parentTag);
    if (parentTag === 'style') {
      const css = context.styles.get(node.textContent);
      return css === undefined ? null : { ...safe, textContent: css, isStyle: true };
    }
    return { ...safe, textContent: text(node.textContent) };
  }
  if (node.type === 2) {
    const blockedMedia = ['img', 'svg', 'canvas', 'video', 'audio', 'iframe'].includes(node.tagName) && !node.childNodes?.length && attributes(node.attributes, context.origin).rr_width && attributes(node.attributes, context.origin).rr_height;
    if (!TAGS.has(node.tagName) && !blockedMedia) return null;
    safe.tagName = blockedMedia ? 'div' : node.tagName;
    safe.attributes = attributes(node.attributes, context.origin);
    context.tags.set(node.id, node.tagName);
  }
  safe.childNodes = (Array.isArray(node.childNodes) ? node.childNodes : []).map((child) => sanitizeNode(child, context, node.tagName || '')).filter(Boolean);
  return safe;
}

function sanitizeEvent(event, context) {
  if (!event || !number(event.timestamp, 1e15)) return null;
  const base = { type: event.type, timestamp: event.timestamp };
  if ([0, 1].includes(event.type)) return { ...base, data: {} };
  if (event.type === 4) {
    const href = proofReplayUrl(event.data?.href, context.origin);
    if (!href || !number(event.data.width, 10000) || !number(event.data.height, 10000)) return null;
    return { ...base, data: { href, width: event.data.width, height: event.data.height } };
  }
  if (event.type === 2) {
    const node = sanitizeNode(event.data?.node, context);
    return node ? { ...base, data: { node, initialOffset: pickNumbers(event.data.initialOffset, ['left', 'top']) } } : null;
  }
  if (event.type === 5) {
    // Drop every SDK configuration/debug/custom record; retain only coarse navigation.
    if (event.data?.tag !== '$url_changed') return null;
    const href = proofReplayUrl(event.data.payload?.href, context.origin);
    return href ? { ...base, data: { tag: '$url_changed', payload: { href } } } : null;
  }
  if (event.type !== 3) return null; // No console, network, canvas, font or plugin records.
  const data = event.data;
  if (!data || !Number.isInteger(data.source)) return null;
  if (data.source === 0) {
    const texts = (Array.isArray(data.texts) ? data.texts : []).filter((item) => id(item.id)).map((item) => {
      if (context.tags.get(item.id) === 'style') {
        const css = context.styles.get(item.value);
        return css === undefined ? null : { id: item.id, value: css };
      }
      return { id: item.id, value: text(item.value) };
    }).filter(Boolean);
    const attrs = (Array.isArray(data.attributes) ? data.attributes : []).filter((item) => id(item.id)).map((item) => ({ id: item.id, attributes: attributes(item.attributes, context.origin) }));
    const removes = (Array.isArray(data.removes) ? data.removes : []).filter((item) => id(item.id) && id(item.parentId)).map((item) => ({ id: item.id, parentId: item.parentId }));
    const adds = (Array.isArray(data.adds) ? data.adds : []).filter((item) => id(item.parentId)).map((item) => {
      const node = sanitizeNode(item.node, context, context.tags.get(item.parentId));
      return node ? { parentId: item.parentId, ...pickNumbers(item, ['nextId', 'previousId']), node } : null;
    }).filter(Boolean);
    return { ...base, data: { source: 0, texts, attributes: attrs, removes, adds } };
  }
  if ([1, 6, 12].includes(data.source)) return { ...base, data: { source: data.source,
    positions: (Array.isArray(data.positions) ? data.positions : []).filter((p) => id(p.id) && number(p.x, 10000) && number(p.y, 10000) && number(p.timeOffset)).map((p) => ({ id: p.id, ...pickNumbers(p, ['x', 'y', 'timeOffset']) })) } };
  if ([2, 3].includes(data.source) && id(data.id)) return { ...base, data: { source: data.source, id: data.id, ...pickNumbers(data, data.source === 2 ? ['type', 'x', 'y', 'pointerType'] : ['x', 'y']) } };
  if (data.source === 4) return { ...base, data: { source: 4, ...pickNumbers(data, ['width', 'height']) } };
  return null; // In particular: inputs, selection, stylesheets and unknown extensions.
}

export function createReplayProofConfig({ gate, reviewedStyles = [], decodeCompressed, now = Date.now } = {}) {
  if (!eligibleReplayProof(gate || {}) || typeof decodeCompressed !== 'function') throw Error('Replay proof ineligible');
  const context = { origin: gate.allowedOrigin, styles: proofStyleRegistry(reviewedStyles), tags: new Map() };
  const startedAt = now();
  let stopped = false, bytes = 0, sessionId;
  const stop = () => { stopped = true; };
  const beforeSend = (event) => {
    try {
      if (stopped || now() - startedAt >= REPLAY_PROOF_POLICY.maxDurationMs || event?.event !== '$snapshot') return null;
      const props = event.properties;
      if (!UUID.test(props?.$session_id) || !UUID.test(props?.$window_id) || !/^phc_[A-Za-z0-9_]+$/.test(props?.token || '')) return null;
      if (sessionId && props.$session_id !== sessionId) { stop(); return null; }
      const events = decodeCompressed(props.$snapshot_data).map((item) => sanitizeEvent(item, context)).filter(Boolean);
      if (!events.length) return null;
      const dataBytes = new TextEncoder().encode(JSON.stringify(events)).byteLength;
      const clean = { event: '$snapshot', timestamp: new Date(event.timestamp).toISOString(), properties: {
        token: props.token, distinct_id: 'cvfpt-synthetic-preview', app: 'cvfpt', schema_version: 1,
        environment: 'synthetic_preview', $process_person_profile: false, $ip: null, $geoip_disable: true,
        $session_id: props.$session_id, $window_id: props.$window_id,
        $snapshot_data: events, $snapshot_bytes: dataBytes, $snapshot_host: 'cvfpt-synthetic.invalid',
        $lib: 'web', $lib_version: '1.436.1',
      } };
      const packetBytes = new TextEncoder().encode(JSON.stringify(clean)).byteLength;
      if (bytes + packetBytes >= REPLAY_PROOF_POLICY.maxBytes) { stop(); return null; }
      bytes += packetBytes; sessionId = props.$session_id;
      return clean;
    } catch { stop(); return null; }
  };
  return { stop, stats: () => ({ bytes, sessionId, stopped }), options: {
    ...REPLAY_PROOF_POLICY.options, disable_surveys: true, disable_product_tours: true, disable_conversations: true,
    save_referrer: false, save_campaign_params: false, before_send: beforeSend,
    session_recording: { ...REPLAY_PROOF_POLICY.options.session_recording,
      maskAllElementAttributes: false,
      maskAttributeFn: (name, value) => name === 'class' ? layoutClass(value)
        : ['rr_width', 'rr_height', 'rr_left', 'rr_top'].includes(name) && typeof value === 'string' && /^-?\d+(?:\.\d+)?px$/.test(value) && Math.abs(parseFloat(value)) < 10000 ? value : REDACTED,
      maskTextFn: (_value, element) => {
        if (typeof _value === 'string' && !_value.trim()) return '';
        const link = element?.closest?.('a[data-testid^="sidebar-nav-"], a[data-testid^="bottom-tab-"]');
        const url = proofReplayUrl(link?.getAttribute?.('href'), context.origin);
        return url ? LABELS[new URL(url).pathname] : REDACTED;
      },
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headMetaDescKeywords: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true },
      blockSelector: REPLAY_PROOF_POLICY.options.session_recording.blockSelector + ', input, select, textarea, [data-testid$="-count"], #cvf-preview-toolbar, #cvf-series-preview-hud',
      maskCapturedNetworkRequestFn: (request) => {
        if (!request || Object.keys(request).length !== 1 || typeof request.name !== 'string') return undefined;
        const name = proofReplayUrl(request.name, context.origin);
        return name ? { name } : undefined;
      },
    },
  } };
}
