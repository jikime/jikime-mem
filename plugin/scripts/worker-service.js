#!/usr/bin/env node
/**
 * jikime-mem Worker Service
 *
 * 서버 프로세스 관리 및 훅 이벤트 처리
 * claude-mem의 worker-service.cjs와 동일한 역할
 *
 * Usage:
 *   node worker-service.js start          - 서버 시작
 *   node worker-service.js stop           - 서버 중지
 *   node worker-service.js restart        - 서버 재시작
 *   node worker-service.js status         - 상태 확인
 *   node worker-service.js hook <event>   - 훅 이벤트 처리
 */

import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(__dirname, '..')
const PROJECT_ROOT = join(PLUGIN_ROOT, '..')
const DATA_DIR = join(homedir(), '.jikime-mem')
const PID_FILE = join(DATA_DIR, 'server.pid')
const LOG_DIR = join(DATA_DIR, 'logs')

const API_BASE = 'http://127.0.0.1:37888'
const WORKER_PORT = 37888

// 데이터 디렉토리 생성
function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

// 로그 기록
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString()
  const date = timestamp.split('T')[0]
  const logFile = join(LOG_DIR, `worker-${date}.log`)
  const logLine = `[${timestamp}] [${level}] ${message}\n`

  ensureDataDir()
  appendFileSync(logFile, logLine)

  if (process.env.DEBUG || level === 'ERROR') {
    console.error(logLine.trim())
  }
}

// PID 읽기
function getPid() {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf-8').trim()
    return parseInt(pid, 10)
  }
  return null
}

// 프로세스 실행 확인
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 헬스 체크
async function checkHealth(retries = 1, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) return true
    } catch {
      // 재시도
    }
    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return false
}

// 서버 시작
async function startServer() {
  ensureDataDir()

  // 이미 실행 중인지 확인
  const pid = getPid()
  if (pid && isProcessRunning(pid)) {
    const healthy = await checkHealth()
    if (healthy) {
      log('Server already running and healthy')
      return true
    }
    // 좀비 프로세스 정리
    log('Found zombie process, cleaning up...')
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }

  // PID 파일 정리
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }

  log('Starting jikime-mem server...')

  // Next.js 서버 시작 (프로덕션 모드)
  const serverProcess = spawn('npm', ['run', 'start'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' }
  })

  // PID 저장
  writeFileSync(PID_FILE, String(serverProcess.pid))

  // 로그 파일로 출력
  const date = new Date().toISOString().split('T')[0]
  const serverLogFile = join(LOG_DIR, `server-${date}.log`)

  serverProcess.stdout.on('data', (data) => {
    appendFileSync(serverLogFile, data)
  })
  serverProcess.stderr.on('data', (data) => {
    appendFileSync(serverLogFile, data)
  })

  serverProcess.unref()

  // 서버 준비 대기
  log('Waiting for server to be ready...')
  const ready = await checkHealth(15, 1000)

  if (ready) {
    log(`Server started successfully (PID: ${serverProcess.pid})`)
    return true
  } else {
    log('Server failed to start within timeout', 'ERROR')
    return false
  }
}

// 서버 중지
async function stopServer() {
  const pid = getPid()

  if (!pid) {
    log('No server PID found')
    return true
  }

  if (!isProcessRunning(pid)) {
    log('Server is not running')
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
    return true
  }

  log(`Stopping server (PID: ${pid})...`)

  try {
    process.kill(pid, 'SIGTERM')

    // 종료 대기
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (!isProcessRunning(pid)) {
        break
      }
    }

    // 강제 종료
    if (isProcessRunning(pid)) {
      process.kill(pid, 'SIGKILL')
    }

    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }

    log('Server stopped successfully')
    return true
  } catch (error) {
    log(`Failed to stop server: ${error.message}`, 'ERROR')
    return false
  }
}

// 서버 재시작
async function restartServer() {
  await stopServer()
  await new Promise(resolve => setTimeout(resolve, 1000))
  return await startServer()
}

// 상태 확인
async function getStatus() {
  const pid = getPid()
  const running = pid && isProcessRunning(pid)
  const healthy = running ? await checkHealth() : false

  return {
    pid: pid || null,
    running,
    healthy,
    dataDir: DATA_DIR,
    logDir: LOG_DIR
  }
}

// 훅 이벤트 처리
async function handleHook(event) {
  // 서버 시작 확인
  const healthy = await checkHealth(3, 500)
  if (!healthy) {
    log('Server not healthy, starting...')
    const started = await startServer()
    if (!started) {
      log('Failed to start server for hook', 'ERROR')
      return { continue: true, error: 'Server not available' }
    }
  }

  // stdin에서 훅 데이터 읽기
  let hookData = {}
  try {
    const input = readFileSync(0, 'utf-8').trim()
    if (input) {
      hookData = JSON.parse(input)
    }
  } catch {
    // stdin이 없거나 파싱 실패
  }

  const sessionId = hookData.session_id || process.env.CLAUDE_SESSION_ID || 'unknown'

  log(`Processing hook: ${event} for session: ${sessionId}`)

  try {
    switch (event) {
      case 'session-start':
        await fetch(`${API_BASE}/api/sessions/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            workingDirectory: hookData.cwd || process.cwd()
          }),
          signal: AbortSignal.timeout(5000)
        })
        break

      case 'prompt':
        if (hookData.prompt) {
          await fetch(`${API_BASE}/api/prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              content: hookData.prompt
            }),
            signal: AbortSignal.timeout(5000)
          })
        }
        break

      case 'observation':
        if (hookData.tool_name) {
          await fetch(`${API_BASE}/api/observations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              toolName: hookData.tool_name,
              toolInput: hookData.tool_input || {},
              toolResponse: typeof hookData.tool_response === 'string'
                ? hookData.tool_response.substring(0, 10000)
                : JSON.stringify(hookData.tool_response || '').substring(0, 10000)
            }),
            signal: AbortSignal.timeout(5000)
          })
        }
        break

      case 'session-stop':
        await fetch(`${API_BASE}/api/sessions/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(5000)
        })
        break

      default:
        log(`Unknown hook event: ${event}`, 'WARN')
    }

    log(`Hook ${event} processed successfully`)
    return { continue: true }

  } catch (error) {
    log(`Hook ${event} failed: ${error.message}`, 'ERROR')
    return { continue: true, error: error.message }
  }
}

// 메인 실행
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case 'start':
      const started = await startServer()
      process.exit(started ? 0 : 1)
      break

    case 'stop':
      const stopped = await stopServer()
      process.exit(stopped ? 0 : 1)
      break

    case 'restart':
      const restarted = await restartServer()
      process.exit(restarted ? 0 : 1)
      break

    case 'status':
      const status = await getStatus()
      console.log(JSON.stringify(status, null, 2))
      process.exit(status.healthy ? 0 : 1)
      break

    case 'hook':
      const event = args[1]
      if (!event) {
        console.error('Usage: worker-service.js hook <event>')
        process.exit(1)
      }
      const result = await handleHook(event)
      console.log(JSON.stringify(result))
      process.exit(0)
      break

    default:
      console.log(`
jikime-mem Worker Service

Usage:
  node worker-service.js <command>

Commands:
  start     Start the server
  stop      Stop the server
  restart   Restart the server
  status    Show server status
  hook      Process hook event (session-start|prompt|observation|session-stop)
`)
      process.exit(1)
  }
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'ERROR')
  console.error(error)
  process.exit(1)
})
