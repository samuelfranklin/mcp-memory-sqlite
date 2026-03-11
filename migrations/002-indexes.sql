-- 002-indexes.sql

CREATE INDEX IF NOT EXISTS idx_memories_project   ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_category  ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_status    ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace);
CREATE INDEX IF NOT EXISTS idx_memories_updated   ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed  ON memories(accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_project  ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_id        ON projects(id);

CREATE INDEX IF NOT EXISTS idx_access_log_project   ON access_log(project_id);
CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON access_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_memory_relations_source ON memory_relations(source_key);
CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_key);
