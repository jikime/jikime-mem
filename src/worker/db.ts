/**
 * jikime-mem Database Module
 * 프로젝트별 SQLite 데이터베이스 관리
 * Chroma Vector DB와 동기화하여 시맨틱 검색 지원
 */
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'
import { getChromaSyncForProject } from './chroma'
import {
  getProjectDbPath,
  getProjectDataDir,
  getDefaultDbPath,
  getCachedProject,
  getAllProjects as getAllProjectsFromManager,
  type ProjectInfo
} from './project-manager'

// LRU 캐시 설정
const MAX_DB_CACHE_SIZE = 5  // 최대 5개 DB 인스턴스 캐시

// ID 생성 함수
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}

/**
 * 프로젝트별 Database 인스턴스 관리 클래스
 */
class ProjectDatabase {
  private db: Database
  private projectPath: string
  private projectId: string

  constructor(projectPath: string) {
    this.projectPath = projectPath

    const project = getCachedProject(projectPath)
    this.projectId = project.id

    const dbPath = getProjectDbPath(projectPath)

    // 데이터 디렉토리 확인
    const dataDir = getProjectDataDir(projectPath)
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    // 데이터베이스 인스턴스 생성
    this.db = new Database(dbPath)

    // WAL 모드 활성화 (성능 향상)
    this.db.exec('PRAGMA journal_mode = WAL')

    // 테이블 생성
    this.initializeTables()
  }

  /**
   * 테이블 초기화
   */
  private initializeTables(): void {
    // 기본 테이블 생성
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_responses_session ON responses(session_id);
      CREATE INDEX IF NOT EXISTS idx_responses_timestamp ON responses(timestamp);
    `)

    // FTS5 (Full-Text Search) 테이블 생성
    this.db.exec(`
      -- 프롬프트 FTS 테이블
      CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
        id UNINDEXED,
        session_id UNINDEXED,
        content,
        timestamp UNINDEXED,
        content='prompts',
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
    this.db.exec(`
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

    // FTS 인덱스 초기화 확인
    this.checkAndRebuildFts()
  }

  /**
   * FTS 인덱스 확인 및 재구축
   */
  private checkAndRebuildFts(): void {
    try {
      const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM prompts_fts').get() as { count: number }
      const mainCount = this.db.prepare('SELECT COUNT(*) as count FROM prompts').get() as { count: number }

      if (ftsCount.count === 0 && mainCount.count > 0) {
        console.log(`[DB:${this.projectId}] FTS tables empty, rebuilding...`)
        this.rebuildFtsIndex()
      }
    } catch (err) {
      console.error(`[DB:${this.projectId}] FTS check failed:`, err)
    }
  }

  /**
   * FTS 인덱스 재구축
   */
  rebuildFtsIndex(): void {
    console.log(`[DB:${this.projectId}] Rebuilding FTS indexes...`)

    try {
      this.db.exec(`INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');`)
      console.log(`[DB:${this.projectId}] prompts_fts rebuilt`)
    } catch (err) {
      console.log(`[DB:${this.projectId}] prompts_fts rebuild skipped`)
    }

    try {
      this.db.exec(`INSERT INTO responses_fts(responses_fts) VALUES('rebuild');`)
      console.log(`[DB:${this.projectId}] responses_fts rebuilt`)
    } catch (err) {
      console.log(`[DB:${this.projectId}] responses_fts rebuild skipped`)
    }
  }

  /**
   * 프로젝트 경로 반환
   */
  getProjectPath(): string {
    return this.projectPath
  }

  /**
   * 프로젝트 ID 반환
   */
  getProjectId(): string {
    return this.projectId
  }

  // ========== Sessions ==========

