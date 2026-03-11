-- 001-init-schema.sql

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL,
  config      JSON,
  last_indexed DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Main memory table — embedding stored as raw float32 BLOB
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  content     TEXT,
  summary     TEXT,
  category    TEXT NOT NULL,
  workspace   TEXT,
  tags        TEXT,         -- JSON array stored as TEXT
  metadata    JSON,
  embedding   BLOB NOT NULL, -- Float32Array, 384 dims × 4 bytes = 1536 bytes
  version     INTEGER DEFAULT 1,
  parent_key  TEXT,
  status      TEXT DEFAULT 'active',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  accessed_at DATETIME,
  UNIQUE(project_id, key),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS memory_relations (
  id            TEXT PRIMARY KEY,
  source_key    TEXT NOT NULL,
  target_key    TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  strength      REAL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_key) REFERENCES memories(key),
  FOREIGN KEY (target_key) REFERENCES memories(key),
  UNIQUE(source_key, target_key, relation_type)
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  content     TEXT NOT NULL,
  hash        TEXT,
  indexed     INTEGER DEFAULT 0,
  last_checked DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, path),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS access_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  memory_key  TEXT,
  agent       TEXT,
  action      TEXT,
  query       TEXT,
  timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (memory_key) REFERENCES memories(key)
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
