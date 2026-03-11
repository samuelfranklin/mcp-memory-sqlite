# Architecture Decisions

All non-obvious technical decisions made while building this system, with rationale and the alternatives considered.

---

## D1 — Single SQLite file, `project_id` on all tables

**Decision:** One `memory.sqlite` database for all projects, with a `project_id` foreign key on every table.

**Why not one SQLite per project?**
- Vector search (sqlite-vec) works across all projects with a simple `WHERE project_id = ?` filter
- No need for a registry of database files
- Cross-project search becomes trivial (omit the `project_id` filter)
- One migration run, one connection pool

**Why not PostgreSQL / external DB?**
- Adds infrastructure dependency (the whole point is zero-infra)
- sqlite-vec gives us cosine similarity search without a vector DB
- SQLite WAL mode handles concurrent reads fine at this scale

---

## D2 — `better-sqlite3` over `node-sqlite3` or `bun:sqlite`

**Decision:** `better-sqlite3` (sync driver).

**Why:**
- Synchronous API matches the synchronous nature of SQLite — no async overhead or Promise chains
- Much simpler code: `const row = stmt.get(id)` instead of `await stmt.get(id)`
- Actively maintained, excellent TypeScript types
- Works with native addons (required for `sqlite-vec`)

**Why not Bun's built-in SQLite?**
- The system must work on Node.js environments
- `bun:sqlite` is not compatible with `sqlite-vec`'s native loading mechanism

---

## D3 — `sqlite-vec` for vector search

**Decision:** `sqlite-vec` npm package loaded as a SQLite extension.

**How it works:**
```typescript
import * as sqliteVec from 'sqlite-vec';
sqliteVec.load(this.db); // registers vec_distance_cosine() and friends
```

**SQL usage:**
```sql
SELECT *, vec_distance_cosine(embedding, ?) AS _dist
FROM memories
WHERE project_id = ? AND status = 'active'
ORDER BY _dist ASC
LIMIT ?
```

`vec_distance_cosine` returns `[0, 2]` where `0 = identical` and `2 = opposite`.
Score normalization: `similarity = 1 - (distance / 2)` → `[0, 1]`.

**Why not `vec0` virtual table?**
The virtual table enables ANN (approximate nearest neighbor) for large datasets but requires a separate table and sync mechanism. For typical agent memory sizes (<10K memories), a full-scan with cosine distance is fast and simpler.

---

## D4 — Local ONNX embeddings via `@xenova/transformers`

**Decision:** Model `Xenova/all-MiniLM-L6-v2`, 384 dimensions.

**Why local instead of OpenAI/Cohere embeddings?**
- No API key: works offline, on any machine, no cost
- No latency to external API
- Reproducible: same text = same embedding, forever

**Why `all-MiniLM-L6-v2`?**
- 384 dims: small storage footprint (1.5KB per memory)
- Excellent quality/speed tradeoff for semantic similarity
- The most commonly benchmarked model for this use case
- Native ONNX format: no Python, no heavy frameworks

**Model download:** ~23MB, cached in `node_modules/@xenova/transformers/.cache/` after first use.

**First call is slow (~2-5s):** The model loads lazily. Subsequent calls are fast.

---

## D5 — Pipeline singleton caches the Promise, not the instance

**Decision:**
```typescript
// WRONG — race condition:
let _pipeline: FeatureExtractionPipeline | null = null;
async function getPipeline() {
  if (!_pipeline) {
    _pipeline = await pipeline(...); // two concurrent callers both see null
  }
  return _pipeline;
}

// CORRECT — cache the Promise:
let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = pipeline(...) as Promise<...>; // set synchronously
  }
  return _pipelinePromise; // both callers share the same Promise
}
```

**Why this matters:** If two `embed()` calls arrive before the model loads (common at server startup), both see `null` and spawn two model downloads. Caching the Promise prevents this — all callers share one in-flight Promise.

---

## D6 — `embeddingToBlob()` helper for Buffer serialization

**Decision:**
```typescript
// WRONG — ignores byteOffset/byteLength:
Buffer.from(embedding.buffer)

// CORRECT:
Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
```

**Why this matters:** `TypedArray.buffer` returns the *entire* underlying `ArrayBuffer`. If the `Float32Array` is a sub-view (e.g. `output.data` from the transformers pipeline is a slice of a larger buffer), `Buffer.from(e.buffer)` serializes bytes *outside* the view — corrupting the embedding silently.

The helper:
```typescript
private embeddingToBlob(e: Float32Array): Buffer {
  return Buffer.from(e.buffer, e.byteOffset, e.byteLength);
}
```

---

## D7 — LIMIT as a bound parameter, not string interpolation

**Decision:**
```typescript
// WRONG:
query += ` LIMIT ${options?.limit ?? 10}`;

// CORRECT:
query += ' LIMIT ?';
params.push(options?.limit ?? 10);
```

