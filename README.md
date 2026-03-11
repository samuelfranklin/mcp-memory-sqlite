# MCP Memory Server

**Persistent semantic memory for Claude Code and any AI agent.**

An MCP server that gives Claude a brain: stores decisions, patterns, bugs, and context in SQLite with local vector embeddings. Works across multiple projects. No external APIs.

---

## What it does

- Saves memories as structured entries with keys like `pattern:error-handling:typed`
- Generates 384-dim embeddings locally using `all-MiniLM-L6-v2` (ONNX, no API key)
- Semantic search: "how do I handle errors?" → returns the most relevant memories
- Multi-project: one SQLite database for everything, filtered by `project_id`
- Exposes 7 MCP tools Claude can call automatically during any session
- CLI for manual use from the terminal

---

## Prerequisites

- **Node.js ≥ 18** (uses `node:util/parseArgs`, native `crypto.randomUUID`)
- **pnpm** (or adapt scripts to npm/bun)
- **Claude Code** (for MCP integration) or any MCP-compatible host

---

## Directory structure

```
mcp-memory-spec/          ← this repo
├── README.md             ← you are here
├── DECISIONS.md          ← all architecture decisions + rationale
├── src/
│   ├── types.ts          ← TypeScript interfaces
│   ├── database.ts       ← SQLite layer (CRUD + semantic search)
│   ├── embedding.ts      ← local ONNX embeddings
│   ├── server/
│   │   └── index.ts      ← MCP server (7 tools, stdio transport)
│   └── bin/
│       └── memory-cli.ts ← CLI client (search/save/list/update)
├── migrations/
│   ├── 001-init-schema.sql
│   └── 002-indexes.sql
├── src/__tests__/
│   ├── unit/
│   │   ├── database.test.ts
│   │   └── embedding.test.ts
│   └── integration/
│       └── server.test.ts
├── databases/            ← created at runtime, gitignored
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Agent setup guide

**Follow these steps in order.** Each step is independently verifiable.

### Step 1 — Choose an install location

Pick a location outside your project (this is a shared tool, not project-specific):

```bash
# Recommended: inside the Claude config dir so it's always available
TARGET=~/.claude/mcp-memory

mkdir -p "$TARGET"
cd "$TARGET"
```

### Step 2 — Copy all source files

Copy the files from this repo preserving the directory structure:

```
src/types.ts
src/database.ts
src/embedding.ts
src/server/index.ts
src/bin/memory-cli.ts
src/__tests__/unit/database.test.ts
src/__tests__/unit/embedding.test.ts
src/__tests__/integration/server.test.ts
migrations/001-init-schema.sql
migrations/002-indexes.sql
package.json
tsconfig.json
vitest.config.ts
```

Also create the runtime database directory:

```bash
mkdir -p databases
```

### Step 3 — Install dependencies

```bash
pnpm install
```

`better-sqlite3` requires native compilation. The `package.json` already includes
`pnpm.onlyBuiltDependencies` to approve it automatically. If you still see
*"Could not locate the bindings file"* errors after install, run:

```bash
pnpm rebuild better-sqlite3
```

Dependencies installed:
- `@modelcontextprotocol/sdk` — MCP server + client
- `@xenova/transformers` — local ONNX model runner
- `better-sqlite3` — sync SQLite driver (native addon)
- `sqlite-vec` — vector distance functions for SQLite (native addon)
- `zod` — schema validation in MCP tool definitions

The ONNX model (`all-MiniLM-L6-v2`, ~23MB) is downloaded automatically on first `embed()` call.

### Step 4 — Run tests to verify

```bash
pnpm test --run
```

Expected output:
```
Tests  44 passed (44)
```

If all 44 tests pass, the installation is correct.

```bash
pnpm test:coverage --run
# database.ts:  ~100% stmts, ~88% branches
# embedding.ts: ~95% stmts
# server/index.ts: ~93% stmts
```

### Step 5 — Register your project

```bash
MEMORY_DB_PATH=./databases/memory.sqlite \
  pnpm exec tsx src/bin/memory-cli.ts project register \
  --id MY_PROJECT_ID \
  --name "My Project Name" \
  --path /absolute/path/to/project
