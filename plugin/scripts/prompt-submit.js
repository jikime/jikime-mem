#!/usr/bin/env node
/**
 * UserPromptSubmit Hook
 * 사용자 프롬프트 저장
 */

const API_BASE = 'http://127.0.0.1:37888'

// 헤드리스/시스템 프롬프트 패턴 (저장하지 않을 것들)
const HEADLESS_PROMPT_PATTERNS = [
  '당신은 개발 세션 분석 전문가입니다',
  '당신은 코드 분석 전문가입니다',
  '다음 사용자 프롬프트를 분석해서 JSON',
  '다음 도구 실행 결과를 핵심만 추출',
  '다음 대화 내용을 분석해서 세션 요약',
  '이전 세션들의 데이터입니다',
  '핵심 작업 내용만 간결하게 정리',
]

function isHeadlessPrompt(content) {
  const trimmed = content.trim()
  return HEADLESS_PROMPT_PATTERNS.some(pattern => trimmed.includes(pattern))
}

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID
  const content = input.prompt || ''

  if (!sessionId || !content) {
    console.log(JSON.stringify({ continue: true }))
    process.exit(0)
  }

  // 헤드리스/시스템 프롬프트는 저장하지 않음
  if (isHeadlessPrompt(content)) {
    console.log(JSON.stringify({ continue: true }))
    process.exit(0)
  }

  try {
    await fetch(`${API_BASE}/api/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content }),
      signal: AbortSignal.timeout(3000)
    })
  } catch (error) {
    // 저장 실패해도 계속 진행
    console.error('Failed to save prompt:', error.message)
  }

  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

main().catch(console.error)