  sessions = {
    findBySessionId: (sessionId: string) => {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?')
      return stmt.get(sessionId)
    },

    create: (sessionId: string, projectPath: string) => {
      const id = generateId()
      const stmt = this.db.prepare(`
        INSERT INTO sessions (id, session_id, project_path)
        VALUES (?, ?, ?)
      `)
      stmt.run(id, sessionId, projectPath)
      return this.sessions.findBySessionId(sessionId)
    },

    stop: (sessionId: string) => {
      const stmt = this.db.prepare(`
        UPDATE sessions SET status = 'completed', ended_at = datetime('now')
        WHERE session_id = ?
      `)
      stmt.run(sessionId)
      return this.sessions.findBySessionId(sessionId)
    },

    findAll: (limit = 50) => {
      const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
      return stmt.all(limit)
    },

    count: () => {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions')
      return (stmt.get() as { count: number }).count
    }
  }

  // ========== Prompts ==========

  prompts = {
    create: (sessionId: string, content: string, metadata?: string) => {
      const id = generateId()
      const stmt = this.db.prepare(`
        INSERT INTO prompts (id, session_id, content, metadata)
        VALUES (?, ?, ?, ?)
      `)
      stmt.run(id, sessionId, content, metadata || null)
      const getStmt = this.db.prepare('SELECT * FROM prompts WHERE id = ?')
      const result = getStmt.get(id) as any

      // Chroma 동기화 (fire-and-forget)
      if (result) {
        getChromaSyncForProject(this.projectPath).syncPrompt(
          result.id,
          sessionId,
          content,
          result.timestamp
        ).catch(err => console.error(`[DB:${this.projectId}] Chroma sync failed for prompt:`, err))
      }

      return result
    },

    findBySession: (sessionId: string, limit = 50) => {
      const stmt = this.db.prepare(`
        SELECT * FROM prompts WHERE session_id = ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      return stmt.all(sessionId, limit)
    },

    findAll: (limit = 50) => {
      const stmt = this.db.prepare('SELECT * FROM prompts ORDER BY timestamp DESC LIMIT ?')
      return stmt.all(limit)
    },

    search: (query: string, limit = 10) => {
      // FTS5 검색 사용
      const stmt = this.db.prepare(`
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
        const fallbackStmt = this.db.prepare(`
          SELECT * FROM prompts WHERE content LIKE ?
          ORDER BY timestamp DESC LIMIT ?
        `)
        return fallbackStmt.all(`%${query}%`, limit)
      }
    },

    count: () => {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM prompts')
      return (stmt.get() as { count: number }).count
    }
  }

  // ========== Responses ==========

  responses = {
    create: (sessionId: string, content: string, metadata?: string) => {
      const id = generateId()
      const stmt = this.db.prepare(`
        INSERT INTO responses (id, session_id, content, metadata)
        VALUES (?, ?, ?, ?)
      `)
      stmt.run(id, sessionId, content, metadata || null)
      const getStmt = this.db.prepare('SELECT * FROM responses WHERE id = ?')
      const result = getStmt.get(id) as any

      // Chroma 동기화 (fire-and-forget)
      if (result) {
        getChromaSyncForProject(this.projectPath).syncResponse(
          result.id,
          sessionId,
          content,
          result.timestamp
        ).catch(err => console.error(`[DB:${this.projectId}] Chroma sync failed for response:`, err))
      }

      return result
    },

    findBySession: (sessionId: string, limit = 50) => {
      const stmt = this.db.prepare(`
        SELECT * FROM responses WHERE session_id = ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      return stmt.all(sessionId, limit)
    },

    findAll: (limit = 50) => {
      const stmt = this.db.prepare('SELECT * FROM responses ORDER BY timestamp DESC LIMIT ?')
      return stmt.all(limit)
    },

    search: (query: string, limit = 10) => {
      // FTS5 검색 사용
      const stmt = this.db.prepare(`
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
        const fallbackStmt = this.db.prepare(`
          SELECT * FROM responses WHERE content LIKE ?
          ORDER BY timestamp DESC LIMIT ?
        `)
        return fallbackStmt.all(`%${query}%`, limit)
      }
    },

    findLastBySession: (sessionId: string) => {
      const stmt = this.db.prepare(`
        SELECT * FROM responses WHERE session_id = ?
        ORDER BY timestamp DESC LIMIT 1
      `)
      return stmt.get(sessionId)
    },

    count: () => {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM responses')
      return (stmt.get() as { count: number }).count
    }
  }

