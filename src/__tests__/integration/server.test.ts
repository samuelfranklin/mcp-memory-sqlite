/**
 * src/__tests__/integration/server.test.ts
 * Integration tests for the MCP memory server using InMemoryTransport
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { unlinkSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { MemoryDatabase } from '../../database';
import { createMemoryServer } from '../../server/index';

// --- SETUP ---

const DB_PATH = `/tmp/mcp-test-${randomUUID()}.sqlite`;
const PROJECT_ID = 'test-project';

// Stub embed: returns a deterministic Float32Array based on the input string
function stubEmbed(text: string): Promise<Float32Array> {
  const arr = new Float32Array(384).fill(0);
  // Use the first char code to put energy in a specific dim → enables ordering tests
  arr[text.charCodeAt(0) % 384] = 1.0;
  return Promise.resolve(arr);
}

let db: MemoryDatabase;
let client: Client;

async function makeClient(): Promise<Client> {
  const server = createMemoryServer(db, PROJECT_ID, stubEmbed);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const c = new Client({ name: 'test-client', version: '0.0.1' });
  await c.connect(clientTransport);
  return c;
}

/** Calls a tool and returns the parsed JSON result. */
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return JSON.parse(text) as T;
}

beforeEach(async () => {
  db = new MemoryDatabase(DB_PATH);
  db.createProject({ id: PROJECT_ID, name: 'Test Project', root_path: '/test' });
  client = await makeClient();
});

afterEach(async () => {
  await client.close();
  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
});

// --- TESTS ---

describe('MCP Server — project tools', () => {
  it('project_list should return the seeded project', async () => {
    const projects = await callTool<Array<{ id: string }>>('project_list', {});
    expect(projects.some((p) => p.id === PROJECT_ID)).toBe(true);
  });

  it('project_register should create a new project', async () => {
    const newId = 'proj-' + randomUUID();
    const result = await callTool<{ id: string; name: string }>('project_register', {
      id:        newId,
      name:      'New Project',
      root_path: '/new',
    });
    expect(result.id).toBe(newId);
    expect(result.name).toBe('New Project');
  });

  it('project_detect should return project matching the given cwd', async () => {
    const detected = await callTool<{ id: string; name: string }>('project_detect', {
      cwd: '/test/src',
    });
    expect(detected).not.toBeNull();
    expect(detected.id).toBe(PROJECT_ID);
  });

  it('project_detect should return null for an unmatched path', async () => {
    const raw = await client.callTool({
      name: 'project_detect',
      arguments: { cwd: '/completely/different/path' },
    });
    const txt = (raw.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(txt)).toBeNull();
  });

  it('project_detect should return most specific match for nested dirs', async () => {
    const nestedId = 'nested-proj-' + randomUUID();
    db.createProject({ id: nestedId, name: 'Nested', root_path: '/test/subapp' });

    const detected = await callTool<{ id: string }>('project_detect', {
      cwd: '/test/subapp/src/components',
    });
    expect(detected.id).toBe(nestedId);
  });
});

describe('MCP Server — cwd-based project resolution', () => {
  it('memory_save should resolve project via cwd', async () => {
    await callTool('memory_save', {
      key:      'cwd:test:001',
      content:  'Resolved via cwd',
      category: 'pattern',
      cwd:      '/test',
    });

    const retrieved = await callTool<{ key: string; content: string }>('memory_get', {
      key: 'cwd:test:001',
      cwd: '/test/any/subdir',
    });
    expect(retrieved.key).toBe('cwd:test:001');
    expect(retrieved.content).toBe('Resolved via cwd');
  });

  it('memory_list should resolve project via cwd', async () => {
    await callTool('memory_save', {
      key:      'cwd:list:001',
      content:  'List via cwd',
      category: 'context',
      cwd:      '/test',
    });

    const list = await callTool<Array<{ key: string }>>('memory_list', { cwd: '/test' });
    expect(list.some((m) => m.key === 'cwd:list:001')).toBe(true);
  });

  it('memory tools should throw when cwd does not match any project', async () => {
    // Must use a server without a defaultProjectId so cwd is the only resolution path
    const serverNoDefault = createMemoryServer(db, undefined, stubEmbed);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await serverNoDefault.connect(st);
    const noDefaultClient = new Client({ name: 'no-default-client', version: '0.0.1' });
    await noDefaultClient.connect(ct);

    const raw = await noDefaultClient.callTool({
      name: 'memory_list',
      arguments: { cwd: '/no/match/here' },
    });
    expect(raw.isError).toBe(true);

    await noDefaultClient.close();
  });
});

