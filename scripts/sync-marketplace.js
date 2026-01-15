#!/usr/bin/env node
/**
 * Marketplace Sync Script
 *
 * 전체 프로젝트를 Claude Code 마켓플레이스 디렉토리로 동기화합니다.
 * ~/.claude/plugins/marketplaces/jikime/ 에 설치됩니다.
 *
 * claude-mem과 동일한 방식으로 rsync를 사용합니다.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const MARKETPLACE_ROOT = join(homedir(), '.claude', 'plugins', 'marketplaces')
const MARKETPLACE_NAME = 'jikime'
const MARKETPLACE_DIR = join(MARKETPLACE_ROOT, MARKETPLACE_NAME)

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

function getPluginVersion() {
  try {
    const pluginJsonPath = join(PROJECT_ROOT, 'plugin', '.claude-plugin', 'plugin.json')
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'))
    return pluginJson.version
  } catch {
    return '1.0.0'
  }
}

function syncMarketplace(force = false) {
  log('\n🔄 Syncing jikime-mem to Claude Code marketplace...', 'cyan')
  log('─'.repeat(50))

  const version = getPluginVersion()
  log(`📦 Version: ${version}`, 'blue')

  // 기존 설치 확인 (force가 아니면 경고)
  if (existsSync(MARKETPLACE_DIR) && !force) {
    log(`⚠️  Plugin already installed at: ${MARKETPLACE_DIR}`, 'yellow')
    log(`   Use --force to reinstall`, 'yellow')
  }

  // rsync로 전체 프로젝트 동기화 (claude-mem과 동일)
  log(`\n📦 Syncing project to marketplace...`, 'blue')
  try {
    execSync(
      `rsync -av --delete --exclude=.git --exclude=node_modules --exclude=.next --exclude=prisma/*.db ./ "${MARKETPLACE_DIR}/"`,
      { cwd: PROJECT_ROOT, stdio: 'inherit' }
    )
  } catch (error) {
    log(`❌ rsync failed: ${error.message}`, 'red')
    process.exit(1)
  }

  // npm install 실행
  log(`\n📦 Running npm install in marketplace...`, 'blue')
  try {
    execSync('npm install', { cwd: MARKETPLACE_DIR, stdio: 'inherit' })
  } catch (error) {
    log(`⚠️  npm install failed: ${error.message}`, 'yellow')
  }

  // Prisma 초기화
  log(`\n🗄️  Initializing database...`, 'blue')
  try {
    execSync('npm run db:generate && npm run db:push', { cwd: MARKETPLACE_DIR, stdio: 'inherit' })
  } catch (error) {
    log(`⚠️  Database init failed: ${error.message}`, 'yellow')
  }

  // Next.js 빌드
  log(`\n🔨 Building Next.js app...`, 'blue')
  try {
    execSync('npm run build', { cwd: MARKETPLACE_DIR, stdio: 'inherit' })
  } catch (error) {
    log(`⚠️  Build failed: ${error.message}`, 'yellow')
  }

  // 설치 완료
  log('\n' + '─'.repeat(50))
  log(`✅ Plugin synced successfully!`, 'green')
  log(`\n📍 Installed at: ${MARKETPLACE_DIR}`, 'blue')
  log(`\n🚀 To start the worker:`, 'cyan')
  log(`   npm run worker:start`)
  log('')
}

// 메인 실행
const args = process.argv.slice(2)
const force = args.includes('--force') || args.includes('-f')

syncMarketplace(force)
