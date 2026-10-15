#!/usr/bin/env node
// LOCAL exercise media worker (concurrency 1). Started by the owned launcher
// (backend/integration/exercise-media-local.cjs) with loopback-only env; never
// loads .env and refuses to run without the local adapter configuration.
const { mediaConfig } = require('../src/lib/exerciseMedia/config');

const config = mediaConfig();
if (!config.enabled) {
  console.error('exercise media worker: EXERCISE_MEDIA_STORE=local and an absolute EXERCISE_MEDIA_ROOT are required (local only)');
  process.exit(2);
}
const supabaseUrl = new URL(process.env.SUPABASE_URL || 'http://invalid');
if (supabaseUrl.hostname !== '127.0.0.1') {
  console.error('exercise media worker: refusing a non-loopback SUPABASE_URL');
  process.exit(2);
}

const { supabaseAdmin } = require('../src/supabase');
const { createRepository } = require('../src/lib/exerciseMedia/repository');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { FfmpegMediaProcessor, DockerToolRunner, PROCESSOR_IMAGE } = require('../src/services/exerciseMedia/ffmpegProcessor');
const { MediaWorker } = require('../src/services/exerciseMedia/worker');

const worker = new MediaWorker({
  repo: createRepository(supabaseAdmin),
  store: new LocalMediaStore({ root: config.root }),
  processor: new FfmpegMediaProcessor({ runner: new DockerToolRunner({ image: config.processorImage || PROCESSOR_IMAGE }) }),
  label: process.env.EXERCISE_MEDIA_WORKER_LABEL || `local-${process.pid}`,
  leaseSeconds: Number(process.env.EXERCISE_MEDIA_LEASE_SECONDS) || 120,
  pollMs: Number(process.env.EXERCISE_MEDIA_POLL_MS) || 1000,
  // Metadata and timings only: never paths, bytes, text or identities.
  log: (event, fields) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields })),
});

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());

(async () => {
  const recovered = await worker.recover();
  console.log(JSON.stringify({ at: new Date().toISOString(), event: 'worker ready', ...recovered }));
  await worker.loop({ signal: controller.signal });
  console.log(JSON.stringify({ at: new Date().toISOString(), event: 'worker stopped' }));
})().catch((error) => {
  console.error('exercise media worker failed', { code: error?.code || 'unknown' });
  process.exitCode = 1;
});