  /**
   * DB 연결 닫기
   */
  close(): void {
    this.db.close()
  }
}

// ========== DB 인스턴스 캐시 관리 ==========

class DatabaseCache {
  private cache = new Map<string, ProjectDatabase>()
  private accessOrder: string[] = []
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(projectPath: string): ProjectDatabase {
    let db = this.cache.get(projectPath)

    if (db) {
      // LRU: 접근 순서 업데이트
      this.accessOrder = this.accessOrder.filter(p => p !== projectPath)
      this.accessOrder.push(projectPath)
      return db
    }

    // 새 DB 인스턴스 생성
    db = new ProjectDatabase(projectPath)

    // 캐시가 꽉 찼으면 가장 오래된 항목 제거
    if (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestPath = this.accessOrder.shift()
      if (oldestPath) {
        const oldDb = this.cache.get(oldestPath)
        if (oldDb) {
          console.log(`[DatabaseCache] Evicting: ${oldDb.getProjectId()}`)
          oldDb.close()
          this.cache.delete(oldestPath)
        }
      }
    }

    this.cache.set(projectPath, db)
    this.accessOrder.push(projectPath)

    return db
  }

  has(projectPath: string): boolean {
    return this.cache.has(projectPath)
  }

  closeAll(): void {
    for (const db of this.cache.values()) {
      db.close()
    }
    this.cache.clear()
    this.accessOrder = []
  }

  size(): number {
    return this.cache.size
  }
}

// 싱글톤 캐시 인스턴스
const dbCache = new DatabaseCache(MAX_DB_CACHE_SIZE)

/**
 * 프로젝트별 DB 인스턴스 가져오기
 */
export function getDatabase(projectPath: string): ProjectDatabase {
  return dbCache.get(projectPath)
}

/**
 * 모든 프로젝트 목록 조회
 */
export function getAllProjects(): ProjectInfo[] {
  return getAllProjectsFromManager()
}

// ========== 레거시 호환성 (기존 코드와의 호환) ==========
// 주의: 이 레거시 인터페이스는 기본 프로젝트(_default)를 사용합니다.
// 새 코드에서는 getDatabase(projectPath)를 사용하세요.

const DATA_DIR = join(homedir(), '.jikime-mem')
const DB_PATH = join(DATA_DIR, 'jikime-mem.db')

// 레거시 데이터 디렉토리 확인
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// 레거시 DB 인스턴스 (기존 코드 호환용)
let legacyDb: Database | null = null

function getLegacyDb(): Database {
  if (!legacyDb) {
    // 기존 레거시 DB가 있으면 사용, 없으면 생성하지 않음
    if (existsSync(DB_PATH)) {
      legacyDb = new Database(DB_PATH)
      legacyDb.exec('PRAGMA journal_mode = WAL')
    } else {
      // 레거시 DB가 없으면 기본 프로젝트 사용
      // 이 경우는 새 설치이므로 레거시 호환 불필요
      throw new Error('Legacy database not found. Use getDatabase(projectPath) instead.')
    }
  }
  return legacyDb
}

// 레거시 호환 - 기존 db export
export const db = {
  prepare: (sql: string) => {
    try {
      return getLegacyDb().prepare(sql)
    } catch {
      // 레거시 DB가 없으면 빈 결과 반환
      return {
        get: () => null,
        all: () => [],
        run: () => {}
      }
    }
  },
  exec: (sql: string) => {
    try {
      return getLegacyDb().exec(sql)
    } catch {
      // 무시
    }
  }
}

