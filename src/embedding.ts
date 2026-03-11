/**
 * src/embedding.ts
 * Local embedding generation using @xenova/transformers (all-MiniLM-L6-v2, 384 dims)
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMS = 384;

// Cache the Promise (not the resolved instance) to prevent concurrent init on parallel calls
let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!_pipelinePromise) {
    _pipelinePromise = pipeline('feature-extraction', MODEL) as Promise<FeatureExtractionPipeline>;
  }
  return _pipelinePromise;
}

/**
 * Generates a normalized 384-dim float32 embedding for the given text.
 * Lazy-loads the ONNX model on first call (may take a few seconds).
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // output.data is typically a Float32Array; avoid creating an unnecessary copy when possible
  return output.data instanceof Float32Array
    ? output.data
    : new Float32Array(output.data as unknown as ArrayLike<number>);
}

/**
 * Releases the pipeline. Useful in tests to reset module state between runs.
 */
export function resetPipeline(): void {
  _pipelinePromise = null;
}
