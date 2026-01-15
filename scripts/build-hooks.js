#!/usr/bin/env node
/**
 * Build Hooks Script
 * 플러그인 훅 스크립트를 빌드하고 실행 권한을 설정합니다
 */

import { existsSync, readdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const HOOKS_DIR = join(PROJECT_ROOT, 'plugin', 'scripts')

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

function buildHooks() {
  log('\n🔧 Building jikime-mem hooks...', 'cyan')
  log('─'.repeat(40))

  if (!existsSync(HOOKS_DIR)) {
    log(`❌ Hooks directory not found: ${HOOKS_DIR}`, 'red')
    process.exit(1)
  }

  const hookFiles = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js'))

  if (hookFiles.length === 0) {
    log('⚠️  No hook files found', 'yellow')
    return
  }

  log(`Found ${hookFiles.length} hook file(s):\n`, 'blue')

  hookFiles.forEach(file => {
    const filePath = join(HOOKS_DIR, file)

    try {
      // 실행 권한 설정 (Unix 계열)
      chmodSync(filePath, 0o755)
      log(`  ✅ ${file}`, 'green')
    } catch (error) {
      log(`  ⚠️  ${file} - Could not set permissions: ${error.message}`, 'yellow')
    }
  })

  log('\n' + '─'.repeat(40))
  log('✅ Hooks build completed!', 'green')
  log('\n📝 Hook files are ready at:', 'blue')
  log(`   ${HOOKS_DIR}\n`)
}

// 실행
buildHooks()
