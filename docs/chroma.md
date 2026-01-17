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

### 유사도 계산

Chroma는 코사인 거리(cosine distance)를 사용합니다:

| 거리(distance) | 의미 | 유사도(similarity) |
|----------------|------|-------------------|
| 0 | 동일 | 100% |
| 1 | 무관 | 50% |
| 2 | 반대 | 0% |

**변환 공식**:
```
similarity = 1 - (distance / 2)
```

### 유사도 임계값

시맨틱 검색은 **70% 이상 유사도**만 반환합니다:

```typescript
const SIMILARITY_THRESHOLD = 0.7  // 70%
```

- `limit`는 **최대 결과 수**를 의미합니다
- 유사도가 70% 미만인 결과는 limit에 관계없이 제외됩니다
- 예: "안녕" 검색 시 100%, 93% 결과만 반환 (70% 미만은 제외)

## 상태 확인 API

### 전체 통계

```
GET /api/stats
```

**응답**:
```json
{
  "sessions": 5,
  "prompts": 42,
  "responses": 38,
  "total": 85
}
```

### Chroma 상태

```
GET /api/chroma/status
```

**응답**:
```json
{
  "status": "connected",
  "collection": "jm__jikime_mem",
  "message": "Chroma is available",
  "sample_count": 1
}
```

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
      "type": { "enum": ["prompt", "response"] },
      "method": { "enum": ["sqlite", "semantic", "hybrid"] }
    },
    "required": ["query"]
  }
}
```

### Chroma 상태 확인 도구

```json
{
  "name": "get_chroma_status",
  "description": "Chroma Vector DB 상태 확인"
}
```

### 통계 확인 도구

```json
{
  "name": "get_stats",
  "description": "전체 통계 조회 (세션 수, 프롬프트 수, 응답 수 등)"
}
```

### 사용 예시 (Claude Desktop)

```
"이전에 useState에 대해 물어본 적 있어?"
→ search 도구 호출: { "query": "useState", "method": "hybrid" }

"Chroma 상태 어때?"
→ get_chroma_status 도구 호출

"지금까지 저장된 데이터 통계 보여줘"
→ get_stats 도구 호출
```

## CLI 도구 (chroma-cli.py)

소스 코드가 있는 환경에서 Chroma 데이터를 직접 확인할 수 있습니다.

### 설치 요구사항

- Python 3.12
- uv (uvx 명령어 사용)

### 사용법

**1. 컬렉션 상태 확인**
```bash
npm run chroma:status
```

출력 예시:
```
==================================================
📊 Chroma Status
==================================================
📁 Data Directory: /Users/username/.jikime-mem/vector-db

📚 Collections (1):
   • jm__jikime_mem: 15 documents
```

**2. 문서 목록 조회**
```bash
npm run chroma:list        # 기본 10개
npm run chroma:list 20     # 20개 조회
```

출력 예시:
```
==================================================
📄 Documents (showing 10 of 15)
==================================================

📝 [1] prompt_abc123
   Type: prompt | Session: test-ses...
   Content: React 컴포넌트에서 useState 훅을 사용하는 방법...
```

**3. 시맨틱 검색**
```bash
npm run chroma:search "검색어"
npm run chroma:search "React 상태 관리" 5   # 5개 결과
```

출력 예시:
```
==================================================
🔍 Search: "안녕"
==================================================

📝 [1] 100.0% match
   ID: prompt_xxx
   Type: prompt
   Content: 안녕

📝 [2] 93.2% match
   ID: prompt_yyy
   Type: prompt
   Content: 또다른 안녕.
```

**4. 문서 타입별 통계**
```bash
npm run chroma:types
```

출력 예시:
```
==================================================
📈 Document Types Statistics
==================================================

📊 By Type (Total: 15):
   📝 prompt: 8
   💬 response: 7

📊 By Session (Top 5):
   📁 abc123def456...: 10 documents
   📁 xyz789abc012...: 5 documents
```

### 직접 실행

npm 명령어 대신 직접 실행도 가능합니다:

```bash
uvx --python 3.12 --with chromadb python scripts/chroma-cli.py status
uvx --python 3.12 --with chromadb python scripts/chroma-cli.py list
uvx --python 3.12 --with chromadb python scripts/chroma-cli.py search "쿼리"
uvx --python 3.12 --with chromadb python scripts/chroma-cli.py types
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
- 유사도가 70% 임계값 미만

**해결**:
1. Worker 로그 확인: `[ChromaSync] Prompt synced` 메시지 확인
2. 데이터 저장 후 5-10초 대기
3. SQLite 검색으로 데이터 존재 확인 후 시맨틱 검색
4. Chroma 상태 확인: `npm run chroma:status` 또는 `/api/chroma/status`

### 시맨틱 검색 결과가 예상보다 적음

**증상**: limit을 10으로 설정했는데 2-3개만 반환

**원인**: 유사도 70% 임계값 필터링

**설명**:
- `limit`는 **최대** 반환 수입니다
- 유사도 70% 미만인 결과는 제외됩니다
- 이는 관련성 높은 결과만 반환하기 위한 정상 동작입니다

**확인 방법**:
```bash
# CLI로 원본 유사도 확인 (임계값 없이)
npm run chroma:search "검색어"
```

### Chroma 상태 확인 방법

**플러그인 환경** (소스 코드 없음):
```bash
# API 호출
curl http://127.0.0.1:37888/api/chroma/status

# MCP 도구 사용 (Claude Code에서)
# get_chroma_status 도구 호출
```

**개발 환경** (소스 코드 있음):
```bash
npm run chroma:status
npm run chroma:types
```

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
