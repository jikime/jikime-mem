# 훅 시스템 아키텍처

## 개요

Claude Code 플러그인은 5가지 라이프사이클 훅을 제공합니다. jikime-mem은 claude-mem과 동일한 훅 구조를 사용합니다.

## 훅 라이프사이클

```
SessionStart (세션 시작)
    ↓
UserPromptSubmit (사용자 입력)
    ↓
PostToolUse (도구 사용 후) ← 반복
    ↓
Stop (세션 종료)
```

## hooks.json 구조

```json
{
  "description": "jikime-mem memory system hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          { "command": "... hook context", "timeout": 60 },
          { "command": "... hook user-message", "timeout": 60 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "command": "... hook session-init", "timeout": 60 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "command": "... hook observation", "timeout": 120 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "command": "... hook summarize", "timeout": 120 }
        ]
      }
    ]
  }
}
```

## 훅별 기능

### context (SessionStart)

이전 세션 컨텍스트를 Claude에게 주입합니다.

```typescript
case 'context':
  // 세션 시작
  await fetch(`${API_BASE}/api/sessions/start`, {...})

  // 이전 세션 컨텍스트 조회
  const contextRes = await fetch(`${API_BASE}/api/context?limit=5`)
  const contextData = await contextRes.json()

  // 컨텍스트를 stdout으로 출력 (Claude에게 전달)
  if (contextData.context) {
    console.log(contextData.context)
  }
```

**출력 예시:**
```xml
<jikime-mem-context>
# 이전 세션 컨텍스트

## 세션: 29f1af35...
- 생성일: 2026-01-15 16:37:47

## 세션 요약
- 프로젝트: /Users/jikime/project
- 프롬프트 (2개)
- 도구 사용 (23회)
</jikime-mem-context>
```

### user-message (SessionStart)

사용자에게 메시지를 표시합니다 (현재는 로그만).

```typescript
case 'user-message':
  log(`User message hook for session: ${sessionId}`)
```

### session-init (UserPromptSubmit)

사용자 프롬프트를 저장합니다.

```typescript
case 'session-init':
  if (hookData.prompt) {
    await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, content: hookData.prompt })
    })
  }
```

### observation (PostToolUse)

도구 사용을 기록합니다.

```typescript
case 'observation':
  if (hookData.tool_name) {
    await fetch(`${API_BASE}/api/observations`, {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        toolName: hookData.tool_name,
        toolInput: hookData.tool_input,
        toolResponse: hookData.tool_response?.substring(0, 10000)
      })
    })
  }
```

### summarize (Stop)

세션 요약 생성 및 종료 처리.

```typescript
case 'summarize':
  // 1. Claude 응답 저장 (transcript에서 추출)
  const transcriptPath = hookData.transcript_path
  if (transcriptPath) {
    const lastResponse = extractLastAssistantMessage(transcriptPath)
    await fetch(`${API_BASE}/api/responses`, {...})
  }

  // 2. 세션 요약 생성
  await fetch(`${API_BASE}/api/sessions/summarize`, {...})

  // 3. 세션 종료
  await fetch(`${API_BASE}/api/sessions/stop`, {...})
```

## 훅 입력 데이터

Claude Code가 훅에 전달하는 stdin JSON:

```typescript
interface HookInput {
  session_id: string        // 세션 ID
  cwd: string               // 현재 작업 디렉토리
  prompt?: string           // 사용자 프롬프트 (UserPromptSubmit)
  tool_name?: string        // 도구 이름 (PostToolUse)
  tool_input?: object       // 도구 입력 (PostToolUse)
  tool_response?: string    // 도구 응답 (PostToolUse)
  transcript_path?: string  // 대화 기록 파일 경로 (Stop)
}
```

## 훅 출력 형식

```typescript
// 기본 응답
{ "continue": true }

// 컨텍스트 주입 (SessionStart)
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "..."
  }
}
```

## claude-mem vs jikime-mem 훅 매핑

| Hook Event | claude-mem | jikime-mem |
|------------|-----------|------------|
| SessionStart | context, user-message | context, user-message |
| UserPromptSubmit | session-init | session-init |
| PostToolUse | observation | observation |
| Stop | summarize | summarize |
