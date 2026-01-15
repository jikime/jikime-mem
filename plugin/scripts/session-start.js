#!/usr/bin/env node
/**
 * SessionStart Hook
 * 세션 시작 시 서버 자동 시작 및 세션 등록
 */

const API_BASE = 'http://127.0.0.1:37888'

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID
  const projectPath = input.cwd || process.cwd()

  // 서버 상태 확인 및 대기
  let serverReady = false
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        signal: AbortSignal.timeout(1000)
      })
      if (response.ok) {
        serverReady = true
        break
      }
    } catch {
      // 서버 아직 시작 안됨
    }
    await new Promise(r => setTimeout(r, 500))
  }

  if (!serverReady) {
    console.error('Server not ready')
    process.exit(0)
  }

  // 세션 시작 등록
  try {
    const response = await fetch(`${API_BASE}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, projectPath })
    })

    if (response.ok) {
      const data = await response.json()
      console.log(JSON.stringify({
        continue: true,
        suppressOutput: true,
        session: data.session
      }))
    }
  } catch (error) {
    console.error('Failed to register session:', error.message)
  }

  process.exit(0)
}

main().catch(console.error)
