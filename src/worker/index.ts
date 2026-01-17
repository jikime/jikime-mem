#!/usr/bin/env bun
/**
 * jikime-mem Worker Service
 *
 * 서버 프로세스 관리 및 훅 이벤트 처리
 *
 * Usage:
 *   bun worker-service.cjs start          - 서버 시작
 *   bun worker-service.cjs stop           - 서버 중지
 *   bun worker-service.cjs restart        - 서버 재시작
 *   bun worker-service.cjs status         - 상태 확인
 *   bun worker-service.cjs hook <event>   - 훅 이벤트 처리
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from './server'
import { extractLastAssistantMessage } from './transcript-parser'

const DATA_DIR = join(homedir(), '.jikime-mem')
const PID_FILE = join(DATA_DIR, 'server.pid')
const VERSION_FILE = join(DATA_DIR, 'server.version')
const LOG_DIR = join(DATA_DIR, 'logs')

const API_BASE = 'http://127.0.0.1:37888'
const WORKER_PORT = 37888

// 플러그인 버전 가져오기
function getPluginVersion(): string {
  try {
    // CLAUDE_PLUGIN_ROOT 환경변수 또는 현재 스크립트 위치에서 marketplace.json 찾기
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '../..')
    const marketplacePath = join(pluginRoot, '.claude-plugin', 'marketplace.json')

    if (existsSync(marketplacePath)) {
      const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'))
      return marketplace.plugins?.[0]?.version || 'unknown'
    }

    // 대체 경로 시도
    const altPath = join(__dirname, '../../.claude-plugin/marketplace.json')
    if (existsSync(altPath)) {
      const marketplace = JSON.parse(readFileSync(altPath, 'utf-8'))
      return marketplace.plugins?.[0]?.version || 'unknown'
    }
  } catch {}
  return 'unknown'
}

// 실행 중인 워커 버전 가져오기
function getRunningVersion(): string {
  try {
    if (existsSync(VERSION_FILE)) {
      return readFileSync(VERSION_FILE, 'utf-8').trim()
    }
  } catch {}
  return ''
}

// 워커 버전 저장
function saveRunningVersion(version: string) {
  try {
    ensureDataDir()
    writeFileSync(VERSION_FILE, version)
  } catch {}
}

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
function log(message: string, level = 'INFO') {
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
function getPid(): number | null {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf-8').trim()
    return parseInt(pid, 10)
  }
  return null
}

// 프로세스 실행 확인
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 헬스 체크
async function checkHealth(retries = 1, delay = 500): Promise<boolean> {
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

// 서버 시작 (인라인 모드)
async function startServer(): Promise<boolean> {
  ensureDataDir()

  const currentVersion = getPluginVersion()
  const runningVersion = getRunningVersion()

  // 이미 실행 중인지 확인
  const pid = getPid()
  if (pid && isProcessRunning(pid)) {
    const healthy = await checkHealth()
    if (healthy) {
      // 버전이 다르면 재시작 필요
      if (runningVersion && currentVersion !== runningVersion && currentVersion !== 'unknown') {
        log(`Version mismatch: running=${runningVersion}, current=${currentVersion}. Restarting...`)
        try {
          process.kill(pid, 'SIGTERM')
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch {}
      } else {
        log('Server already running and healthy')
        return true
      }
    } else {
      // 좀비 프로세스 정리
      log('Found zombie process, cleaning up...')
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
    }
  }

  // PID 파일 정리
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }

  log('Starting jikime-mem server...')

  // 서버를 백그라운드 프로세스로 시작
  const scriptPath = process.argv[1]
  const serverProcess = spawn(process.execPath, [scriptPath, 'serve'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' }
  })

  // PID 저장
  writeFileSync(PID_FILE, String(serverProcess.pid))

  // 로그 파일로 출력
  const date = new Date().toISOString().split('T')[0]
  const serverLogFile = join(LOG_DIR, `server-${date}.log`)

  serverProcess.stdout?.on('data', (data) => {
    appendFileSync(serverLogFile, data)
  })
  serverProcess.stderr?.on('data', (data) => {
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

// 서버 직접 실행 (serve 명령)
function serveServer() {
  ensureDataDir()

  // 현재 버전 저장 (업데이트 감지용)
  const version = getPluginVersion()
  saveRunningVersion(version)
  log(`Starting Express server inline... (version: ${version})`)

  const server = app.listen(WORKER_PORT, '127.0.0.1', () => {
    log(`Server listening on http://127.0.0.1:${WORKER_PORT}`)
    console.log(`jikime-mem server running on http://127.0.0.1:${WORKER_PORT}`)
  })

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...')
    server.close(() => {
      log('Server closed')
      process.exit(0)
    })
  })

  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down...')
    server.close(() => {
      log('Server closed')
      process.exit(0)
    })
  })
}

// 패턴으로 프로세스 종료 (고아 프로세스 정리용)
function killByPattern(pattern: string): void {
  try {
    // 현재 프로세스 제외하고 패턴 매칭되는 프로세스 종료
    const currentPid = process.pid
    execSync(`pgrep -f "${pattern}" | grep -v "^${currentPid}$" | xargs -r kill -9 2>/dev/null || true`, {
      stdio: 'pipe'
    })
  } catch {
    // 실패해도 무시 (프로세스가 없을 수 있음)
  }
}

// 서버 중지
async function stopServer(): Promise<boolean> {
  const pid = getPid()

  // PID 파일의 프로세스 종료 시도
  if (pid && isProcessRunning(pid)) {
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
    } catch (error: any) {
      log(`Failed to stop server by PID: ${error.message}`, 'ERROR')
    }
  }

  // 고아 프로세스 정리 (jikime-mem worker-service serve 패턴)
  log('Cleaning up orphaned worker processes...')
  killByPattern('jikime-mem.*worker-service.*serve')

  // PID 파일 삭제
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE)
  }

  log('Server stopped successfully')
  return true
}

// 서버 재시작
async function restartServer(): Promise<boolean> {
  await stopServer()
  await new Promise(resolve => setTimeout(resolve, 1000))
  return await startServer()
}

// 상태 확인
async function getStatus() {
  const pid = getPid()
  const running = pid ? isProcessRunning(pid) : false
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
async function handleHook(event: string) {
  // 서버 시작 확인
  const healthy = await checkHealth(3, 500)
  if (!healthy) {
    log('Server not healthy, starting...')
    const started = await startServer()
    if (!started) {
      log('Failed to start server for hook', 'ERROR')
      return { continue: true, error: 'Server not available' }
    }
    // 서버가 시작될 때까지 추가 대기
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // stdin에서 훅 데이터 읽기 (non-blocking)
  let hookData: any = {}
  try {
    if (!process.stdin.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      const input = Buffer.concat(chunks).toString('utf-8').trim()
      if (input) {
        hookData = JSON.parse(input)
      }
    }
  } catch {
    // stdin이 없거나 파싱 실패 - 무시
  }

  const sessionId = hookData.session_id || process.env.CLAUDE_SESSION_ID || 'unknown'

  log(`Processing hook: ${event} for session: ${sessionId}`)

  try {
    switch (event) {
      // SessionStart 훅: context - 세션 시작
      case 'context':
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

      // SessionStart 훅: user-message - 사용자 메시지 처리
      case 'user-message':
        // 세션 시작 시 사용자 관련 메시지 처리 (현재는 로그만)
        log(`User message hook for session: ${sessionId}`)
        break

      // UserPromptSubmit 훅: session-init - 세션 초기화 및 프롬프트 저장
      case 'session-init':
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

      // Stop 훅: session-end - 세션 종료 및 마지막 응답 저장
      case 'session-end':
        // 1. Claude 응답 저장 (transcript에서 추출)
        const transcriptPath = hookData.transcript_path

        if (transcriptPath) {
          try {
            const lastResponse = extractLastAssistantMessage(transcriptPath)
            if (lastResponse) {
              await fetch(`${API_BASE}/api/responses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId,
                  content: lastResponse
                }),
                signal: AbortSignal.timeout(10000)
              })
              log(`Claude response saved for ${sessionId}`)
            }
          } catch (responseError: any) {
            log(`Failed to save response: ${responseError.message}`, 'WARN')
          }
        } else {
          log('No transcript_path provided, skipping response extraction', 'WARN')
        }

        // 2. 세션 종료
        await fetch(`${API_BASE}/api/sessions/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(5000)
        })
        break

      // 기존 훅 호환성 유지
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

      case 'session-stop':
        // session-end와 동일한 로직 (레거시 호환)
        const transcriptPathLegacy = hookData.transcript_path
        if (transcriptPathLegacy) {
          try {
            const lastResponseLegacy = extractLastAssistantMessage(transcriptPathLegacy)
            if (lastResponseLegacy) {
              await fetch(`${API_BASE}/api/responses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId,
                  content: lastResponseLegacy
                }),
                signal: AbortSignal.timeout(10000)
              })
            }
          } catch (responseError: any) {
            log(`Failed to save response: ${responseError.message}`, 'WARN')
          }
        }
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

  } catch (error: any) {
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

    case 'serve':
      // 직접 서버 실행 (백그라운드 프로세스용)
      serveServer()
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
        console.error('Usage: worker-service.cjs hook <event>')
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
  bun worker-service.cjs <command>

Commands:
  start     Start the server
  stop      Stop the server
  restart   Restart the server
  status    Show server status
  hook      Process hook event (session-start|prompt|session-stop)
`)
      process.exit(1)
  }
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'ERROR')
  console.error(error)
  process.exit(1)
})
