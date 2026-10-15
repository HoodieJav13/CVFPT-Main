// Lazily wires the real exercise-media runtime (store, processor, signer,
// repository, service) from configuration. Returns null while the feature is
// disabled, so callers make no media I/O at all.
let runtime;

function defaultRuntime() {
  if (runtime !== undefined) return runtime;
  const { mediaConfig } = require('./config');
  const config = mediaConfig();
  if (!config.enabled) { runtime = null; return runtime; }
  const { supabaseAdmin } = require('../../supabase');
  const { createRepository } = require('./repository');
  const { createExerciseMediaService } = require('./service');
  const { LocalMediaStore } = require('../../services/exerciseMedia/localStore');
  const { createCapabilitySigner } = require('../../services/exerciseMedia/capabilities');
  const { FfmpegMediaProcessor, DockerToolRunner, processorAvailable, PROCESSOR_IMAGE } = require('../../services/exerciseMedia/ffmpegProcessor');
  const store = new LocalMediaStore({ root: config.root });
  const processor = new FfmpegMediaProcessor({ runner: new DockerToolRunner({ image: config.processorImage || PROCESSOR_IMAGE }) });
  const repo = createRepository(supabaseAdmin);
  const service = createExerciseMediaService({ repo, store, processor, signer: createCapabilitySigner({ secret: config.linkSecret }), processorAvailable });
  runtime = { service, store, repo };
  return runtime;
}

module.exports = { defaultRuntime };