**Why:** String interpolation of user-supplied values into SQL is a bad habit even when the type is `number`. Non-integer values like `NaN` or `Infinity` produce invalid SQL (`LIMIT Infinity`) that causes a SQLite parse error. Using bound parameters lets SQLite handle type validation.

---

## D8 — `db.exec(sql)` for multi-statement SQL

**Decision:** Use `db.exec(sql)` for migration files instead of splitting on `;`.

**Why:** Manual splitting on `;` breaks if a statement contains a semicolon inside a string literal. `db.exec()` handles multi-statement SQL natively and is the documented approach in better-sqlite3.

---

## D9 — TOCTOU-safe file reading

**Decision:**
```typescript
// WRONG — TOCTOU race:
if (existsSync(filePath)) {
  const sql = readFileSync(filePath, 'utf-8');
}

// CORRECT — operate and handle the error:
try {
  const sql = readFileSync(filePath, 'utf-8');
} catch {
  console.warn(`Migration file not found: ${filePath}`);
  return;
}
```

**Why:** Between `existsSync()` and `readFileSync()`, another process could delete the file. More importantly, this is a general anti-pattern: check-then-act sequences are always vulnerable to races. Always operate directly and handle the exception.

---

## D10 — `createMemoryServer()` factory for testability

**Decision:** The MCP server is not a singleton — it's created by a factory function:

```typescript
export function createMemoryServer(
  db: MemoryDatabase,
  defaultProjectId?: string,
  embedFn: (text: string) => Promise<Float32Array> = defaultEmbed
): McpServer
```

**Why:**
- Tests inject a real temp SQLite `db` and a fast stub `embedFn` — no module mocking
- The actual ONNX model is never loaded during tests
- Multiple server instances can coexist (useful in integration tests)

**How tests use it:**
```typescript
function stubEmbed(text: string): Promise<Float32Array> {
  const arr = new Float32Array(384).fill(0);
  arr[text.charCodeAt(0) % 384] = 1.0;
  return Promise.resolve(arr);
}

const server = createMemoryServer(db, 'test-project', stubEmbed);
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
```

---

## D11 — `InMemoryTransport` for integration tests

**Decision:** Use `@modelcontextprotocol/sdk/inMemory.js` instead of spawning a subprocess.

```typescript
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: 'test-client', version: '0.0.1' });
await client.connect(clientTransport);

// Now test as a real MCP client:
const result = await client.callTool({ name: 'memory_save', arguments: { ... } });
```

**Why:** No subprocess means no port conflicts, no process cleanup, instant startup, and full test isolation.

---

## D12 — `default` in `parseArgs` requires `string` type

**Decision:** In Node.js `util.parseArgs`, the `default` field for string options must be a `string`, not a number:

```typescript
// CORRECT:
options: { limit: { type: 'string', default: '10' } }
// Then parse: parseInt(values.limit as string, 10)

// WRONG — TypeScript error:
options: { limit: { type: 'string', default: 10 } }
```

`parseArgs` doesn't support numeric option types — all values are strings. Always `parseInt` or `parseFloat` as needed.

---

## D13 — `updateMemory` uses `memoryExists()` not `getMemory()` for the existence check

**Decision:**
```typescript
// WRONG — getMemory() updates accessed_at as a side effect:
if (!this.getMemory(key, projectId)) return null;

// CORRECT — bare SELECT 1, no side effects:
if (!this.memoryExists(key, projectId)) return null;
```

**Why:** `getMemory()` runs `UPDATE memories SET accessed_at = ?` as a side effect to track access time. Calling it for an existence check means `accessed_at` gets updated even when the caller only wants to update content — double-stamping the access log.

---

## D14 — `offset` outside the `limit` if-block in `listMemoriesByProject`

**Decision:**
```typescript
// WRONG — offset ignored when no limit is set:
if (options?.limit) {
  query += ' LIMIT ?'; params.push(options.limit);
  if (options?.offset) { query += ' OFFSET ?'; params.push(options.offset); }
}

// CORRECT — offset is independent of limit:
if (options?.limit)  { query += ' LIMIT ?';  params.push(options.limit); }
if (options?.offset) { query += ' OFFSET ?'; params.push(options.offset); }
```

In SQLite, `OFFSET` without `LIMIT` is valid but unusual. This pattern mirrors standard SQL pagination behavior.

---

## Known deferred issues

| Issue | Why deferred |
|---|---|
| `vec0` virtual table for ANN search | Full-scan is fast enough at <10K memories; vec0 adds schema complexity |
| Prepared statement caching in `searchSemantic` | Not hot-path at current scale |
| `resetPipeline()` exported from production module | Acceptable tradeoff vs. `vi.resetModules()` overhead in tests |
| CLI has 0% test coverage | It's an entry point, not a library; tested via smoke tests instead |
