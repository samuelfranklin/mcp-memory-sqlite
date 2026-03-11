#!/usr/bin/env node
/**
 * src/bin/memory-cli.ts
 * CLI client for the MCP Memory Server
 *
 * Usage: memory-cli <command> [options]
 *
 * Commands:
 *   search <query>      Semantic search across memories
 *   save                Save a new memory
 *   list                List memories with optional filters
 *   update              Update an existing memory
 *   project list        List all projects
 *   project register    Register a new project
 *
 * Global options:
 *   --project, -p <id>  Project ID (default: $MEMORY_PROJECT_ID)
 *   --help, -h          Show help
 *
 * Examples:
 *   memory-cli search "how to handle errors in express"
 *   memory-cli save --key "pattern:express:errors" --content "Use next(err)..." --category pattern
 *   memory-cli list --category pattern --limit 10
 *   memory-cli update --key "pattern:express:errors" --status archived
 *   memory-cli project register --id my-project --name "My Project" --path /path/to/project
 */

import { parseArgs } from 'node:util';
import { MemoryDatabase } from '../database.js';
import { embed } from '../embedding.js';
import type { MemoryCategory, MemoryStatus } from '../types.js';

// --- CONFIG ---

const DB_PATH = process.env.MEMORY_DB_PATH;
const DEFAULT_PROJECT = process.env.MEMORY_PROJECT_ID;

const db = new MemoryDatabase(DB_PATH);

// --- HELPERS ---

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function projectId(explicit?: string | undefined): string {
  const id = explicit ?? DEFAULT_PROJECT;
  if (!id) die('--project is required (or set MEMORY_PROJECT_ID)');
  return id!;
}

function printJson(value: unknown): void {
  // Strip embedding blobs before printing
  process.stdout.write(JSON.stringify(value, (_, v) =>
    v instanceof Float32Array || (v instanceof Buffer && v.length > 100) ? '[embedding]' : v,
    2
  ) + '\n');
}

function printTable(rows: Array<Record<string, unknown>>, cols: string[]): void {
  if (rows.length === 0) { process.stdout.write('(no results)\n'); return; }
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  );
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep    = widths.map((w) => '-'.repeat(w)).join('  ');
  process.stdout.write(header + '\n' + sep + '\n');
  for (const row of rows) {
    process.stdout.write(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  ') + '\n');
  }
}

// --- COMMAND HANDLERS ---

async function cmdSearch(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project:   { type: 'string', short: 'p' },
      category:  { type: 'string' },
      workspace: { type: 'string' },
      status:    { type: 'string' },
      limit:     { type: 'string', short: 'n', default: '10' },
      json:      { type: 'boolean', default: false },
    },
  });

  const query = positionals.join(' ');
  if (!query) die('Usage: memory-cli search <query>');

  const embedding = await embed(query);
  const results = db.searchSemantic(embedding, {
    projectId:  values.project ?? DEFAULT_PROJECT,
    category:   values.category as MemoryCategory | undefined,
    workspace:  values.workspace,
    status:     values.status as MemoryStatus | undefined,
    limit:      parseInt(values.limit as string, 10),
  });

  if (values.json) {
    printJson(results.map((r) => ({ score: r.score, ...r.memory, embedding: undefined })));
  } else {
    const rows = results.map((r) => ({
      score:    ((r.score ?? 0) * 100).toFixed(1) + '%',
      key:      r.memory.key,
      category: r.memory.category,
      summary:  r.memory.summary ?? (r.memory.content ?? '').slice(0, 60),
    }));
    printTable(rows, ['score', 'key', 'category', 'summary']);
  }
}

async function cmdSave(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      key:       { type: 'string', short: 'k' },
      content:   { type: 'string', short: 'c' },
      category:  { type: 'string' },
      project:   { type: 'string', short: 'p' },
      summary:   { type: 'string', short: 's' },
      workspace: { type: 'string', short: 'w' },
      tags:      { type: 'string' },
    },
  });

  if (!values.key)      die('--key is required');
  if (!values.content)  die('--content is required');
  if (!values.category) die('--category is required (pattern|decision|bug|context|trick)');

  const pid       = projectId(values.project);
  const embedding = await embed(values.content as string);
  const memory = db.createMemory(
    {
      projectId:  pid,
      key:        values.key as string,
      content:    values.content as string,
      category:   values.category as MemoryCategory,
      summary:    values.summary,
      workspace:  values.workspace,
      tags:       values.tags ? (values.tags as string).split(',').map((t) => t.trim()) : undefined,
    },
    embedding
  );
  process.stdout.write(`saved: ${memory.key} (v${memory.version})\n`);
}

