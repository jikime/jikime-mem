#!/usr/bin/env node
/**
 * PostToolUse Hook
 * 도구 사용 결과 저장
 */

const API_BASE = 'http://127.0.0.1:37888'

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID
  const toolName = input.tool_name || ''
  const toolInput = input.tool_input || {}
  const toolResponse = input.tool_response || ''

  if (!sessionId || !toolName) {
    console.log(JSON.stringify({ continue: true }))
    process.exit(0)
  }

  try {
    await fetch(`${API_BASE}/api/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        toolName,
        toolInput,
        toolResponse: typeof toolResponse === 'string'
          ? toolResponse.substring(0, 10000)
          : JSON.stringify(toolResponse).substring(0, 10000)
      }),
      signal: AbortSignal.timeout(3000)
    })
  } catch (error) {
    // 저장 실패해도 계속 진행
    console.error('Failed to save observation:', error.message)
  }

  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

main().catch(console.error)
