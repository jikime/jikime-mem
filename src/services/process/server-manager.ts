/**
 * Server Process Manager
 * Next.js 서버 프로세스 시작/종료/재시작 관리
 */

import { spawn, ChildProcess } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DATA_DIR = join(homedir(), '.jikime-mem')
const PID_FILE = join(DATA_DIR, 'server.pid')
const LOG_FILE = join(DATA_DIR, 'server.log')
const DEFAULT_PORT = 37888

export interface ServerStatus {
  running: boolean
  pid?: number
  port: number
  uptime?: number
  startedAt?: string
}

/**
 * 데이터 디렉토리 확인 및 생성
 */
function ensureDataDir(): void {
  const fs = require('fs')
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/**
 * PID 파일에서 프로세스 ID 읽기
 */
function readPidFile(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const content = readFileSync(PID_FILE, 'utf-8').trim()
      const pid = parseInt(content, 10)
      return isNaN(pid) ? null : pid
    }
  } catch {
    // PID 파일 읽기 실패
  }
  return null
}

/**
 * PID 파일에 프로세스 ID 저장
 */
function writePidFile(pid: number): void {
  ensureDataDir()
  writeFileSync(PID_FILE, pid.toString(), 'utf-8')
}

/**
 * PID 파일 삭제
 */
function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
  } catch {
    // PID 파일 삭제 실패 무시
  }
}

/**
 * 프로세스가 실행 중인지 확인
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 포트가 사용 중인지 확인
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net')
    const server = net.createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })

    server.once('listening', () => {
      server.close()
      resolve(false)
    })

    server.listen(port, '127.0.0.1')
  })
}

/**
 * 서버 상태 확인
 */
export async function getServerStatus(): Promise<ServerStatus> {
  const port = parseInt(process.env.JIKIME_MEM_PORT || String(DEFAULT_PORT), 10)
  const pid = readPidFile()

  if (pid && isProcessRunning(pid)) {
    // Health check
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000)
      })

      if (response.ok) {
        const data = await response.json()
        return {
          running: true,
          pid,
          port,
          startedAt: data.timestamp
        }
      }
    } catch {
      // Health check 실패 but 프로세스는 실행 중
      return {
        running: true,
        pid,
        port
      }
    }
  }

  // PID 파일은 있지만 프로세스가 없으면 정리
  if (pid && !isProcessRunning(pid)) {
    removePidFile()
  }

  return {
    running: false,
    port
  }
}

/**
 * 서버 시작
 */
export async function startServer(projectRoot: string): Promise<ServerStatus> {
  const port = parseInt(process.env.JIKIME_MEM_PORT || String(DEFAULT_PORT), 10)

  // 이미 실행 중인지 확인
  const status = await getServerStatus()
  if (status.running) {
    return status
  }

  // 포트 사용 중인지 확인
  if (await isPortInUse(port)) {
    throw new Error(`Port ${port} is already in use`)
  }

  ensureDataDir()

  // Next.js 서버를 백그라운드에서 시작
  const serverProcess: ChildProcess = spawn('npm', ['run', 'start'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production'
    }
  })

  if (serverProcess.pid) {
    writePidFile(serverProcess.pid)

    // 로그 파일에 출력 저장
    const fs = require('fs')
    const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })

    serverProcess.stdout?.pipe(logStream)
    serverProcess.stderr?.pipe(logStream)

    // 프로세스 분리
    serverProcess.unref()

    // 서버 준비 대기 (최대 30초)
    const maxWait = 30000
    const interval = 500
    let waited = 0

    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval))
      waited += interval

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1000)
        })

        if (response.ok) {
          return {
            running: true,
            pid: serverProcess.pid,
            port,
            startedAt: new Date().toISOString()
          }
        }
      } catch {
        // 아직 준비 안됨
      }
    }

    throw new Error('Server failed to start within timeout')
  }

  throw new Error('Failed to start server process')
}

/**
 * 서버 종료
 */
export async function stopServer(): Promise<void> {
  const pid = readPidFile()

  if (pid && isProcessRunning(pid)) {
    try {
      // SIGTERM으로 정상 종료 요청
      process.kill(pid, 'SIGTERM')

      // 최대 10초 대기
      const maxWait = 10000
      const interval = 200
      let waited = 0

      while (waited < maxWait && isProcessRunning(pid)) {
        await new Promise(resolve => setTimeout(resolve, interval))
        waited += interval
      }

      // 아직 실행 중이면 강제 종료
      if (isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      // 프로세스 종료 실패
    }
  }

  removePidFile()
}

/**
 * 서버 재시작
 */
export async function restartServer(projectRoot: string): Promise<ServerStatus> {
  await stopServer()
  return startServer(projectRoot)
}

/**
 * 서버가 준비될 때까지 대기
 */
export async function waitForServer(timeoutMs: number = 30000): Promise<boolean> {
  const port = parseInt(process.env.JIKIME_MEM_PORT || String(DEFAULT_PORT), 10)
  const interval = 500
  let waited = 0

  while (waited < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000)
      })

      if (response.ok) {
        return true
      }
    } catch {
      // 아직 준비 안됨
    }

    await new Promise(resolve => setTimeout(resolve, interval))
    waited += interval
  }

  return false
}
