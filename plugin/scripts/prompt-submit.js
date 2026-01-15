#!/usr/bin/env node
/**
 * UserPromptSubmit Hook
 * 사용자 프롬프트 저장
 */

const API_BASE = 'http://127.0.0.1:37888'

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID
  const content = input.prompt || ''

  if (!sessionId || !content) {
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
