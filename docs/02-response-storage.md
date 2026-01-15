# Claude 응답 저장 기능

## 개요

Claude의 응답 내용을 transcript 파일에서 추출하여 데이터베이스에 저장하는 기능입니다.

## 핵심 인사이트

**AI 분석 요약 없이도 응답 내용 자체는 저장 가능합니다.**

```
[데이터 수집]
프롬프트 → 저장 ✅
도구 사용 → 저장 ✅
Claude 응답 → 저장 ✅ (transcript에서 추출)
```

## Transcript 파일

Claude Code는 세션 대화를 JSONL 형식으로 저장합니다.

```
경로: ~/.claude/projects/{project-path-dashed}/{session-id}.jsonl
```

```jsonl
{"type":"user","message":{"content":"파일을 읽어줘"}}
{"type":"assistant","message":{"content":"네, 파일을 읽겠습니다..."}}
{"type":"user","message":{"content":[{"type":"tool_result",...}]}}
{"type":"assistant","message":{"content":"파일 내용은 다음과 같습니다..."}}
```

## 구현

### transcript-parser.ts

```typescript
export function extractLastMessage(
  transcriptPath: string,
  role: 'user' | 'assistant',
  stripSystemReminders: boolean = false
): string {
  const content = readFileSync(transcriptPath, 'utf-8').trim()
  const lines = content.split('\n')

  // 역순으로 검색하여 마지막 메시지 찾기
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = JSON.parse(lines[i])
    if (line.type === role) {
      // text 타입 content만 추출
      // system-reminder 태그 제거 (옵션)
      return extractText(line.message.content)
    }
  }
}
```

### 훅에서 사용

```typescript
case 'summarize':
  const transcriptPath = hookData.transcript_path

  if (transcriptPath) {
    // transcript에서 마지막 Claude 응답 추출
    const lastResponse = extractLastAssistantMessage(transcriptPath)

    // DB에 저장
    await fetch(`${API_BASE}/api/responses`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, content: lastResponse })
    })
  }
```

## API 엔드포인트

```
POST /api/responses
Body: { sessionId: string, content: string, metadata?: string }

GET /api/responses?sessionId=xxx&limit=50
Response: { responses: [...] }
```

## 데이터베이스 스키마

```sql
CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE INDEX idx_responses_session ON responses(session_id);
CREATE INDEX idx_responses_timestamp ON responses(timestamp);
```

## 장점

| 항목 | 설명 |
|------|------|
| **비용 무료** | AI API 호출 없음 |
| **원본 보존** | Claude가 실제로 한 작업 기록 |
| **검색 가능** | "어떤 작업 했었지?" 검색 가능 |
| **나중에 AI 요약 가능** | 저장된 내용으로 언제든 AI 요약 추가 가능 |

## 웹 뷰어

Responses 탭에서 저장된 Claude 응답을 확인할 수 있습니다.

```
┌─────────────────────────────────────┐
│ Sessions | Prompts | Observations | │
│ [Responses] | Summaries | Search   │
├─────────────────────────────────────┤
│ 💬 Response                         │
│ 2026-01-15 17:08:31                │
│                                     │
│ 네, 파일을 읽겠습니다. 해당 파일은   │
│ React 컴포넌트로 구성되어 있으며...   │
│                                     │
│ Session: 29f1af35...               │
│ Length: 2,450 chars                │
└─────────────────────────────────────┘
```