function cmdList(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project:   { type: 'string', short: 'p' },
      category:  { type: 'string' },
      workspace: { type: 'string' },
      status:    { type: 'string' },
      limit:     { type: 'string', short: 'n', default: '20' },
      offset:    { type: 'string', default: '0' },
      json:      { type: 'boolean', default: false },
    },
  });

  const pid = projectId(values.project);
  const memories = db.listMemoriesByProject(pid, {
    category:  values.category as MemoryCategory | undefined,
    workspace: values.workspace,
    status:    values.status as MemoryStatus | undefined,
    limit:     parseInt(values.limit as string, 10),
    offset:    parseInt(values.offset as string, 10),
  });

  if (values.json) {
    printJson(memories.map(({ embedding: _, ...m }) => m));
  } else {
    const rows = memories.map((m) => ({
      key:       m.key,
      category:  m.category,
      status:    m.status,
      workspace: m.workspace ?? '',
      summary:   m.summary ?? (m.content ?? '').slice(0, 50),
    }));
    printTable(rows, ['key', 'category', 'status', 'workspace', 'summary']);
  }
}

async function cmdUpdate(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      key:      { type: 'string', short: 'k' },
      project:  { type: 'string', short: 'p' },
      content:  { type: 'string', short: 'c' },
      summary:  { type: 'string', short: 's' },
      status:   { type: 'string' },
    },
  });

  if (!values.key) die('--key is required');

  const pid          = projectId(values.project);
  const newEmbedding = values.content ? await embed(values.content as string) : undefined;
  const updated = db.updateMemory(
    values.key as string,
    pid,
    {
      content: values.content,
      summary: values.summary,
      status:  values.status as MemoryStatus | undefined,
    },
    newEmbedding
  );

  if (!updated) die(`memory not found: ${values.key}`);
  process.stdout.write(`updated: ${updated.key} (v${updated.version})\n`);
}

function cmdProjectList() {
  const projects = db.listProjects();
  if (projects.length === 0) { process.stdout.write('(no projects registered)\n'); return; }
  printTable(
    projects.map((p) => ({ id: p.id, name: p.name, root_path: p.root_path })),
    ['id', 'name', 'root_path']
  );
}

function cmdProjectRegister(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      id:   { type: 'string' },
      name: { type: 'string' },
      path: { type: 'string' },
    },
  });

  if (!values.id)   die('--id is required');
  if (!values.name) die('--name is required');
  if (!values.path) die('--path is required');

  const project = db.createProject({
    id:        values.id as string,
    name:      values.name as string,
    root_path: values.path as string,
  });
  process.stdout.write(`registered: ${project.id} — ${project.name}\n`);
}

// --- USAGE ---

function usage(): never {
  process.stdout.write(`
memory-cli <command> [options]

Commands:
  search <query>       Semantic search (uses embed model)
  save                 Save a new memory
  list                 List memories
  update               Update an existing memory
  project list         List all projects
  project register     Register a new project

Global:
  --project, -p <id>   Project ID (default: $MEMORY_PROJECT_ID)

search:
  [--category <cat>]   Filter by category
  [--workspace <w>]    Filter by workspace
  [--limit, -n <n>]    Max results (default: 10)
  [--json]             Output raw JSON

save:
  --key, -k <key>      Memory key
  --content, -c <text> Memory content
  --category <cat>     Category: pattern|decision|bug|context|trick
  [--summary, -s <s>]  Short summary
  [--workspace, -w <w>]Workspace
  [--tags <t1,t2>]     Comma-separated tags

list:
  [--category <cat>]   Filter by category
  [--workspace <w>]    Filter by workspace
  [--status <s>]       Filter by status
  [--limit, -n <n>]    Max results (default: 20)
  [--json]             Output raw JSON

update:
  --key, -k <key>      Memory key
  [--content, -c <c>]  New content (also re-embeds)
  [--summary, -s <s>]  New summary
  [--status <s>]       New status

project register:
  --id <id>            Project identifier
  --name <name>        Project name
  --path <path>        Root path
`);
  process.exit(0);
}

// --- MAIN ---

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') usage();

  try {
    switch (cmd) {
      case 'search':  await cmdSearch([sub, ...rest].filter(Boolean)); break;
      case 'save':    await cmdSave([sub, ...rest].filter(Boolean));   break;
      case 'list':    cmdList([sub, ...rest].filter(Boolean));          break;
      case 'update':  await cmdUpdate([sub, ...rest].filter(Boolean)); break;
      case 'project':
        switch (sub) {
          case 'list':     cmdProjectList();              break;
          case 'register': cmdProjectRegister(rest);     break;
          default:         die(`unknown project subcommand: ${sub ?? '(none)'}`);
        }
        break;
      default:
        die(`unknown command: ${cmd}. Run memory-cli --help for usage.`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
