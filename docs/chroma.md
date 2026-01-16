# Chroma Vector DB 연동

jikime-mem은 SQLite와 Chroma Vector DB를 결합한 하이브리드 검색을 지원합니다.

## 개요

### 왜 하이브리드 검색인가?

- **SQLite**: 빠른 키워드 검색, 메타데이터 필터링
- **Chroma**: 시맨틱(의미 기반) 검색, 유사도 순위

두 방식을 결합하면 "useState"라는 정확한 키워드뿐만 아니라 "React 상태 관리 훅"처럼 의미적으로 유사한 쿼리로도 관련 데이터를 찾을 수 있습니다.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      jikime-mem Worker                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│   │   Prompts   │     │ Observations│     │  Responses  │  │
│   └──────┬──────┘     └──────┬──────┘     └──────┬──────┘  │
│          │                   │                   │          │
│          └───────────────────┼───────────────────┘          │
│                              │                              │
│                              ▼                              │
│                    ┌─────────────────┐                      │
│                    │    db.ts        │                      │
│                    │  (SQLite 저장)   │                      │
│                    └────────┬────────┘                      │
│                             │                               │
│              Fire-and-Forget│(비동기)                        │
│                             ▼                               │
│                    ┌─────────────────┐                      │
│                    │  ChromaSync     │                      │
│                    │  (chroma.ts)    │                      │
│                    └────────┬────────┘                      │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │ MCP Protocol
                              ▼
                    ┌─────────────────┐
                    │   chroma-mcp    │
                    │  (uvx 실행)     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Chroma Vector  │
                    │      DB         │
                    │ ~/.jikime-mem/  │
                    │   vector-db/    │
                    └─────────────────┘
```

## 요구사항

### 필수 설치

1. **uv** (Python 패키지 관리자)
   ```bash
   # macOS
   brew install uv

   # Linux/Windows
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Python 3.12**
   ```bash
   # uv가 자동으로 관리하지만, 수동 설치도 가능
   uv python install 3.12
   ```

### 데이터 저장 위치

```
~/.jikime-mem/
├── jikime-mem.db      # SQLite 데이터베이스
└── vector-db/         # Chroma 벡터 데이터베이스
```

## 데이터 동기화

### 자동 동기화

데이터 저장 시 SQLite와 Chroma에 자동으로 동기화됩니다:

| 데이터 타입 | SQLite 함수 | Chroma 동기화 |
|------------|-------------|--------------|
| 프롬프트 | `prompts.create()` | `syncPrompt()` |
| 응답 | `responses.create()` | `syncResponse()` |
| 관찰 | `observations.create()` | `syncObservation()` |
| 요약 | `contextSummaries.upsert()` | `syncSummary()` |

### Fire-and-Forget 패턴

Chroma 동기화는 메인 작업을 블로킹하지 않습니다:

```typescript
// db.ts 예시
const result = getStmt.get(id) as any

// Chroma 동기화 (fire-and-forget)
if (result) {
  getChromaSync().syncPrompt(
    result.id,
    sessionId,
    content,
    result.timestamp
  ).catch(err => console.error('[DB] Chroma sync failed:', err))
}

return result  // 즉시 반환
```

### Chroma 문서 구조

각 데이터 타입별 Chroma 문서 형식:

**프롬프트**
```json
{
  "id": "prompt_mkgv68es5wt3nrv",
  "document": "React 컴포넌트에서 useState 훅을 사용하는 방법을 알려줘",
  "metadata": {
    "sqlite_id": "mkgv68es5wt3nrv",
    "doc_type": "prompt",
    "session_id": "test-session-001",
    "created_at": "2026-01-16 12:37:54"
  }
}
```

**관찰 (도구 사용)**
```json
// 도구 입력
{
  "id": "observation_xxx_input",
  "document": "[Read] {\"file_path\": \"/src/App.tsx\"}",
  "metadata": {
    "doc_type": "observation_input",
    "tool_name": "Read"
  }
}

// 도구 응답 (청크 분할)
{
  "id": "observation_xxx_response_0",
  "document": "파일 내용...",
  "metadata": {
    "doc_type": "observation_response",
    "chunk_index": 0,
    "total_chunks": 1
  }
}
```

## 검색 API

### 엔드포인트