// 레거시 호환 - sessions, prompts, responses (기존 API 호환)
// 주의: 이들은 레거시 DB만 조회합니다. 새 코드에서는 getDatabase(projectPath).sessions 등을 사용하세요.
export const sessions = {
  findBySessionId: (sessionId: string) => {
    try {
      const stmt = getLegacyDb().prepare('SELECT * FROM sessions WHERE session_id = ?')
      return stmt.get(sessionId)
    } catch { return null }
  },

  create: (sessionId: string, projectPath: string) => {
    try {
      const id = generateId()
      const stmt = getLegacyDb().prepare(`INSERT INTO sessions (id, session_id, project_path) VALUES (?, ?, ?)`)
      stmt.run(id, sessionId, projectPath)
      return sessions.findBySessionId(sessionId)
    } catch { return null }
  },

  stop: (sessionId: string) => {
    try {
      const stmt = getLegacyDb().prepare(`UPDATE sessions SET status = 'completed', ended_at = datetime('now') WHERE session_id = ?`)
      stmt.run(sessionId)
      return sessions.findBySessionId(sessionId)
    } catch { return null }
  },

  findAll: (limit = 50) => {
    try {
      const stmt = getLegacyDb().prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
      return stmt.all(limit)
    } catch { return [] }
  },

  count: () => {
    try {
      const stmt = getLegacyDb().prepare('SELECT COUNT(*) as count FROM sessions')
      return (stmt.get() as { count: number }).count
    } catch { return 0 }
  }
}

export const prompts = {
  create: (sessionId: string, content: string, metadata?: string) => {
    try {
      const id = generateId()
      const stmt = getLegacyDb().prepare(`INSERT INTO prompts (id, session_id, content, metadata) VALUES (?, ?, ?, ?)`)
      stmt.run(id, sessionId, content, metadata || null)
      const getStmt = getLegacyDb().prepare('SELECT * FROM prompts WHERE id = ?')
      return getStmt.get(id)
    } catch { return null }
  },

  findBySession: (sessionId: string, limit = 50) => {
    try {
      const stmt = getLegacyDb().prepare(`SELECT * FROM prompts WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`)
      return stmt.all(sessionId, limit)
    } catch { return [] }
  },

  findAll: (limit = 50) => {
    try {
      const stmt = getLegacyDb().prepare('SELECT * FROM prompts ORDER BY timestamp DESC LIMIT ?')
      return stmt.all(limit)
    } catch { return [] }
  },

  search: (query: string, limit = 10) => {
    try {
      const stmt = getLegacyDb().prepare(`SELECT * FROM prompts WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?`)
      return stmt.all(`%${query}%`, limit)
    } catch { return [] }
  },

  count: () => {
    try {
      const stmt = getLegacyDb().prepare('SELECT COUNT(*) as count FROM prompts')
      return (stmt.get() as { count: number }).count
    } catch { return 0 }
  }
}

export const responses = {
  create: (sessionId: string, content: string, metadata?: string) => {
    try {
      const id = generateId()
      const stmt = getLegacyDb().prepare(`INSERT INTO responses (id, session_id, content, metadata) VALUES (?, ?, ?, ?)`)
      stmt.run(id, sessionId, content, metadata || null)
      const getStmt = getLegacyDb().prepare('SELECT * FROM responses WHERE id = ?')
      return getStmt.get(id)
    } catch { return null }
  },

  findBySession: (sessionId: string, limit = 50) => {
    try {
      const stmt = getLegacyDb().prepare(`SELECT * FROM responses WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`)
      return stmt.all(sessionId, limit)
    } catch { return [] }
  },

  findAll: (limit = 50) => {
    try {
      const stmt = getLegacyDb().prepare('SELECT * FROM responses ORDER BY timestamp DESC LIMIT ?')
      return stmt.all(limit)
    } catch { return [] }
  },

  search: (query: string, limit = 10) => {
    try {
      const stmt = getLegacyDb().prepare(`SELECT * FROM responses WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?`)
      return stmt.all(`%${query}%`, limit)
    } catch { return [] }
  },

  findLastBySession: (sessionId: string) => {
    try {
      const stmt = getLegacyDb().prepare(`SELECT * FROM responses WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1`)
      return stmt.get(sessionId)
    } catch { return null }
  },

  count: () => {
    try {
      const stmt = getLegacyDb().prepare('SELECT COUNT(*) as count FROM responses')
      return (stmt.get() as { count: number }).count
    } catch { return 0 }
  }
}

export function rebuildFtsIndex() {
  console.log('[DB] Legacy rebuildFtsIndex called - no-op')
}
