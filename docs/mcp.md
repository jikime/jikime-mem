# jikime-mem MCP Server

MCP (Model Context Protocol) 서버를 통해 Claude Desktop이나 다른 Claude 인스턴스에서 jikime-mem 메모리 검색 기능을 사용할 수 있습니다.

## 개요

MCP 서버는 jikime-mem Worker API를 MCP 프로토콜로 래핑하여 외부 Claude 클라이언트에서 접근할 수 있게 해줍니다.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Desktop │────▶│   MCP Server    │────▶│  Worker API     │
│  (또는 다른     │     │  (stdio 통신)   │     │  (HTTP :37778)  │
│   MCP 클라이언트)│◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 설치

### 필수 조건

1. jikime-mem 플러그인이 설치되어 있어야 합니다
2. Worker 서비스가 실행 중이어야 합니다

```bash
# Worker 상태 확인
curl http://127.0.0.1:37778/api/health
# 응답: {"status":"ok"}
```

## Claude Desktop 설정

### macOS

`~/Library/Application Support/Claude/claude_desktop_config.json` 파일을 편집합니다:

```json
{
  "mcpServers": {
    "jikime-mem": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/.claude/plugins/cache/jikime/jikime-mem/VERSION/scripts/mcp-server.js"
      ]
    }
  }
}
```

> **참고**: `YOUR_USERNAME`과 `VERSION`을 실제 값으로 변경하세요.

### Windows

`%APPDATA%\Claude\claude_desktop_config.json` 파일을 편집합니다:

```json
{
  "mcpServers": {
    "jikime-mem": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USERNAME\\.claude\\plugins\\cache\\jikime\\jikime-mem\\VERSION\\scripts\\mcp-server.js"
      ]
    }
  }
}
```

### 설정 후

Claude Desktop을 재시작하면 MCP 도구가 활성화됩니다.

## MCP 도구 목록

| 도구 | 설명 | 파라미터 |
|-----|------|----------|
| `search` | 메모리 검색 (프롬프트, 응답, 관찰) | `query` (필수), `limit` |
| `get_sessions` | 세션 목록 조회 | `limit` |
| `get_prompts` | 프롬프트 목록 조회 | `limit`, `session_id` |
| `get_responses` | 응답 목록 조회 | `limit`, `session_id` |
| `get_observations` | 관찰(도구 사용) 목록 조회 | `limit`, `session_id` |
| `get_summaries` | 세션 요약 목록 조회 | `limit` |
| `get_stats` | 전체 통계 조회 | - |

## 사용 예시

Claude Desktop에서 다음과 같이 질문하면 자동으로 MCP 도구가 호출됩니다:

- "지난 작업 내역을 검색해줘"
- "최근 세션 목록을 보여줘"
- "API 관련 작업을 찾아줘"
- "전체 통계를 알려줘"

### 도구 직접 호출

```
search(query="authentication", limit=10)
get_sessions(limit=5)
get_prompts(session_id="abc123")
get_stats()
```

## 아키텍처

### 파일 구조

```
jikime-mem/
├── src/mcp/
│   └── mcp-server.ts      # MCP 서버 소스
├── plugin/scripts/
│   └── mcp-server.js      # 빌드된 MCP 서버
└── .mcp.json              # MCP 설정 파일
```

### 통신 흐름

1. Claude Desktop이 MCP 서버를 stdio로 실행
2. MCP 서버가 도구 호출을 수신
3. Worker API (HTTP)로 요청 전달
4. 결과를 MCP 형식으로 반환

### 의존성

- `@modelcontextprotocol/sdk` - MCP 프로토콜 SDK

## 개발

### 빌드

```bash
bun run build
```

빌드 후 `plugin/scripts/mcp-server.js`가 생성됩니다.

### 로컬 테스트

```bash
# MCP 서버 직접 실행 (stdio 모드)
node plugin/scripts/mcp-server.js

# Worker가 실행 중이어야 합니다
npm run worker:start
```

## 문제 해결

### MCP 서버가 연결되지 않음

1. Worker 서비스 실행 확인:
   ```bash
   npm run worker:status
   ```

2. Worker 재시작:
   ```bash
   npm run worker:restart
   ```

3. Claude Desktop 재시작

### 도구가 표시되지 않음

1. `claude_desktop_config.json` 경로 확인
2. MCP 서버 경로가 올바른지 확인
3. JSON 구문 오류 확인

### 검색 결과가 없음

1. 데이터베이스에 데이터가 있는지 확인:
   ```bash
   curl http://127.0.0.1:37778/api/stats
   ```

2. Worker 로그 확인:
   ```bash
   npm run worker:logs
   ```

## 버전 히스토리

| 버전 | 변경 사항 |
|-----|----------|
| 1.3.0 | MCP 서버 최초 구현 |

## 관련 문서

- [jikime-mem README](../README.md)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