```
POST /api/search
```

### 요청 파라미터

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------|------|------|--------|------|
| `query` | string | ✅ | - | 검색어 |
| `limit` | number | - | 10 | 결과 수 |
| `type` | string | - | all | prompt, observation, response, summary |
| `method` | string | - | hybrid | sqlite, semantic, hybrid |

### 검색 방법 비교

| 방법 | 설명 | 장점 | 단점 |
|-----|------|------|------|
| `sqlite` | LIKE 기반 키워드 검색 | 빠름, 정확한 문자열 매칭 | 의미 파악 불가 |
| `semantic` | Chroma 벡터 검색 | 의미 기반 검색 | 초기 연결 느림 |
| `hybrid` | 두 방식 결합 | 최고의 검색 품질 | 리소스 사용 증가 |

### 사용 예시

**1. 키워드 검색 (SQLite)**
```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "useState", "method": "sqlite"}'
```

**2. 시맨틱 검색 (Chroma)**
```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "React 상태 관리 훅 사용법", "method": "semantic"}'
```

**3. 하이브리드 검색 (기본)**
```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "useState", "limit": 10}'
```

### 응답 형식

```json
{
  "results": [
    {
      "type": "prompt",
      "data": {
        "id": "mkgv68es5wt3nrv",
        "session_id": "test-session-001",
        "content": "React 컴포넌트에서 useState 훅을 사용하는 방법을 알려줘",
        "timestamp": "2026-01-16 12:37:54"
      },
      "similarity": 0.677,
      "source": "hybrid",
      "chroma_id": "prompt_mkgv68es5wt3nrv"
    }
  ],
  "total": 1,
  "query": "useState",
  "method": "hybrid"
}
```

### 유사도 점수

| source | similarity 범위 | 설명 |
|--------|----------------|------|
| sqlite | 0.5 (고정) | LIKE 매칭은 이진 결과 |
| chroma | 0.0 ~ 1.0 | 벡터 거리 기반 (높을수록 유사) |
| hybrid | 0.0 ~ 1.0 | Chroma 유사도 사용 |

## MCP 서버 연동

Claude Desktop에서 MCP를 통해 검색할 수 있습니다.

### 검색 도구

```json
{
  "name": "search",
  "description": "하이브리드 메모리 검색",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "limit": { "type": "number" },
      "type": { "enum": ["prompt", "observation", "response", "summary"] },
      "method": { "enum": ["sqlite", "semantic", "hybrid"] }
    },
    "required": ["query"]
  }
}
```

### 사용 예시 (Claude Desktop)

```
"이전에 useState에 대해 물어본 적 있어?"
→ search 도구 호출: { "query": "useState", "method": "hybrid" }
```

## 문제 해결

### Chroma 연결 실패

**증상**: `[ChromaSync] Failed to connect` 오류

**해결**:
1. uv 설치 확인: `which uvx`
2. Python 3.12 확인: `uvx --python 3.12 python --version`
3. chroma-mcp 수동 테스트:
   ```bash
   uvx --python 3.12 chroma-mcp --help
   ```

### 시맨틱 검색 결과 없음

**증상**: `method: "semantic"` 검색 시 빈 결과

**원인**:
- Chroma에 데이터가 동기화되지 않음
- 첫 연결 시 시간이 필요함

**해결**:
1. Worker 로그 확인: `[ChromaSync] Prompt synced` 메시지 확인
2. 데이터 저장 후 5-10초 대기
3. SQLite 검색으로 데이터 존재 확인 후 시맨틱 검색

### 벡터 DB 초기화

데이터를 완전히 삭제하고 싶다면:

```bash
rm -rf ~/.jikime-mem/vector-db
```

다음 Worker 시작 시 자동으로 재생성됩니다.

## 성능 고려사항

### 초기 연결 시간

- chroma-mcp 첫 연결: 3-5초 소요
- 이후 연결: 캐시되어 즉시 연결

### 청크 분할

긴 텍스트는 2000자 단위로 청크 분할됩니다:
- 응답: `response_xxx_0`, `response_xxx_1`, ...
- 관찰: `observation_xxx_response_0`, ...

### 배치 처리

100개 단위로 배치 처리하여 대량 데이터도 효율적으로 처리합니다.
