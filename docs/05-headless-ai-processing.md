# Claude Code Headless AI 처리 방안

## 개요

SDK 없이 Claude Code headless 모드를 활용하여 AI 처리를 수행하는 방안입니다.

## 핵심 아이디어

**현재 실행 중인 Claude Code를 활용하여 AI 처리!**

```
기존 방식 (SDK):
Hooks → Worker → Claude API (SDK) → DB
                      ↑
                  별도 API 호출 (비용 발생)

제안 방식 (Headless):
Hooks → Worker → DB (원본 저장)
                  ↓
           Claude Code (headless)
                  ↓
            AI 처리 결과 → DB
                  ↑
            추가 비용 없음!
```

## 가능한 이유

### 1. Transcript 파일 접근

Stop 훅에서 `transcript_path`를 통해 전체 대화 내용에 접근 가능합니다.

```typescript
// Stop 훅 입력
{
  "session_id": "xxx",
  "transcript_path": "~/.claude/projects/.../session.jsonl"
}
```

### 2. Claude Code Headless 모드

Claude Code는 headless 모드로 실행 가능합니다.

```bash
# 프롬프트 전달
claude --headless -p "이 내용을 요약해줘: ..."

# stdin으로 전달
echo "요약해줘: ..." | claude --headless

# 결과 출력
claude --headless --print -p "..."
```

## 훅별 구현 방안

### context (SessionStart)

```typescript
case 'context':
  // 이전 세션 데이터 조회
  const previousSessions = await fetch(`${API_BASE}/api/sessions/recent`)

  // Claude Code headless로 스마트 컨텍스트 생성
  const { execSync } = require('child_process')
  const smartContext = execSync(`
    claude --headless --print -p "
    다음 이전 세션 정보를 분석해서 현재 작업에 유용한 컨텍스트를 생성해줘.
    간결하게 핵심만 정리해줘:
    ${JSON.stringify(previousSessions)}
    "
  `).toString()

  console.log(smartContext)
```

### session-init (UserPromptSubmit)

```typescript
case 'session-init':
  // 프롬프트 저장
  await fetch(`${API_BASE}/api/prompts`, {...})

  // 백그라운드에서 프롬프트 분석
  spawn('claude', [
    '--headless', '--print',
    '-p', `다음 프롬프트의 의도와 카테고리를 JSON으로 분석해줘: ${hookData.prompt}`
  ], { detached: true })
    .stdout.on('data', async (analysis) => {
      await fetch(`${API_BASE}/api/prompts/${id}/analysis`, {
        method: 'PATCH',
        body: analysis
      })
    })
```

### observation (PostToolUse)

```typescript
case 'observation':
  // 원본 저장
  const obsId = await fetch(`${API_BASE}/api/observations`, {...})

  // 백그라운드에서 압축
  if (hookData.tool_response?.length > 1000) {
    spawn('claude', [
      '--headless', '--print',
      '-p', `다음 도구 실행 결과를 200자 이내로 요약해줘:
        Tool: ${hookData.tool_name}
        Output: ${hookData.tool_response}`
    ], { detached: true })
      .stdout.on('data', async (compressed) => {
        await fetch(`${API_BASE}/api/observations/${obsId}/compressed`, {
          method: 'PATCH',
          body: JSON.stringify({ compressed: compressed.toString() })
        })
      })
  }
```

### summarize (Stop)

```typescript
case 'summarize':
  // 원본 응답 저장
  const transcript = readFile(hookData.transcript_path)
  await fetch(`${API_BASE}/api/responses`, {...})

  // 백그라운드에서 AI 요약 생성
  spawn('claude', [
    '--headless', '--print',
    '-p', `다음 대화를 요약해줘. 주요 작업, 결과, 다음 단계를 포함해줘:
      ${transcript}`
  ], { detached: true })
    .stdout.on('data', async (summary) => {
      await fetch(`${API_BASE}/api/summaries`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          summary: summary.toString(),
          type: 'ai'
        })
      })
    })
```

## 실행 전략

| 훅 | 처리 방식 | 이유 |
|----|----------|------|
| context | **동기** | 결과를 Claude에게 전달해야 함 |
| session-init | 비동기 | 분석 결과는 나중에 사용 |
| observation | 비동기 | 훅 타임아웃 방지 |
| summarize | 비동기 | 세션 종료 후 처리 |

## 장점

| 항목 | 설명 |
|------|------|
| **비용** | 추가 API 비용 없음 (기존 구독 활용) |
| **설정** | SDK 설정 불필요 |
| **일관성** | 같은 Claude 모델 사용 |
| **심플** | CLI 호출만으로 구현 |

## 고려사항

### 1. 타임아웃

훅에는 타임아웃이 있으므로 긴 처리는 백그라운드로 실행해야 합니다.

```typescript
// 백그라운드 실행
spawn('claude', [...], {
  detached: true,
  stdio: 'ignore'
})

// 부모 프로세스와 분리
child.unref()
```

### 2. 동시 실행 제한

여러 headless 인스턴스가 동시에 실행되면 리소스 문제가 발생할 수 있습니다.

```typescript
// 큐 시스템 사용
const queue = new Queue({ concurrency: 1 })
queue.add(() => runHeadless(prompt))
```

### 3. 결과 저장

백그라운드 프로세스 결과를 DB에 저장하는 메커니즘이 필요합니다.

```typescript
// 결과 파일로 저장 후 폴링
spawn('claude', [...], {
  stdout: fs.openSync(`/tmp/result-${id}.txt`, 'w')
})

// Worker에서 주기적으로 결과 파일 확인
setInterval(checkResultFiles, 5000)
```

## 구현 로드맵

1. **Phase 1**: summarize 훅에 headless 요약 추가
2. **Phase 2**: observation 압축 기능 추가
3. **Phase 3**: context 스마트 생성 추가
4. **Phase 4**: 큐 시스템 및 안정화

## 결론

Claude Code headless를 활용하면 **SDK 없이도 AI 기반 메모리 시스템**을 구현할 수 있습니다. 추가 비용 없이 claude-mem과 유사한 스마트 기능을 제공할 수 있는 혁신적인 접근 방식입니다.
