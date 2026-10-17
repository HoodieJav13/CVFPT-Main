import { MEDIA_LIMITS } from './exerciseMedia.js';

// Crop-editor originals stay private. Direct uploads may be 10 MiB; each API
// response is <=1 MiB, below Vercel's 4.5 MB ceiling. HEAD and every range are
// independently reauthorized. No persistent cache, object URL or redirect.
export const SOURCE_CHUNK_BYTES = 1024 * 1024;
const failed = () => new Error('Source photo could not be loaded. Refresh and try again.');

export async function readSourceImage(url, { fetcher = fetch, signal } = {}) {
  const options = (extra = {}) => ({ cache: 'no-store', credentials: 'omit', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), ...extra });
  const head = await fetcher(url, options({ method: 'HEAD' }));
  const size = Number(head.headers.get('content-length'));
  const type = head.headers.get('content-type')?.split(';')[0];
  if (head.status !== 200 || !Number.isSafeInteger(size) || size < 1 || size > MEDIA_LIMITS.image.maxBytes || !MEDIA_LIMITS.image.mimes.includes(type)) throw failed();
  const parts = [];
  for (let start = 0; start < size; start += SOURCE_CHUNK_BYTES) {
    const end = Math.min(size - 1, start + SOURCE_CHUNK_BYTES - 1);
    const response = await fetcher(url, options({ headers: { Range: `bytes=${start}-${end}` } }));
    const expected = end - start + 1;
    if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}` || response.headers.get('content-type')?.split(';')[0] !== type || !response.body) {
      await response.body?.cancel(); throw failed();
    }
    const reader = response.body.getReader(); let count = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > expected) throw failed();
        parts.push(value);
      }
      if (count !== expected) throw failed();
    } finally { await reader.cancel().catch(() => {}); }
  }
  return new Blob(parts, { type });
}
