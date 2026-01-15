#!/usr/bin/env node
/**
 * Stop Hook
 * 세션 종료 처리
 */

const API_BASE = 'http://127.0.0.1:37888'

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID

  if (!sessionId) {
    process.exit(0)
  }

  try {
    await fetch(`${API_BASE}/api/sessions/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(3000)
    })
  } catch (error) {
    // 종료 실패해도 무시
    console.error('Failed to stop session:', error.message)
  }

  process.exit(0)
}

main().catch(console.error)
