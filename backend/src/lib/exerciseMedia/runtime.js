// Lazily wires the real exercise-media runtime (store, processor, signer,
// repository, service) from configuration. Returns null while the feature is
// disabled, so callers make no media I/O at all.
let runtime;

// Pure wiring (testable): photos mode uses the in-process image-only processor
// (no FFmpeg, Docker or worker); full mode keeps the accepted FFmpeg pipeline.
// The upload-grant secret reuses the link secret under a separate MAC domain.
function buildRuntime(config, { db, processorAvailable: available = null } = {}) {
  if (!config.enabled) return null;
  const { createRepository } = require('./repository');
  const { createExerciseMediaService } = require('./service');
  const { LocalMediaStore } = require('../../services/exerciseMedia/localStore');
  const { createCapabilitySigner } = require('../../services/exerciseMedia/capabilities');
  const { SupabaseImageStore, supabaseObjectClient } = require('../../services/exerciseMedia/supabaseImageStore');
  const store = config.store === 'supabase'
    ? new SupabaseImageStore({ client: supabaseObjectClient(db, config.bucket) })
    : new LocalMediaStore({ root: config.root, grantSecret: config.linkSecret });
  let processor;
  let processorAvailable;
  if (config.mode === 'photos') {
    const { ImageOnlyProcessor } = require('../../services/exerciseMedia/imageProcessor');
    processor = new ImageOnlyProcessor();
    processorAvailable = available || (() => ({ ok: true }));
  } else {
    const ffmpeg = require('../../services/exerciseMedia/ffmpegProcessor');
    processor = new ffmpeg.FfmpegMediaProcessor({ runner: new ffmpeg.DockerToolRunner({ image: config.processorImage || ffmpeg.PROCESSOR_IMAGE }) });
    processorAvailable = available || ffmpeg.processorAvailable;
  }
  const repo = createRepository(db);
  const service = createExerciseMediaService({
    repo, store, processor, signer: createCapabilitySigner({ secret: config.linkSecret }), processorAvailable, mode: config.mode, maxContentBytes: config.maxContentBytes,
  });
  return { service, store, repo, processor, mode: config.mode };
}

function defaultRuntime() {
  if (runtime !== undefined) return runtime;
  const { mediaConfig } = require('./config');
  const config = mediaConfig();
  if (!config.enabled) { runtime = null; return runtime; }
  const { supabaseAdmin } = require('../../supabase');
  runtime = buildRuntime(config, { db: supabaseAdmin });
  return runtime;
}

module.exports = { defaultRuntime, buildRuntime };
