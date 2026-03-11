/**
 * src/__tests__/unit/database.test.ts
 * Unit tests for MemoryDatabase CRUD operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../../database';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(import.meta.url.replace('file://', ''), '..', '..', '..', 'test.sqlite');

describe('MemoryDatabase - CRUD Operations', () => {
  let db: MemoryDatabase;
  const testProjectId = 'test-project-' + randomUUID();

  beforeEach(() => {
    // Clean up test db if exists
    const dbPath = '/tmp/memory-test.sqlite';
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    db = new MemoryDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    const dbPath = '/tmp/memory-test.sqlite';
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  describe('PROJECT operations', () => {
    it('should create a project', () => {
      const project = db.createProject({
        id: testProjectId,
        name: 'Test Project',
        root_path: '/home/user/project',
        config: { language: 'ts', framework: 'fastify' },
      });

      expect(project).toBeDefined();
      expect(project.id).toBe(testProjectId);
      expect(project.name).toBe('Test Project');
      expect(project.created_at).toBeInstanceOf(Date);
    });

    it('should retrieve a project by id', () => {
      db.createProject({
        id: testProjectId,
        name: 'Test Project',
        root_path: '/home/user/project',
      });

      const retrieved = db.getProject(testProjectId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(testProjectId);
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should return null for non-existent project', () => {
      const retrieved = db.getProject('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should list all projects', () => {
      const proj1Id = 'project-1-' + randomUUID();
      const proj2Id = 'project-2-' + randomUUID();

      db.createProject({ id: proj1Id, name: 'Project 1', root_path: '/path1' });
      db.createProject({ id: proj2Id, name: 'Project 2', root_path: '/path2' });

      const projects = db.listProjects();

      expect(projects.length).toBeGreaterThanOrEqual(2);
      expect(projects.some((p) => p.id === proj1Id)).toBe(true);
      expect(projects.some((p) => p.id === proj2Id)).toBe(true);
    });
  });

  describe('MEMORY operations', () => {
    beforeEach(() => {
      // Create test project
      db.createProject({
        id: testProjectId,
        name: 'Test Project',
        root_path: '/test/path',
      });
    });

    it('should create a memory', () => {
      const embedding = new Float32Array(384).fill(0.1);

      const memory = db.createMemory(
        {
          projectId: testProjectId,
          key: 'pattern:error-handling:typed',
          content: 'Error handling pattern with typed errors',
          summary: 'Use typed custom errors',
          category: 'pattern',
          workspace: 'ms-orders',
          tags: ['tdd', 'testing'],
        },
        embedding
      );

      expect(memory).toBeDefined();
      expect(memory.key).toBe('pattern:error-handling:typed');
      expect(memory.category).toBe('pattern');
      expect(memory.status).toBe('active');
      expect(memory.version).toBe(1);
    });

    it('should retrieve a memory', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'test:pattern:001',
          content: 'Test content',
          category: 'pattern',
        },
        embedding
      );

      const retrieved = db.getMemory('test:pattern:001', testProjectId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('test:pattern:001');
      expect(retrieved?.content).toBe('Test content');
    });

    it('should return null for non-existent memory', () => {
      const retrieved = db.getMemory('non-existent', testProjectId);
      expect(retrieved).toBeNull();
    });

    it('should update a memory', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'test:pattern:update',
          content: 'Original content',
          category: 'pattern',
        },
        embedding
      );

      const updated = db.updateMemory('test:pattern:update', testProjectId, {
        content: 'Updated content',
        summary: 'New summary',
        status: 'active',
      });

      expect(updated).toBeDefined();
      expect(updated?.content).toBe('Updated content');
      expect(updated?.summary).toBe('New summary');
      expect(updated?.version).toBe(2);
    });

    it('should list memories by project', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'pattern:001',
          content: 'Pattern 1',
          category: 'pattern',
        },
        embedding
      );

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'decision:001',
          content: 'Decision 1',
          category: 'decision',
        },
        embedding
      );

      const memories = db.listMemoriesByProject(testProjectId);

      expect(memories.length).toBeGreaterThanOrEqual(2);
      expect(memories.some((m) => m.key === 'pattern:001')).toBe(true);
      expect(memories.some((m) => m.key === 'decision:001')).toBe(true);
    });

    it('should filter memories by category', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'pattern:001',
          content: 'Pattern 1',
          category: 'pattern',
        },
        embedding
      );

      db.createMemory(
        {
          projectId: testProjectId,
          key: 'decision:001',
          content: 'Decision 1',
          category: 'decision',
        },
        embedding
      );

      const patterns = db.listMemoriesByProject(testProjectId, { category: 'pattern' });

      expect(patterns.length).toBe(1);
      expect(patterns[0].key).toBe('pattern:001');
    });

    it('should filter memories by status', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory({ projectId: testProjectId, key: 'pattern:active', content: 'Active', category: 'pattern' }, embedding);
      db.updateMemory('pattern:active', testProjectId, { status: 'archived' });

      const active = db.listMemoriesByProject(testProjectId, { status: 'active' });
      const archived = db.listMemoriesByProject(testProjectId, { status: 'archived' });

      expect(active.every((m) => m.status === 'active')).toBe(true);
      expect(archived.some((m) => m.key === 'pattern:active')).toBe(true);
    });

    it('should filter memories by workspace', () => {
      const embedding = new Float32Array(384).fill(0.1);

      db.createMemory({ projectId: testProjectId, key: 'p:ws1', content: 'C1', category: 'pattern', workspace: 'ms-orders' }, embedding);
      db.createMemory({ projectId: testProjectId, key: 'p:ws2', content: 'C2', category: 'pattern', workspace: 'frontend' }, embedding);

      const result = db.listMemoriesByProject(testProjectId, { workspace: 'ms-orders' });

      expect(result.length).toBe(1);
      expect(result[0].workspace).toBe('ms-orders');
    });

    it('should respect limit and offset', () => {
      const embedding = new Float32Array(384).fill(0.1);

      for (let i = 0; i < 5; i++) {
        db.createMemory({ projectId: testProjectId, key: `pattern:page:${i}`, content: `C${i}`, category: 'pattern' }, embedding);
      }

      const page1 = db.listMemoriesByProject(testProjectId, { limit: 2, offset: 0 });
      const page2 = db.listMemoriesByProject(testProjectId, { limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].key).not.toBe(page2[0].key);
    });

    it('should return existing memory unchanged when update has no fields', () => {
      const embedding = new Float32Array(384).fill(0.1);
      db.createMemory({ projectId: testProjectId, key: 'pattern:noop', content: 'Original', category: 'pattern' }, embedding);

      const result = db.updateMemory('pattern:noop', testProjectId, {});

      expect(result?.content).toBe('Original');
    });

    it('should update memory with new embedding', () => {
      const embedding = new Float32Array(384).fill(0.1);
      db.createMemory({ projectId: testProjectId, key: 'pattern:embed', content: 'Original', category: 'pattern' }, embedding);

      const newEmbedding = new Float32Array(384).fill(0.9);
      const updated = db.updateMemory('pattern:embed', testProjectId, { content: 'Updated' }, newEmbedding);

      expect(updated?.content).toBe('Updated');
      expect(updated?.version).toBe(2);
    });
  });

  describe('DOCUMENT operations', () => {
    beforeEach(() => {
      db.createProject({
        id: testProjectId,
        name: 'Test Project',
        root_path: '/test/path',
      });
    });

    it('should create a document', () => {
      const doc = db.createDocument(
        testProjectId,
        'patterns/error-handling.md',
        '# Error Handling',
        'hash123'
      );

      expect(doc).toBeDefined();
      expect(doc.path).toBe('patterns/error-handling.md');
      expect(doc.indexed).toBe(false);
    });

    it('should retrieve a document', () => {
      db.createDocument(
        testProjectId,
        'patterns/test.md',
        '# Test',
        'hash123'
      );

      const retrieved = db.getDocument(testProjectId, 'patterns/test.md');

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('# Test');
    });

    it('should return null for non-existent document', () => {
      const result = db.getDocument(testProjectId, 'non-existent.md');
      expect(result).toBeNull();
    });

    it('should list documents by project', () => {
      db.createDocument(testProjectId, 'patterns/001.md', 'Content 1', 'hash1');
      db.createDocument(testProjectId, 'decisions/001.md', 'Content 2', 'hash2');

      const docs = db.listDocumentsByProject(testProjectId);

      expect(docs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('SEMANTIC SEARCH operations', () => {
    beforeEach(() => {
      db.createProject({ id: testProjectId, name: 'Test Project', root_path: '/test/path' });
    });

    /** Generates a deterministic unit vector of 384 floats where all values equal `v`. */
    function makeEmbedding(v: number): Float32Array {
      return new Float32Array(384).fill(v);
    }

    it('should return results ordered by similarity (closest first)', () => {
      // Orthogonal unit vectors: query points along dim-0, sem:a is parallel, sem:b is orthogonal
      const queryEmbedding = new Float32Array(384).fill(0);
      queryEmbedding[0] = 1.0;

      const closeEmbedding = new Float32Array(384).fill(0);
      closeEmbedding[0] = 1.0; // same direction as query → high similarity

      const farEmbedding = new Float32Array(384).fill(0);
      farEmbedding[1] = 1.0; // orthogonal to query → low similarity

      db.createMemory({ projectId: testProjectId, key: 'sem:a', content: 'A', category: 'pattern' }, closeEmbedding);
      db.createMemory({ projectId: testProjectId, key: 'sem:b', content: 'B', category: 'pattern' }, farEmbedding);

      const results = db.searchSemantic(queryEmbedding, { limit: 5 });

      expect(results.length).toBe(2);
      expect(results[0].memory.key).toBe('sem:a');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should return the correct score range (0 to 1)', () => {
      db.createMemory({ projectId: testProjectId, key: 'sem:c', content: 'C', category: 'pattern' }, makeEmbedding(0.5));
      const results = db.searchSemantic(makeEmbedding(0.5));
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });

    it('should filter by projectId', () => {
      const otherProjectId = 'other-project-' + randomUUID();
      db.createProject({ id: otherProjectId, name: 'Other', root_path: '/other' });

      db.createMemory({ projectId: testProjectId, key: 'sem:d', content: 'D', category: 'pattern' }, makeEmbedding(0.5));
      db.createMemory({ projectId: otherProjectId, key: 'sem:e', content: 'E', category: 'pattern' }, makeEmbedding(0.5));

      const results = db.searchSemantic(makeEmbedding(0.5), { projectId: testProjectId });

      expect(results.every((r) => r.memory.project_id === testProjectId)).toBe(true);
    });

    it('should filter by category', () => {
      db.createMemory({ projectId: testProjectId, key: 'sem:f', content: 'F', category: 'pattern' }, makeEmbedding(0.5));
      db.createMemory({ projectId: testProjectId, key: 'sem:g', content: 'G', category: 'decision' }, makeEmbedding(0.5));

      const results = db.searchSemantic(makeEmbedding(0.5), { category: 'decision' });

      expect(results.every((r) => r.memory.category === 'decision')).toBe(true);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        db.createMemory({ projectId: testProjectId, key: `sem:lim:${i}`, content: `${i}`, category: 'pattern' }, makeEmbedding(0.4));
      }
      const results = db.searchSemantic(makeEmbedding(0.4), { limit: 2 });
      expect(results.length).toBe(2);
    });

    it('should only return active memories by default', () => {
      db.createMemory({ projectId: testProjectId, key: 'sem:h', content: 'H', category: 'pattern' }, makeEmbedding(0.5));
      db.updateMemory('sem:h', testProjectId, { status: 'archived' });
      db.createMemory({ projectId: testProjectId, key: 'sem:i', content: 'I', category: 'pattern' }, makeEmbedding(0.5));

      const results = db.searchSemantic(makeEmbedding(0.5));

      expect(results.every((r) => r.memory.status === 'active')).toBe(true);
    });

    it('should search with explicit status filter', () => {
      db.createMemory({ projectId: testProjectId, key: 'sem:j', content: 'J', category: 'pattern' }, makeEmbedding(0.5));
      db.updateMemory('sem:j', testProjectId, { status: 'archived' });

      const results = db.searchSemantic(makeEmbedding(0.5), { status: 'archived' });

      expect(results.some((r) => r.memory.key === 'sem:j')).toBe(true);
    });
  });

  describe('MIGRATION edge cases', () => {
    it('should warn and skip when migration file is missing', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const dbPath = '/tmp/memory-test-missing-migration.sqlite';

      new MemoryDatabase(dbPath, '/non-existent/path');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Migration file not found'));
      consoleSpy.mockRestore();
      if (existsSync(dbPath)) unlinkSync(dbPath);
    });
  });
});
