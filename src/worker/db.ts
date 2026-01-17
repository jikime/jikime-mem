/**
 * jikime-mem Database Module
 * Bun 내장 SQLite를 사용한 데이터베이스 관리
 * Chroma Vector DB와 동기화하여 시맨틱 검색 지원
 */
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'
import { getChromaSync } from './chroma'

const DATA_DIR = join(homedir(), '.jikime-mem')
const DB_PATH = join(DATA_DIR, 'jikime-mem.db')

// 데이터 디렉토리 생성
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// 데이터베이스 인스턴스
export const db = new Database(DB_PATH)

// WAL 모드 활성화 (성능 향상)
db.exec('PRAGMA journal_mode = WAL')

// 테이블 생성
db.exec(`
  -- 세션 테이블
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    project_path TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT DEFAULT 'active',
    metadata TEXT
  );

  -- 프롬프트 테이블
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    metadata TEXT
  );

  -- 관찰 테이블
  CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL,
    tool_response TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    duration INTEGER,
    status TEXT DEFAULT 'success',
    metadata TEXT
  );

  -- Claude 응답 테이블
  CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    metadata TEXT
  );

  -- 설정 테이블
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 인덱스
  CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);
  CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp);
  CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
  CREATE INDEX IF NOT EXISTS idx_observations_tool ON observations(tool_name);
  CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
  CREATE INDEX IF NOT EXISTS idx_responses_timestamp ON responses(timestamp);
`)

// FTS5 (Full-Text Search) 테이블 생성
db.exec(`
  -- 프롬프트 FTS 테이블
  CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
    id UNINDEXED,
    session_id UNINDEXED,
    content,
    timestamp UNINDEXED,
    content='prompts',
    content_rowid='rowid'
  );

  -- 관찰 FTS 테이블
  CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    id UNINDEXED,
    session_id UNINDEXED,
    tool_name,
    tool_input,
    tool_response,
    timestamp UNINDEXED,
    content='observations',
    content_rowid='rowid'
  );

  -- 응답 FTS 테이블
  CREATE VIRTUAL TABLE IF NOT EXISTS responses_fts USING fts5(
    id UNINDEXED,
    session_id UNINDEXED,
    content,
    timestamp UNINDEXED,
    content='responses',
    content_rowid='rowid'
  );
`)

// FTS 동기화 트리거 생성
db.exec(`
  -- Prompts FTS 트리거
  CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(rowid, id, session_id, content, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.content, NEW.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, content, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.content, OLD.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, id, session_id, content, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.content, OLD.timestamp);
    INSERT INTO prompts_fts(rowid, id, session_id, content, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.content, NEW.timestamp);
  END;

  -- Observations FTS 트리거
  CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, id, session_id, tool_name, tool_input, tool_response, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.tool_name, NEW.tool_input, NEW.tool_response, NEW.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, id, session_id, tool_name, tool_input, tool_response, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.tool_name, OLD.tool_input, OLD.tool_response, OLD.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, id, session_id, tool_name, tool_input, tool_response, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.tool_name, OLD.tool_input, OLD.tool_response, OLD.timestamp);
    INSERT INTO observations_fts(rowid, id, session_id, tool_name, tool_input, tool_response, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.tool_name, NEW.tool_input, NEW.tool_response, NEW.timestamp);
  END;

  -- Responses FTS 트리거
  CREATE TRIGGER IF NOT EXISTS responses_ai AFTER INSERT ON responses BEGIN
    INSERT INTO responses_fts(rowid, id, session_id, content, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.content, NEW.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS responses_ad AFTER DELETE ON responses BEGIN
    INSERT INTO responses_fts(responses_fts, rowid, id, session_id, content, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.content, OLD.timestamp);
  END;

  CREATE TRIGGER IF NOT EXISTS responses_au AFTER UPDATE ON responses BEGIN
    INSERT INTO responses_fts(responses_fts, rowid, id, session_id, content, timestamp)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_id, OLD.content, OLD.timestamp);
    INSERT INTO responses_fts(rowid, id, session_id, content, timestamp)
    VALUES (NEW.rowid, NEW.id, NEW.session_id, NEW.content, NEW.timestamp);
  END;
`)