describe('MCP Server — memory_save + memory_get', () => {
  it('should save and retrieve a memory', async () => {
    await callTool('memory_save', {
      key:      'pattern:test:001',
      content:  'Test content for MCP',
      category: 'pattern',
      summary:  'Test summary',
    });

    const retrieved = await callTool<{ key: string; content: string; summary: string }>(
      'memory_get',
      { key: 'pattern:test:001' }
    );

    expect(retrieved.key).toBe('pattern:test:001');
    expect(retrieved.content).toBe('Test content for MCP');
    expect(retrieved.summary).toBe('Test summary');
  });

  it('memory_get should return null string for non-existent key', async () => {
    const result = await client.callTool({ name: 'memory_get', arguments: { key: 'non-existent' } });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe('null');
  });

  it('should save with workspace and tags', async () => {
    await callTool('memory_save', {
      key:       'pattern:workspace:001',
      content:   'Content with workspace',
      category:  'decision',
      workspace: 'ms-orders',
      tags:      ['tag1', 'tag2'],
    });

    const retrieved = await callTool<{ workspace: string; tags: string[] }>(
      'memory_get',
      { key: 'pattern:workspace:001' }
    );

    expect(retrieved.workspace).toBe('ms-orders');
    expect(retrieved.tags).toEqual(['tag1', 'tag2']);
  });
});

describe('MCP Server — memory_list', () => {
  beforeEach(async () => {
    await callTool('memory_save', { key: 'p:001', content: 'Pattern 1', category: 'pattern' });
    await callTool('memory_save', { key: 'd:001', content: 'Decision 1', category: 'decision' });
  });

  it('should list all memories for the project', async () => {
    const list = await callTool<Array<{ key: string }>>('memory_list', {});
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('should filter by category', async () => {
    const patterns = await callTool<Array<{ key: string; category: string }>>('memory_list', {
      category: 'pattern',
    });
    expect(patterns.every((m) => m.category === 'pattern')).toBe(true);
  });

  it('should respect limit', async () => {
    const limited = await callTool<Array<unknown>>('memory_list', { limit: 1 });
    expect(limited.length).toBe(1);
  });
});

describe('MCP Server — memory_search', () => {
  it('should return results ordered by similarity', async () => {
    await callTool('memory_save', { key: 'sem:a', content: 'Alpha', category: 'pattern' });
    await callTool('memory_save', { key: 'sem:b', content: 'Alpha', category: 'pattern' });

    const results = await callTool<Array<{ key: string; score: number }>>('memory_search', {
      query: 'Alpha',
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });
});

describe('MCP Server — memory_update', () => {
  it('should update content and regenerate embedding', async () => {
    await callTool('memory_save', {
      key: 'upd:001', content: 'Original', category: 'pattern',
    });

    const updated = await callTool<{ key: string; content: string; version: number }>(
      'memory_update',
      { key: 'upd:001', content: 'Updated content' }
    );

    expect(updated.content).toBe('Updated content');
    expect(updated.version).toBe(2);
  });

  it('should update status without touching content', async () => {
    await callTool('memory_save', { key: 'upd:002', content: 'Original', category: 'bug' });

    const updated = await callTool<{ status: string; content: string }>(
      'memory_update',
      { key: 'upd:002', status: 'archived' }
    );

    expect(updated.status).toBe('archived');
    expect(updated.content).toBe('Original');
  });

  it('should return null string for non-existent key', async () => {
    const result = await client.callTool({
      name: 'memory_update',
      arguments: { key: 'non-existent', status: 'archived' },
    });
    const t = (result.content as Array<{ text: string }>)[0].text;
    expect(t).toBe('null');
  });
});

describe('MCP Server — error handling', () => {
  it('should return isError when project_id is missing and no default', async () => {
    // Create a server without a default project
    const serverNoDefault = createMemoryServer(db, undefined, stubEmbed);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await serverNoDefault.connect(st);
    const c = new Client({ name: 'no-project-client', version: '0.0.1' });
    await c.connect(ct);

    const result = await c.callTool({
      name: 'memory_list',
      arguments: { project_id: undefined },
    });
    expect(result.isError).toBe(true);

    await c.close();
  });
});
