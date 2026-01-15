#!/usr/bin/env node
/**
 * jikime-mem CLI
 * 서버 관리 및 데이터베이스 초기화 도구
 */

import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const DATA_DIR = join(homedir(), '.jikime-mem')
const PID_FILE = join(DATA_DIR, 'server.pid')
const LOG_FILE = join(DATA_DIR, 'server.log')

// 색상 코드
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
    log(`Created data directory: ${DATA_DIR}`, 'green')
  }
}

function getPid() {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf-8').trim()
    return parseInt(pid, 10)
  }
  return null
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function checkHealth() {
  try {
    const response = await fetch('http://127.0.0.1:37888/api/health', {
      signal: AbortSignal.timeout(3000)
    })
    return response.ok
  } catch {
    return false
  }
}

async function start() {
  log('\n🚀 Starting jikime-mem server...', 'cyan')

  ensureDataDir()

  // 이미 실행 중인지 확인
  const pid = getPid()
  if (pid && isProcessRunning(pid)) {
    log('⚠️  Server is already running (PID: ' + pid + ')', 'yellow')
    return
  }

  // 서버 시작
  const serverProcess = spawn('npm', ['run', 'start'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  // PID 저장
  writeFileSync(PID_FILE, String(serverProcess.pid))

  // 로그 파일로 출력 리다이렉트
  const logStream = require('fs').createWriteStream(LOG_FILE, { flags: 'a' })
  serverProcess.stdout.pipe(logStream)
  serverProcess.stderr.pipe(logStream)

  serverProcess.unref()

  log(`✅ Server started (PID: ${serverProcess.pid})`, 'green')
  log(`📝 Logs: ${LOG_FILE}`, 'blue')

  // 서버가 준비될 때까지 대기
  log('⏳ Waiting for server to be ready...', 'yellow')

  let retries = 10
  while (retries > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (await checkHealth()) {
      log('✅ Server is ready at http://127.0.0.1:37888', 'green')
      return
    }
    retries--
  }

  log('⚠️  Server started but health check failed. Check logs.', 'yellow')
}

async function stop() {
  log('\n🛑 Stopping jikime-mem server...', 'cyan')

  const pid = getPid()
  if (!pid) {
    log('ℹ️  No server PID found', 'blue')
    return
  }

  if (!isProcessRunning(pid)) {
    log('ℹ️  Server is not running', 'blue')
    // PID 파일 정리
    if (existsSync(PID_FILE)) {
      require('fs').unlinkSync(PID_FILE)
    }
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    log(`✅ Server stopped (PID: ${pid})`, 'green')

    // PID 파일 삭제
    if (existsSync(PID_FILE)) {
      require('fs').unlinkSync(PID_FILE)
    }
  } catch (error) {
    log(`❌ Failed to stop server: ${error.message}`, 'red')
  }
}

async function restart() {
  await stop()
  await new Promise(resolve => setTimeout(resolve, 1000))
  await start()
}

async function status() {
  log('\n📊 jikime-mem Server Status', 'cyan')
  log('─'.repeat(40))

  const pid = getPid()
  const running = pid && isProcessRunning(pid)
  const healthy = await checkHealth()

  log(`PID File: ${existsSync(PID_FILE) ? PID_FILE : 'Not found'}`)
  log(`Process ID: ${pid || 'None'}`)
  log(`Running: ${running ? '✅ Yes' : '❌ No'}`, running ? 'green' : 'red')
  log(`Health: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}`, healthy ? 'green' : 'red')
  log(`Data Dir: ${DATA_DIR}`)
  log(`Log File: ${LOG_FILE}`)
  log('─'.repeat(40))
}

async function initDb() {
  log('\n🗄️  Initializing database...', 'cyan')

  try {
    execSync('npm run db:generate', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    execSync('npm run db:push', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    log('✅ Database initialized successfully', 'green')
  } catch (error) {
    log(`❌ Database initialization failed: ${error.message}`, 'red')
    process.exit(1)
  }
}

function showHelp() {
  log('\n📖 jikime-mem CLI', 'cyan')
  log('─'.repeat(40))
  log('Usage: jikime-mem <command>\n')
  log('Commands:')
  log('  start     Start the server in background')
  log('  stop      Stop the running server')
  log('  restart   Restart the server')
  log('  status    Show server status')
  log('  init-db   Initialize the database')
  log('  help      Show this help message')
  log('─'.repeat(40))
}

// 메인 실행
const command = process.argv[2]

switch (command) {
  case 'start':
    start()
    break
  case 'stop':
    stop()
    break
  case 'restart':
    restart()
    break
  case 'status':
    status()
    break
  case 'init-db':
    initDb()
    break
  case 'help':
  case '--help':
  case '-h':
    showHelp()
    break
  default:
    if (command) {
      log(`❌ Unknown command: ${command}`, 'red')
    }
    showHelp()
    process.exit(1)
}
