/**
 * src/__tests__/unit/embedding.test.ts
 * Unit tests for the embedding module (mocked pipeline)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

import { pipeline } from '@xenova/transformers';
import { embed, resetPipeline, EMBEDDING_DIMS } from '../../embedding';

function makeMockOutput(values: number[]): object {
  return { data: new Float32Array(values) };
}

describe('embedding module', () => {
  const mockPipeline = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetPipeline();
    vi.mocked(pipeline).mockResolvedValue(mockPipeline as any);
  });

  it('should return a Float32Array of EMBEDDING_DIMS length', async () => {
    mockPipeline.mockResolvedValue(makeMockOutput(new Array(EMBEDDING_DIMS).fill(0.5)));

    const result = await embed('hello world');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(EMBEDDING_DIMS);
  });

  it('should call the pipeline with mean pooling and normalization', async () => {
    mockPipeline.mockResolvedValue(makeMockOutput(new Array(EMBEDDING_DIMS).fill(0.1)));

    await embed('some text');

    expect(mockPipeline).toHaveBeenCalledWith('some text', { pooling: 'mean', normalize: true });
  });

  it('should lazy-load the pipeline only once across multiple calls', async () => {
    mockPipeline.mockResolvedValue(makeMockOutput(new Array(EMBEDDING_DIMS).fill(0.2)));

    await embed('first call');
    await embed('second call');

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('should reload the pipeline after resetPipeline()', async () => {
    mockPipeline.mockResolvedValue(makeMockOutput(new Array(EMBEDDING_DIMS).fill(0.3)));

    await embed('before reset');
    resetPipeline();
    await embed('after reset');

    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
