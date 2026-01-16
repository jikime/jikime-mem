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
    compressed TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    duration INTEGER,
    status TEXT DEFAULT 'success',
    metadata TEXT
  );

  -- 컨텍스트 요약 테이블
  CREATE TABLE IF NOT EXISTS context_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    summary TEXT NOT NULL,
    ai_summary TEXT,
    summary_type TEXT DEFAULT 'stats',
    tokens INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
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
    const stmt = db.prepare(`
      SELECT * FROM prompts WHERE content LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(`%${query}%`, limit)
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
    const stmt = db.prepare(`
      SELECT * FROM observations
      WHERE tool_name LIKE ? OR tool_input LIKE ? OR tool_response LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(`%${query}%`, `%${query}%`, `%${query}%`, limit)
  },

  // AI 압축 결과 업데이트
  updateCompressed(id: string, compressed: string) {
    const stmt = db.prepare('UPDATE observations SET compressed = ? WHERE id = ?')
    stmt.run(compressed, id)
  },

  // 압축되지 않은 observation 조회
  findUncompressed(limit = 10) {
    const stmt = db.prepare(`
      SELECT * FROM observations
      WHERE compressed IS NULL AND LENGTH(tool_response) > 500
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(limit)
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
    const stmt = db.prepare(`
      SELECT * FROM responses WHERE content LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `)
    return stmt.all(`%${query}%`, limit)
  },

  // 세션의 마지막 응답 조회
  findLastBySession(sessionId: string) {
    const stmt = db.prepare(`
      SELECT * FROM responses WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `)
    return stmt.get(sessionId)
  }
}

// 컨텍스트 요약 관련 함수
export const contextSummaries = {
  upsert(sessionId: string, summary: string, tokens?: number) {
    const existing = db.prepare('SELECT * FROM context_summaries WHERE session_id = ?').get(sessionId)

    if (existing) {
      db.prepare(`
        UPDATE context_summaries SET summary = ?, tokens = ?, created_at = datetime('now')
        WHERE session_id = ?
      `).run(summary, tokens || null, sessionId)
    } else {
      const id = generateId()
      db.prepare(`
        INSERT INTO context_summaries (id, session_id, summary, tokens)
        VALUES (?, ?, ?, ?)
      `).run(id, sessionId, summary, tokens || null)
    }

    const result = db.prepare('SELECT * FROM context_summaries WHERE session_id = ?').get(sessionId) as any

    // Chroma 동기화 (fire-and-forget)
    if (result) {
      getChromaSync().syncSummary(
        result.id,
        sessionId,
        summary,
        result.ai_summary,
        result.created_at
      ).catch(err => console.error('[DB] Chroma sync failed for summary:', err))
    }

    return result
  },

  findBySession(sessionId: string) {
    return db.prepare('SELECT * FROM context_summaries WHERE session_id = ?').get(sessionId)
  },

  findAll(limit = 50) {
    const stmt = db.prepare('SELECT * FROM context_summaries ORDER BY created_at DESC LIMIT ?')
    return stmt.all(limit)
  },

  // 세션 데이터를 기반으로 자동 요약 생성
  generateSummary(sessionId: string): string {
    // 세션 정보 조회
    const session = sessions.findBySessionId(sessionId) as any
    if (!session) {
      return `세션 ${sessionId}에 대한 정보가 없습니다.`
    }

    // 프롬프트 조회
    const sessionPrompts = prompts.findBySession(sessionId, 100) as any[]

    // 관찰 조회
    const sessionObservations = observations.findBySession(sessionId, 100) as any[]

    // 도구 사용 통계
    const toolStats: Record<string, number> = {}
    for (const obs of sessionObservations) {
      toolStats[obs.tool_name] = (toolStats[obs.tool_name] || 0) + 1
    }

    // 요약 생성
    const lines: string[] = []

    lines.push(`## 세션 요약`)
    lines.push(`- 프로젝트: ${session.project_path}`)
    lines.push(`- 시작: ${session.started_at}`)
    if (session.ended_at) {
      lines.push(`- 종료: ${session.ended_at}`)
    }
    lines.push(`- 상태: ${session.status}`)
    lines.push('')

    // 프롬프트 요약
    lines.push(`### 프롬프트 (${sessionPrompts.length}개)`)
    if (sessionPrompts.length > 0) {
      // 최근 5개 프롬프트만 표시
      const recentPrompts = sessionPrompts.slice(0, 5)
      for (const p of recentPrompts) {
        const content = p.content.length > 100
          ? p.content.substring(0, 100) + '...'
          : p.content
        lines.push(`- ${content}`)
      }
      if (sessionPrompts.length > 5) {
        lines.push(`- ... 외 ${sessionPrompts.length - 5}개`)
      }
    } else {
      lines.push(`- (없음)`)
    }
    lines.push('')

    // 도구 사용 요약
    lines.push(`### 도구 사용 (${sessionObservations.length}회)`)
    if (Object.keys(toolStats).length > 0) {
      const sortedTools = Object.entries(toolStats)
        .sort((a, b) => b[1] - a[1])
      for (const [tool, count] of sortedTools) {
        lines.push(`- ${tool}: ${count}회`)
      }
    } else {
      lines.push(`- (없음)`)
    }

    return lines.join('\n')
  },

  // AI 요약 업데이트
  updateAiSummary(sessionId: string, aiSummary: string) {
    const stmt = db.prepare(`
      UPDATE context_summaries
      SET ai_summary = ?, summary_type = 'ai'
      WHERE session_id = ?
    `)
    stmt.run(aiSummary, sessionId)
  },

  // AI 요약이 없는 세션 조회
  findWithoutAiSummary(limit = 10) {
    const stmt = db.prepare(`
      SELECT * FROM context_summaries
      WHERE ai_summary IS NULL
      ORDER BY created_at DESC LIMIT ?
    `)
    return stmt.all(limit)
  }
}

// 마이그레이션: 기존 테이블에 새 컬럼 추가
try {
  db.exec('ALTER TABLE observations ADD COLUMN compressed TEXT')
} catch {}
try {
  db.exec('ALTER TABLE context_summaries ADD COLUMN ai_summary TEXT')
} catch {}
try {
  db.exec('ALTER TABLE context_summaries ADD COLUMN summary_type TEXT DEFAULT "stats"')
} catch {}
