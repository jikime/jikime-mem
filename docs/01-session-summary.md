# 세션 요약 기능

## 개요

세션 종료 시 자동으로 세션 요약을 생성하여 저장하는 기능입니다.

## 구현 방식

### 통계 기반 요약 (현재)

AI를 사용하지 않고 수집된 데이터를 기반으로 통계 요약을 생성합니다.

```typescript
// db.ts - generateSummary()
export function generateSummary(sessionId: string): string {
  const session = sessions.findBySessionId(sessionId)
  const sessionPrompts = prompts.findBySession(sessionId, 100)
  const sessionObservations = observations.findBySession(sessionId, 100)

  // 도구 사용 통계 집계
  const toolStats: Record<string, number> = {}
  for (const obs of sessionObservations) {
    toolStats[obs.tool_name] = (toolStats[obs.tool_name] || 0) + 1
  }

  // 요약 텍스트 생성
  return `
## 세션 요약
- 프로젝트: ${session.project_path}
- 시작: ${session.started_at}
- 종료: ${session.ended_at}

### 프롬프트 (${sessionPrompts.length}개)
${sessionPrompts.slice(0, 5).map(p => `- ${p.content.substring(0, 50)}...`).join('\n')}

### 도구 사용 (${sessionObservations.length}회)
${Object.entries(toolStats).map(([tool, count]) => `- ${tool}: ${count}회`).join('\n')}
  `
}
```

### AI 기반 요약 (예정)

Claude Code headless를 활용한 의미 분석 기반 요약.

```typescript
// 예정된 구현
claude --headless -p "다음 세션 데이터를 분석해서 요약해줘: ${sessionData}"
```

## API 엔드포인트

```
POST /api/sessions/summarize
Body: { sessionId: string }
Response: { contextSummary: {...}, generated: true }

GET /api/summaries?limit=50
Response: { summaries: [...] }
```

## 데이터베이스 스키마

```sql
CREATE TABLE context_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  summary TEXT NOT NULL,
  tokens INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## 훅 통합

```typescript
// summarize 훅에서 자동 호출
case 'summarize':
  // 1. Claude 응답 저장
  // 2. 세션 요약 생성 ← 여기서 호출
  await fetch(`${API_BASE}/api/sessions/summarize`, {
    method: 'POST',
    body: JSON.stringify({ sessionId })
  })
  // 3. 세션 종료
```

## 비교: 통계 기반 vs AI 기반

| 항목 | 통계 기반 | AI 기반 |
|------|----------|---------|
| 비용 | 무료 | API 호출 비용 |
| 속도 | 빠름 | 느림 |
| 품질 | 단순 나열 | 의미 분석 |
| 예시 | "Read 도구 5회 사용" | "사용자의 로그인 버그를 수정했음" |
