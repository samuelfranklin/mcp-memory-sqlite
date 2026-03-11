/**
 * src/database.ts
 * Core SQLite database layer with migrations and CRUD
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type {
  Project,
  Memory,
  Document,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemorySearchOptions,
  SearchResult,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DB_PATH = join(ROOT_DIR, 'databases', 'memory.sqlite');

export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH, migrationsDir?: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    sqliteVec.load(this.db);
    this.runMigrations(migrationsDir ?? join(ROOT_DIR, 'migrations'));
  }

  // --- MIGRATIONS ---

  private runMigrations(dir: string): void {
    const executed = this.getExecutedMigrations();
    if (!executed.includes(1)) this.executeMigration(1, 'init-schema', dir);
    if (!executed.includes(2)) this.executeMigration(2, 'indexes', dir);
  }

  private getExecutedMigrations(): number[] {
    try {
      return (
        this.db
          .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
          .all() as { version: number }[]
      ).map((row) => row.version);
    } catch {
      return [];
    }
  }

  private executeMigration(version: number, name: string, dir: string): void {
    const filePath = join(dir, `${String(version).padStart(3, '0')}-${name}.sql`);
    let sql: string;
    try {
      sql = readFileSync(filePath, 'utf-8');
    } catch {
      console.warn(`Migration file not found: ${filePath}`);
      return;
    }
    this.db.exec(sql);
    this.db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, name);
    console.log(`✓ Migration ${version}: ${name}`);
  }

  // --- HELPERS ---

  private timestamps(): { now: Date; iso: string } {
    const now = new Date();
    return { now, iso: now.toISOString() };
  }

  private memoryExists(key: string, projectId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM memories WHERE key = ? AND project_id = ?')
      .get(key, projectId);
  }

  /** Serializes a Float32Array to a Buffer safe for SQLite storage.
   *  Respects byteOffset/byteLength in case of sub-views. */
  private embeddingToBlob(e: Float32Array): Buffer {
    return Buffer.from(e.buffer, e.byteOffset, e.byteLength);
  }

  // --- PROJECT operations ---

  createProject(project: Omit<Project, 'created_at' | 'updated_at'>): Project {
    const { now, iso } = this.timestamps();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, root_path, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(project.id, project.name, project.root_path, JSON.stringify(project.config ?? {}), iso, iso);
    return { ...project, created_at: now, updated_at: now };
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.rowToProject(row) : null;
  }

  listProjects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[]).map(
      (row) => this.rowToProject(row)
    );
  }

  // --- MEMORY operations ---

  createMemory(input: MemoryCreateInput, embedding: Float32Array): Memory {
    const id = randomUUID();
    const { now, iso } = this.timestamps();
    this.db
      .prepare(
        `INSERT INTO memories
          (id, project_id, key, content, summary, category, workspace, tags,
           embedding, version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.key,
        input.content ?? null,
        input.summary ?? null,
        input.category,
        input.workspace ?? null,
        JSON.stringify(input.tags ?? []),
        this.embeddingToBlob(embedding),
        1,
        'active',
        iso,
        iso
      );
    return {
      id,
      project_id: input.projectId,
      key: input.key,
      content: input.content,
      summary: input.summary,
      category: input.category,
      workspace: input.workspace,
      tags: input.tags,
      metadata: input.metadata,
      embedding,
      version: 1,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
  }

  getMemory(key: string, projectId: string): Memory | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE key = ? AND project_id = ?')
      .get(key, projectId) as any;
    if (!row) return null;
    this.db
      .prepare('UPDATE memories SET accessed_at = ? WHERE key = ? AND project_id = ?')
      .run(this.timestamps().iso, key, projectId);
    return this.rowToMemory(row);
  }

  listMemoriesByProject(projectId: string, options?: MemorySearchOptions): Memory[] {
    let query = 'SELECT * FROM memories WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (options?.category) { query += ' AND category = ?'; params.push(options.category); }
    if (options?.status)   { query += ' AND status = ?';   params.push(options.status); }
    if (options?.workspace){ query += ' AND workspace = ?'; params.push(options.workspace); }

    query += ' ORDER BY updated_at DESC';

    if (options?.limit)  { query += ' LIMIT ?';  params.push(options.limit); }
    if (options?.offset) { query += ' OFFSET ?'; params.push(options.offset); }

    return (this.db.prepare(query).all(params) as any[]).map((row) => this.rowToMemory(row));
  }

  updateMemory(
    key: string,
    projectId: string,
    input: MemoryUpdateInput,
    newEmbedding?: Float32Array
  ): Memory | null {
    if (!this.memoryExists(key, projectId)) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.content  !== undefined) { updates.push('content = ?');            values.push(input.content); }
    if (input.summary  !== undefined) { updates.push('summary = ?');            values.push(input.summary); }
    if (input.metadata !== undefined) { updates.push('metadata = ?');           values.push(JSON.stringify(input.metadata)); }
    if (input.status   !== undefined) { updates.push('status = ?');             values.push(input.status); }
    if (newEmbedding)                 { updates.push('embedding = ?');          values.push(this.embeddingToBlob(newEmbedding)); }

    if (updates.length === 0) return this.getMemory(key, projectId);

    updates.push('version = version + 1', 'updated_at = ?');
    values.push(this.timestamps().iso, key, projectId);

    this.db
      .prepare(`UPDATE memories SET ${updates.join(', ')} WHERE key = ? AND project_id = ?`)
      .run(values);

    return this.getMemory(key, projectId);
  }

  // --- SEMANTIC SEARCH ---

  /**
   * Finds the top-N most similar memories to an embedding using cosine distance.
   * sqlite-vec vec_distance_cosine returns values in [0, 2]: 0 = identical, 2 = opposite.
   * The returned `score` is normalized to [0, 1] (similarity: 1 = identical).
   */
  searchSemantic(
    queryEmbedding: Float32Array,
    options?: Pick<MemorySearchOptions, 'projectId' | 'category' | 'workspace' | 'status' | 'limit'>
  ): SearchResult[] {
    const blob = this.embeddingToBlob(queryEmbedding);
    let query = 'SELECT *, vec_distance_cosine(embedding, ?) AS _dist FROM memories WHERE 1=1';
    const params: unknown[] = [blob];

    if (options?.projectId)          { query += ' AND project_id = ?'; params.push(options.projectId); }
    if (options?.category)           { query += ' AND category = ?';   params.push(options.category); }
    if (options?.workspace)          { query += ' AND workspace = ?';  params.push(options.workspace); }
    if (options?.status !== undefined) { query += ' AND status = ?';   params.push(options.status); }
    else                               { query += ' AND status = ?';   params.push('active'); }

    query += ' ORDER BY _dist ASC LIMIT ?';
    params.push(options?.limit ?? 10);

    return (this.db.prepare(query).all(params) as any[]).map((row) => ({
      memory: this.rowToMemory(row),
      // vec_distance_cosine returns [0, 2]: 0 = identical, 2 = opposite → normalize to [0, 1]
      score: 1 - row._dist / 2,
    }));
  }

  // --- DOCUMENT operations ---

  createDocument(projectId: string, path: string, content: string, hash: string): Document {
    const id = randomUUID();
    const { now, iso } = this.timestamps();
    this.db
      .prepare(
        'INSERT INTO documents (id, project_id, path, content, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, projectId, path, content, hash, iso, iso);
    return { id, project_id: projectId, path, content, hash, indexed: false, created_at: now, updated_at: now };
  }

  getDocument(projectId: string, path: string): Document | null {
    const row = this.db
      .prepare('SELECT * FROM documents WHERE project_id = ? AND path = ?')
      .get(projectId, path) as any;
    return row ? this.rowToDocument(row) : null;
  }

  listDocumentsByProject(projectId: string): Document[] {
    return (
      this.db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]
    ).map((row) => this.rowToDocument(row));
  }

  // --- ROW MAPPERS ---

  private rowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      root_path: row.root_path,
      config: row.config ? JSON.parse(row.config) : undefined,
      last_indexed: row.last_indexed ? new Date(row.last_indexed) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      project_id: row.project_id,
      key: row.key,
      content: row.content,
      summary: row.summary,
      category: row.category,
      workspace: row.workspace,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      embedding: new Float32Array(row.embedding),
      version: row.version,
      parent_key: row.parent_key,
      status: row.status,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      accessed_at: row.accessed_at ? new Date(row.accessed_at) : undefined,
    };
  }

  private rowToDocument(row: any): Document {
    return {
      id: row.id,
      project_id: row.project_id,
      path: row.path,
      content: row.content,
      hash: row.hash,
      indexed: Boolean(row.indexed),
      last_checked: row.last_checked ? new Date(row.last_checked) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  close(): void {
    this.db.close();
  }
}
