/**
 * src/server/index.ts
 * MCP Memory Server — exposes CRUD + semantic search over stdio MCP protocol
 *
 * Usage:
 *   MEMORY_PROJECT_ID=my-project tsx src/server/index.ts
 *
 *   Or without a default project (pass project_id explicitly in each tool call):
 *   tsx src/server/index.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MemoryDatabase } from '../database.js';
import { embed as defaultEmbed } from '../embedding.js';
import type { MemoryCategory, MemoryStatus } from '../types.js';

// --- HELPERS ---

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

/** Strips the embedding blob before returning to the client. */
function memoryToJson(m: ReturnType<InstanceType<typeof MemoryDatabase>['getMemory']>) {
  if (!m) return null;
  const { embedding: _emb, ...rest } = m;
  return rest;
}

// --- FACTORY ---

/**
 * Creates and configures an McpServer with all memory tools.
 * Accepts an injected `embedFn` so tests can replace it without mocking the module.
 */
export function createMemoryServer(
  db: MemoryDatabase,
  defaultProjectId?: string,
  embedFn: (text: string) => Promise<Float32Array> = defaultEmbed
): McpServer {
  function projectId(explicit?: string): string {
    const id = explicit ?? defaultProjectId;
    if (!id) throw new Error('project_id is required (or set MEMORY_PROJECT_ID env var)');
    return id;
  }

  const server = new McpServer({ name: 'memory-mcp', version: '0.1.0' });

  // ── PROJECT: register ────────────────────────────────────────────────────────

  server.registerTool(
    'project_register',
    {
      description: 'Registers a new project in the memory database.',
      inputSchema: {
        id:        z.string().describe('Unique project identifier (e.g. "my-app", "backend")'),
        name:      z.string().describe('Human-readable project name'),
        root_path: z.string().describe('Absolute path to the project root'),
        config:    z.record(z.string(), z.unknown()).optional().describe('Optional project configuration'),
      },
    },
    (args) => {
      try {
        const project = db.createProject(args);
        return text(JSON.stringify(project, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── PROJECT: list ────────────────────────────────────────────────────────────

  server.registerTool(
    'project_list',
    { description: 'Lists all registered projects.' },
    () => {
      try {
        return text(JSON.stringify(db.listProjects(), null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── MEMORY: save ─────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_save',
    {
      description:
        'Saves a new memory entry with semantic embedding. ' +
        'Generates a vector from the content automatically.',
      inputSchema: {
        key:        z.string().describe('Unique key (e.g. "pattern:error-handling:typed")'),
        content:    z.string().describe('Full content of the memory (Markdown supported)'),
        category:   z.enum(['pattern', 'decision', 'bug', 'context', 'trick']).describe('Memory category'),
        project_id: z.string().optional().describe('Project ID (defaults to MEMORY_PROJECT_ID env var)'),
        summary:    z.string().optional().describe('Short 1-2 line summary'),
        workspace:  z.string().optional().describe('Sub-workspace within the project (e.g. "ms-orders")'),
        tags:       z.array(z.string()).optional().describe('Tags for filtering'),
      },
    },
    async (args) => {
      try {
        const pid = projectId(args.project_id);
        const embedding = await embedFn(args.content);
        const memory = db.createMemory(
          {
            projectId:  pid,
            key:        args.key,
            content:    args.content,
            category:   args.category as MemoryCategory,
            summary:    args.summary,
            workspace:  args.workspace,
            tags:       args.tags,
          },
          embedding
        );
        return text(JSON.stringify(memoryToJson(memory), null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── MEMORY: get ───────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_get',
    {
      description: 'Retrieves a specific memory by key.',
      inputSchema: {
        key:        z.string().describe('Memory key'),
        project_id: z.string().optional(),
      },
    },
    (args) => {
      try {
        const m = db.getMemory(args.key, projectId(args.project_id));
        if (!m) return text('null');
        return text(JSON.stringify(memoryToJson(m), null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── MEMORY: list ──────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_list',
    {
      description: 'Lists memories, optionally filtered by category, workspace, or status.',
      inputSchema: {
        project_id: z.string().optional(),
        category:   z.enum(['pattern', 'decision', 'bug', 'context', 'trick']).optional(),
        workspace:  z.string().optional(),
        status:     z.enum(['active', 'deprecated', 'archived']).optional(),
        limit:      z.number().int().positive().optional(),
        offset:     z.number().int().min(0).optional(),
      },
    },
    (args) => {
      try {
        const pid = projectId(args.project_id);
        const memories = db.listMemoriesByProject(pid, {
          category:  args.category as MemoryCategory | undefined,
          workspace: args.workspace,
          status:    args.status as MemoryStatus | undefined,
          limit:     args.limit,
          offset:    args.offset,
        });
        return text(JSON.stringify(memories.map(memoryToJson), null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── MEMORY: search (semantic) ─────────────────────────────────────────────────

  server.registerTool(
    'memory_search',
    {
      description:
        'Semantic search across memories using vector similarity. ' +
        'Returns the top-N most relevant memories with a similarity score (0–1).',
      inputSchema: {
        query:      z.string().describe('Natural language search query'),
        project_id: z.string().optional(),
        category:   z.enum(['pattern', 'decision', 'bug', 'context', 'trick']).optional(),
        workspace:  z.string().optional(),
        status:     z.enum(['active', 'deprecated', 'archived']).optional(),
        limit:      z.number().int().positive().max(50).optional().default(10),
      },
    },
    async (args) => {
      try {
        const embedding = await embedFn(args.query);
        const results = db.searchSemantic(embedding, {
          projectId:  args.project_id ?? defaultProjectId,
          category:   args.category as MemoryCategory | undefined,
          workspace:  args.workspace,
          status:     args.status as MemoryStatus | undefined,
          limit:      args.limit,
        });
        const payload = results.map((r) => ({
          score:     Math.round((r.score ?? 0) * 1000) / 1000,
          key:       r.memory.key,
          category:  r.memory.category,
          workspace: r.memory.workspace,
          summary:   r.memory.summary,
          content:   r.memory.content,
          tags:      r.memory.tags,
        }));
        return text(JSON.stringify(payload, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── MEMORY: update ────────────────────────────────────────────────────────────

  server.registerTool(
    'memory_update',
    {
      description:
        'Updates an existing memory. If content changes, regenerates the embedding automatically.',
      inputSchema: {
        key:        z.string(),
        project_id: z.string().optional(),
        content:    z.string().optional(),
        summary:    z.string().optional(),
        status:     z.enum(['active', 'deprecated', 'archived']).optional(),
        metadata:   z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const pid = projectId(args.project_id);
        const newEmbedding = args.content ? await embedFn(args.content) : undefined;
        const updated = db.updateMemory(
          args.key,
          pid,
          {
            content:  args.content,
            summary:  args.summary,
            status:   args.status as MemoryStatus | undefined,
            metadata: args.metadata,
          },
          newEmbedding
        );
        if (!updated) return text('null');
        return text(JSON.stringify(memoryToJson(updated), null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

// --- ENTRY POINT ---

async function main() {
  const db = new MemoryDatabase(process.env.MEMORY_DB_PATH);
  const server = createMemoryServer(db, process.env.MEMORY_PROJECT_ID);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('MCP Memory Server ready\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
