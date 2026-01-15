/**
 * Claude Code Headless Utility
 * SDK 없이 Claude Code headless 모드를 활용한 AI 처리
 */
import { spawn, execSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// 결과 저장 디렉토리
const RESULT_DIR = join(homedir(), '.jikime-mem', 'headless-results')

// Claude CLI 경로 (alias가 아닌 실제 경로)
const CLAUDE_PATH = join(homedir(), '.claude', 'local', 'claude')

// 결과 디렉토리 생성
try {
  const { mkdirSync } = require('fs')
  mkdirSync(RESULT_DIR, { recursive: true })
} catch {}

/**
 * Claude Code headless 동기 실행 (결과 즉시 반환)
 * context 훅처럼 결과가 바로 필요한 경우 사용
 */
export function runHeadlessSync(prompt: string, timeoutMs: number = 30000): string {
  try {
    const result = execSync(
      `"${CLAUDE_PATH}" -p "${prompt.replace(/"/g, '\\"')}"`,
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      }
    )
    return result.trim()
  } catch (error: any) {
    console.error('Headless sync execution failed:', error.message)
    return ''
  }
}

/**
 * API 콜백 정보
 */
export interface ApiCallback {
  url: string
  method: 'POST' | 'PATCH' | 'PUT'
  bodyField: string  // 결과를 담을 JSON 필드명 (예: 'compressed', 'aiSummary')
}

/**
 * Claude Code headless 비동기 실행 (백그라운드)
 * observation, summarize 훅처럼 나중에 결과를 저장해도 되는 경우 사용
 *
 * shell script 방식으로 완전히 독립된 백그라운드 프로세스 실행
 */
export function runHeadlessAsync(
  taskId: string,
  prompt: string,
  apiCallback?: ApiCallback
): void {
  const resultFile = join(RESULT_DIR, `${taskId}.txt`)
  const statusFile = join(RESULT_DIR, `${taskId}.status`)
  const scriptFile = join(RESULT_DIR, `${taskId}.sh`)

  // 상태 파일 생성 (processing)
  writeFileSync(statusFile, 'processing')

  // 프롬프트를 파일로 저장 (특수문자 처리)
  const promptFile = join(RESULT_DIR, `${taskId}.prompt`)
  writeFileSync(promptFile, prompt)

  // API 콜백 curl 명령 생성
  let curlCmd = ''
  if (apiCallback) {
    curlCmd = `
# API로 결과 저장
ESCAPED_RESULT=$(echo "$RESULT" | jq -Rs .)
curl -s -X ${apiCallback.method} "${apiCallback.url}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"${apiCallback.bodyField}\\": $ESCAPED_RESULT}" > /dev/null 2>&1
`
  }

  // 실행 스크립트 생성 (세션 종료 후 실행되도록 5초 대기)
  const script = `#!/bin/bash
# 현재 세션이 완전히 종료될 때까지 대기
sleep 5

RESULT=$("${CLAUDE_PATH}" -p "$(cat "${promptFile}")" 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
  echo "$RESULT" > "${resultFile}"
  echo "completed" > "${statusFile}"
  ${curlCmd}
else
  echo "failed" > "${statusFile}"
fi
rm -f "${promptFile}" "${scriptFile}"
`
  writeFileSync(scriptFile, script)

  // 백그라운드 실행
  spawn('bash', [scriptFile], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

/**
 * 비동기 작업 결과 조회
 */
export function getHeadlessResult(taskId: string): { status: string; result?: string } {
  const resultFile = join(RESULT_DIR, `${taskId}.txt`)
  const statusFile = join(RESULT_DIR, `${taskId}.status`)

  if (!existsSync(statusFile)) {
    return { status: 'not_found' }
  }

  const status = readFileSync(statusFile, 'utf-8').trim()

  if (status === 'completed' && existsSync(resultFile)) {
    const result = readFileSync(resultFile, 'utf-8')
    return { status, result }
  }

  return { status }
}

/**
 * 비동기 작업 결과 정리 (삭제)
 */
export function cleanupHeadlessResult(taskId: string): void {
  const resultFile = join(RESULT_DIR, `${taskId}.txt`)
  const statusFile = join(RESULT_DIR, `${taskId}.status`)

  try {
    if (existsSync(resultFile)) unlinkSync(resultFile)
    if (existsSync(statusFile)) unlinkSync(statusFile)
  } catch {}
}

/**
 * 프롬프트 템플릿들
 */
export const prompts = {
  // 컨텍스트 생성용
  smartContext: (sessionsData: string) => `
당신은 개발 세션 분석 전문가입니다.
다음은 이전 세션들의 데이터입니다. 현재 세션에 유용한 컨텍스트를 생성해주세요.

요구사항:
- 핵심 작업 내용만 간결하게 정리
- 진행 중이던 작업이 있다면 언급
- 주요 파일이나 기능 언급
- 200자 이내로 작성

이전 세션 데이터:
${sessionsData}

컨텍스트:`,

  // Observation 압축용
  compressObservation: (toolName: string, toolInput: string, toolOutput: string) => `
당신은 코드 분석 전문가입니다.
다음 도구 실행 결과를 핵심만 추출해서 요약해주세요.

요구사항:
- 100자 이내로 요약
- 핵심 정보만 포함 (파일명, 주요 내용, 결과)
- 불필요한 세부사항 제외

도구: ${toolName}
입력: ${toolInput}
출력:
${toolOutput.substring(0, 5000)}

요약:`,

  // 세션 요약용
  summarizeSession: (transcript: string) => `
당신은 개발 세션 분석 전문가입니다.
다음 대화 내용을 분석해서 세션 요약을 생성해주세요.

요구사항:
- 주요 작업 내용 (무엇을 했는지)
- 결과 (성공/실패, 완료된 것)
- 다음 단계 (있다면)
- 300자 이내로 작성

대화 내용:
${transcript.substring(0, 10000)}

세션 요약:`,

  // 프롬프트 분석용
  analyzePrompt: (prompt: string) => `
다음 사용자 프롬프트를 분석해서 JSON 형식으로 응답해주세요.

프롬프트: "${prompt}"

응답 형식:
{
  "intent": "feature_request|bug_fix|question|refactor|documentation|other",
  "category": "frontend|backend|database|devops|testing|other",
  "keywords": ["키워드1", "키워드2"]
}

JSON:`
}

/**
 * 간단한 작업 큐 (동시 실행 제한)
 */
class HeadlessQueue {
  private queue: Array<() => Promise<void>> = []
  private running = 0
  private maxConcurrent = 1

  async add(task: () => Promise<void>): Promise<void> {
    this.queue.push(task)
    this.process()
  }

  private async process(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return
    }

    this.running++
    const task = this.queue.shift()

    try {
      await task?.()
    } catch (error) {
      console.error('Queue task failed:', error)
    } finally {
      this.running--
      this.process()
    }
  }
}

export const headlessQueue = new HeadlessQueue()