```

Replace `MY_PROJECT_ID` with a short slug (e.g. `my-app`, `backend`, `client-x`).

Verify:

```bash
MEMORY_DB_PATH=./databases/memory.sqlite \
  pnpm exec tsx src/bin/memory-cli.ts project list
```

### Step 6 — Configure Claude Code

Create or update `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "/ABSOLUTE/PATH/TO/.claude/mcp-memory/node_modules/.bin/tsx",
      "args": ["/ABSOLUTE/PATH/TO/.claude/mcp-memory/src/server/index.ts"],
      "env": {
        "MEMORY_PROJECT_ID": "MY_PROJECT_ID",
        "MEMORY_DB_PATH": "/ABSOLUTE/PATH/TO/.claude/mcp-memory/databases/memory.sqlite"
      }
    }
  }
}
```

**Replace all paths with absolute paths.** Relative paths do not work in Claude settings.

Restart Claude Code. The `memory` server should appear in the MCP servers list.

### Step 7 — Verify the MCP connection

In Claude Code, you should see the 7 tools available:
- `project_register`, `project_list`
- `memory_save`, `memory_get`, `memory_list`, `memory_search`, `memory_update`

Test via CLI first:

```bash
MEMORY_PROJECT_ID=MY_PROJECT_ID \
MEMORY_DB_PATH=/path/to/databases/memory.sqlite \
  pnpm exec tsx src/bin/memory-cli.ts save \
  --key "test:hello" \
  --content "Hello from memory" \
  --category pattern

MEMORY_PROJECT_ID=MY_PROJECT_ID \
MEMORY_DB_PATH=/path/to/databases/memory.sqlite \
  pnpm exec tsx src/bin/memory-cli.ts list
```

---

## CLI reference

```bash
# All commands use these env vars:
export MEMORY_PROJECT_ID=my-project
export MEMORY_DB_PATH=~/.claude/mcp-memory/databases/memory.sqlite

# Search (semantic — uses the ONNX model, slow on first call)
memory-cli search "how to handle errors in express"
memory-cli search "typescript generics" --category pattern --limit 5

# Save a memory
memory-cli save \
  --key "pattern:express:error-middleware" \
  --content "Always use next(err) in Express error handlers..." \
  --category pattern \
  --summary "Use next(err) for Express errors" \
  --workspace backend \
  --tags "express,errors,middleware"

# List memories
memory-cli list
memory-cli list --category decision --status active --limit 20

# Update
memory-cli update --key "pattern:express:error-middleware" --status archived
memory-cli update --key "pattern:express:error-middleware" --content "Updated content"

# Projects
memory-cli project list
memory-cli project register --id my-app --name "My App" --path /path/to/project
```

---

## MCP tools reference

All tools return JSON text. Errors return `{ isError: true }`.

| Tool | Required args | Optional args |
|---|---|---|
| `project_register` | `id`, `name`, `root_path` | `config` |
| `project_list` | — | — |
| `memory_save` | `key`, `content`, `category` | `project_id`, `summary`, `workspace`, `tags` |
| `memory_get` | `key` | `project_id` |
| `memory_list` | — | `project_id`, `category`, `workspace`, `status`, `limit`, `offset` |
| `memory_search` | `query` | `project_id`, `category`, `workspace`, `status`, `limit` (default 10, max 50) |
| `memory_update` | `key` | `project_id`, `content`, `summary`, `status`, `metadata` |

`category` enum: `pattern | decision | bug | context | trick`
`status` enum: `active | deprecated | archived`

---

## Key conventions

**Memory keys** use a hierarchical format: `{category}:{domain}:{descriptor}`

Examples:
```
pattern:error-handling:typed-errors
decision:database:use-postgres-not-mysql
bug:auth:jwt-refresh-race-condition
context:api:rate-limit-is-60-per-minute
trick:typescript:const-assertion-for-literal-types
```

---

## Env vars

| Variable | Required | Description |
|---|---|---|
| `MEMORY_PROJECT_ID` | Recommended | Default project for all operations |
| `MEMORY_DB_PATH` | Optional | Path to SQLite file (default: `databases/memory.sqlite` relative to install dir) |

---

## .gitignore

Add to `.gitignore` in this directory:
```
databases/
node_modules/
dist/
```

The `databases/` dir contains the SQLite file. Whether to commit it depends on your use case — it's safe to commit, but typically you want it local-only.