// ID 생성 함수
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}

// 세션 관련 함수
export const sessions = {
  findBySessionId(sessionId: string) {
    const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?')
    return stmt.get(sessionId)
  },

  create(sessionId: string, projectPath: string) {
    const id = generateId()
    const stmt = db.prepare(`
      INSERT INTO sessions (id, session_id, project_path)
      VALUES (?, ?, ?)
    `)
    stmt.run(id, sessionId, projectPath)
    return this.findBySessionId(sessionId)
  },

  stop(sessionId: string) {
    const stmt = db.prepare(`
      UPDATE sessions SET status = 'completed', ended_at = datetime('now')
      WHERE session_id = ?
    `)
    stmt.run(sessionId)
    return this.findBySessionId(sessionId)
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
    return stmt.all(limit)
  },

  count() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM sessions')
    return (stmt.get() as { count: number }).count
  }
}

// 프롬프트 관련 함수
export const prompts = {
  create(sessionId: string, content: string, metadata?: string) {
    const id = generateId()
    const stmt = db.prepare(`
      INSERT INTO prompts (id, session_id, content, metadata)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, sessionId, content, metadata || null)
    const getStmt = db.prepare('SELECT * FROM prompts WHERE id = ?')
    const result = getStmt.get(id) as any

    // Chroma 동기화 (fire-and-forget)
    if (result) {
      getChromaSync().syncPrompt(
        result.id,
        sessionId,
        content,
        result.timestamp
      ).catch(err => console.error('[DB] Chroma sync failed for prompt:', err))
    }

    return result
  },

  findBySession(sessionId: string, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM prompts WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(sessionId, limit)
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM prompts ORDER BY timestamp DESC LIMIT ?')
    return stmt.all(limit)
  },

  search(query: string, limit = 10) {
    // FTS5 검색 사용 (더 빠르고 정확한 전문 검색)
    const stmt = db.prepare(`
      SELECT p.* FROM prompts p
      JOIN prompts_fts fts ON p.rowid = fts.rowid
      WHERE prompts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    try {
      return stmt.all(query, limit)
    } catch {
      // FTS 검색 실패 시 LIKE 폴백
      const fallbackStmt = db.prepare(`
        SELECT * FROM prompts WHERE content LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      return fallbackStmt.all(`%${query}%`, limit)
    }
  },

  count() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM prompts')
    return (stmt.get() as { count: number }).count
  }
}

// 관찰 관련 함수
export const observations = {
  create(sessionId: string, toolName: string, toolInput: string, toolResponse: string, metadata?: string) {
    const id = generateId()
    const stmt = db.prepare(`
      INSERT INTO observations (id, session_id, tool_name, tool_input, tool_response, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, sessionId, toolName, toolInput, toolResponse, metadata || null)
    const getStmt = db.prepare('SELECT * FROM observations WHERE id = ?')
    const result = getStmt.get(id) as any

    // Chroma 동기화 (fire-and-forget)
    if (result) {
      getChromaSync().syncObservation(
        result.id,
        sessionId,
        toolName,
        toolInput,
        toolResponse,
        result.timestamp
      ).catch(err => console.error('[DB] Chroma sync failed for observation:', err))
    }

    return result
  },

  findBySession(sessionId: string, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM observations WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(sessionId, limit)
  },

  findByTool(toolName: string, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM observations WHERE tool_name = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(toolName, limit)
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM observations ORDER BY timestamp DESC LIMIT ?')
    return stmt.all(limit)
  },

  search(query: string, limit = 10) {
    // FTS5 검색 사용 (더 빠르고 정확한 전문 검색)
    const stmt = db.prepare(`
      SELECT o.* FROM observations o
      JOIN observations_fts fts ON o.rowid = fts.rowid
      WHERE observations_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    try {
      return stmt.all(query, limit)
    } catch {
      // FTS 검색 실패 시 LIKE 폴백
      const fallbackStmt = db.prepare(`
        SELECT * FROM observations
        WHERE tool_name LIKE ? OR tool_input LIKE ? OR tool_response LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      return fallbackStmt.all(`%${query}%`, `%${query}%`, `%${query}%`, limit)
    }
  },

  count() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM observations')
    return (stmt.get() as { count: number }).count
  }
}

// Claude 응답 관련 함수
export const responses = {
  create(sessionId: string, content: string, metadata?: string) {
    const id = generateId()
    const stmt = db.prepare(`
      INSERT INTO responses (id, session_id, content, metadata)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, sessionId, content, metadata || null)
    const getStmt = db.prepare('SELECT * FROM responses WHERE id = ?')
    const result = getStmt.get(id) as any

    // Chroma 동기화 (fire-and-forget)
    if (result) {
      getChromaSync().syncResponse(
        result.id,
        sessionId,
        content,
        result.timestamp
      ).catch(err => console.error('[DB] Chroma sync failed for response:', err))
    }

    return result
  },

  findBySession(sessionId: string, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM responses WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(sessionId, limit)
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM responses ORDER BY timestamp DESC LIMIT ?')
    return stmt.all(limit)
  },

  search(query: string, limit = 10) {
    // FTS5 검색 사용 (더 빠르고 정확한 전문 검색)
    const stmt = db.prepare(`
      SELECT r.* FROM responses r
      JOIN responses_fts fts ON r.rowid = fts.rowid
      WHERE responses_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    try {
      return stmt.all(query, limit)
    } catch {
      // FTS 검색 실패 시 LIKE 폴백
      const fallbackStmt = db.prepare(`
        SELECT * FROM responses WHERE content LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      return fallbackStmt.all(`%${query}%`, limit)
    }
  },

  // 세션의 마지막 응답 조회
  findLastBySession(sessionId: string) {
    const stmt = db.prepare(`
      SELECT * FROM responses WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `)
    return stmt.get(sessionId)
  },

  count() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM responses')
    return (stmt.get() as { count: number }).count
  }
}

// FTS 인덱스 재구축 함수 (기존 데이터 마이그레이션용)
export function rebuildFtsIndex() {
  console.log('[DB] Rebuilding FTS indexes...')

  try {
    // prompts FTS 재구축
    db.exec(`
      INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');
    `)
    console.log('[DB] prompts_fts rebuilt')
  } catch (err) {
    console.log('[DB] prompts_fts rebuild skipped (may already be populated)')
  }

  try {
    // observations FTS 재구축
    db.exec(`
      INSERT INTO observations_fts(observations_fts) VALUES('rebuild');
    `)
    console.log('[DB] observations_fts rebuilt')
  } catch (err) {
    console.log('[DB] observations_fts rebuild skipped (may already be populated)')
  }

  try {
    // responses FTS 재구축
    db.exec(`
      INSERT INTO responses_fts(responses_fts) VALUES('rebuild');
    `)
    console.log('[DB] responses_fts rebuilt')
  } catch (err) {
    console.log('[DB] responses_fts rebuild skipped (may already be populated)')
  }

  console.log('[DB] FTS index rebuild complete')
}

// 앱 시작 시 FTS 인덱스 재구축 실행 (기존 데이터 마이그레이션)
try {
  // FTS 테이블이 비어있으면 재구축
  const ftsCount = db.prepare('SELECT COUNT(*) as count FROM prompts_fts').get() as { count: number }
  const mainCount = db.prepare('SELECT COUNT(*) as count FROM prompts').get() as { count: number }

  if (ftsCount.count === 0 && mainCount.count > 0) {
    console.log('[DB] FTS tables empty, rebuilding from existing data...')
    rebuildFtsIndex()
  }
} catch (err) {
  console.error('[DB] FTS check failed:', err)
}
