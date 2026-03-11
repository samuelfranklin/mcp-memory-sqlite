/**
 * src/types.ts
 * TypeScript types shared between server and client
 */

export type MemoryCategory = 'pattern' | 'decision' | 'bug' | 'context' | 'trick';
export type MemoryStatus   = 'active' | 'deprecated' | 'archived';
export type RelationType   = 'depends_on' | 'related_to' | 'contradicts' | 'extends' | 'example_of';

export interface Project {
  id:           string;
  name:         string;
  root_path:    string;
  config?:      Record<string, unknown>;
  last_indexed?: Date;
  created_at:   Date;
  updated_at:   Date;
}

export interface Memory {
  id:          string;
  project_id:  string;
  key:         string;
  content?:    string;
  summary?:    string;
  category:    MemoryCategory;
  workspace?:  string;
  tags?:       string[];
  metadata?:   Record<string, unknown>;
  embedding:   Float32Array;
  version:     number;
  parent_key?: string;
  status:      MemoryStatus;
  created_at:  Date;
  updated_at:  Date;
  accessed_at?: Date;
}

export interface MemoryRelation {
  id:            string;
  source_key:    string;
  target_key:    string;
  relation_type: RelationType;
  strength?:     number;
  created_at:    Date;
}

export interface Document {
  id:           string;
  project_id:   string;
  path:         string;
  content:      string;
  hash?:        string;
  indexed:      boolean;
  last_checked?: Date;
  created_at:   Date;
  updated_at:   Date;
}

export interface AccessLog {
  id:          string;
  project_id?: string;
  memory_key?: string;
  agent:       string;
  action:      'read' | 'write' | 'search';
  query?:      string;
  timestamp:   Date;
}

export interface MemorySearchOptions {
  projectId?: string;
  category?:  MemoryCategory;
  workspace?: string;
  status?:    MemoryStatus;
  limit?:     number;
  offset?:    number;
}

export interface MemoryCreateInput {
  projectId:  string;
  key:        string;
  content:    string;
  summary?:   string;
  category:   MemoryCategory;
  workspace?: string;
  tags?:      string[];
  metadata?:  Record<string, unknown>;
}

export interface MemoryUpdateInput {
  content?:  string;
  summary?:  string;
  metadata?: Record<string, unknown>;
  status?:   MemoryStatus;
}

export interface SearchResult {
  memory: Memory;
  score?: number;
}
