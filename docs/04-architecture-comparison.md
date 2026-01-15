# 아키텍처 비교: claude-mem vs jikime-mem

## 개요

claude-mem과 jikime-mem의 아키텍처 차이점을 분석합니다.

## 전체 아키텍처 비교

### claude-mem

```
Claude Code
    ↓ Hooks
Worker Service (localhost:37777)
    ↓
SDK Agent (Claude API) ← AI 처리
    ↓
SQLite Database
    ↓
Chroma (Vector DB) ← 시맨틱 검색
```

### jikime-mem

```
Claude Code
    ↓ Hooks
Worker Service (localhost:37888)
    ↓
SQLite Database (AI 처리 없음)
```

## 기능 비교

| 기능 | claude-mem | jikime-mem |
|------|-----------|------------|
| 세션 관리 | ✅ | ✅ |
| 프롬프트 저장 | ✅ + AI 분석 | ✅ 원본 저장 |
| 도구 사용 기록 | ✅ + AI 압축 | ✅ 원본 저장 |
| Claude 응답 저장 | ✅ | ✅ |
| 세션 요약 | AI 기반 | 통계 기반 |
| 컨텍스트 주입 | 스마트 | 단순 |
| 시맨틱 검색 | Chroma | SQLite LIKE |
| 웹 뷰어 | ✅ | ✅ |
| MCP Server | ✅ | 예정 |

## 데이터 처리 비교

### 프롬프트 처리

```
claude-mem:
"React 컴포넌트에서 상태 관리하는 방법 알려줘"
    ↓ AI 분석
{ intent: "learning", topic: "React state", category: "frontend" }

jikime-mem:
"React 컴포넌트에서 상태 관리하는 방법 알려줘"
    ↓ 그대로 저장
"React 컴포넌트에서 상태 관리하는 방법 알려줘"
```

### Observation 처리

```
claude-mem:
{
  tool: "Read",
  input: { file: "app.tsx" },
  output: "... 500줄 코드 ..." (10,000 토큰)
}
    ↓ AI 압축
"React 앱 메인 컴포넌트. useState, useEffect 사용." (50 토큰)

jikime-mem:
{
  tool: "Read",
  input: { file: "app.tsx" },
  output: "... 500줄 코드 ..." (10,000 토큰)
}
    ↓ 그대로 저장 (truncate to 10,000자)
"... 500줄 코드 ..."
```

### 세션 요약

```
claude-mem (AI 기반):
"사용자가 React 인증 시스템 구현을 요청함.
 JWT 기반 로그인/로그아웃 기능을 구현하고
 테스트를 완료함. 보안 취약점 없음 확인."

jikime-mem (통계 기반):
"## 세션 요약
 - 프롬프트: 3개
 - 도구 사용: Read 5회, Edit 3회, Bash 2회"
```

## 비용 비교

| 항목 | claude-mem | jikime-mem |
|------|-----------|------------|
| 기본 사용 | 무료 | 무료 |
| AI 처리 | API 비용 발생 | 무료 |
| 저장 용량 | 작음 (압축) | 큼 (원본) |
| 컨텍스트 품질 | 높음 | 보통 |

## 설정 비교

### claude-mem settings.json

```json
{
  "ai": {
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-..."
  },
  "compression": {
    "enabled": true,
    "threshold": 1000
  },
  "chroma": {
    "enabled": true
  }
}
```

### jikime-mem (현재)

설정 파일 없음 - 하드코딩된 기본값 사용

## 장단점

### claude-mem

**장점:**
- 스마트한 컨텍스트 생성
- 토큰 효율적 (AI 압축)
- 시맨틱 검색 지원

**단점:**
- 설정 복잡
- API 비용 발생
- 의존성 많음 (SDK, Chroma, uv)

### jikime-mem

**장점:**
- 심플한 구조
- 무료 (AI 비용 없음)
- 원본 데이터 보존
- 빠른 처리

**단점:**
- 기본적인 검색만 지원
- 컨텍스트 품질 낮음
- 저장 용량 큼

## 결론

| 사용 사례 | 추천 |
|----------|------|
| 개인 프로젝트, 비용 절감 | jikime-mem |
| 대규모 프로젝트, 스마트 기능 | claude-mem |
| 원본 데이터 보존 필요 | jikime-mem |
| 토큰 효율성 중요 | claude-mem |
