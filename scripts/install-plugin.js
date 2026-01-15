#!/usr/bin/env node
/**
 * jikime-mem Plugin Installer
 *
 * Claude Code의 /plugin add 명령어와 동일한 방식으로 플러그인을 설치합니다.
 *
 * 설치 위치:
 * - ~/.claude/plugins/marketplaces/jikime/     (전체 프로젝트)
 * - ~/.claude/plugins/cache/jikime/jikime-mem/<version>/  (플러그인 캐시)
 *
 * Usage:
 *   node scripts/install-plugin.js          # 설치
 *   node scripts/install-plugin.js --force  # 강제 재설치
 *   node scripts/install-plugin.js --uninstall  # 제거
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

// Claude Code 플러그인 디렉토리
const CLAUDE_PLUGINS_DIR = join(homedir(), '.claude', 'plugins')
const MARKETPLACES_DIR = join(CLAUDE_PLUGINS_DIR, 'marketplaces')
const CACHE_DIR = join(CLAUDE_PLUGINS_DIR, 'cache')
const INSTALLED_PLUGINS_FILE = join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json')
const KNOWN_MARKETPLACES_FILE = join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json')

// 플러그인 정보
const MARKETPLACE_NAME = 'jikime'
const PLUGIN_NAME = 'jikime-mem'

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

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function writeJsonFile(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function installPlugin(force = false) {
  log('\n🔧 Installing jikime-mem plugin...', 'cyan')
  log('─'.repeat(50))

  const version = getPluginVersion()
  const pluginId = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
  const marketplaceDir = join(MARKETPLACES_DIR, MARKETPLACE_NAME)
  const cacheDir = join(CACHE_DIR, MARKETPLACE_NAME, PLUGIN_NAME, version)

  // 기존 설치 확인
  if (existsSync(marketplaceDir) && !force) {
    log(`⚠️  Plugin already installed. Use --force to reinstall.`, 'yellow')
    return false
  }

  // 1. 마켓플레이스 디렉토리에 전체 프로젝트 복사
  log(`\n📦 Step 1: Syncing to marketplace...`, 'blue')
  if (existsSync(marketplaceDir)) {
    rmSync(marketplaceDir, { recursive: true, force: true })
  }
  mkdirSync(marketplaceDir, { recursive: true })

  try {
    execSync(
      `rsync -av --exclude=.git --exclude=node_modules --exclude=.next --exclude=prisma/*.db ./ "${marketplaceDir}/"`,
      { cwd: PROJECT_ROOT, stdio: 'inherit' }
    )
  } catch (error) {
    log(`❌ Failed to sync marketplace: ${error.message}`, 'red')
    return false
  }

  // 2. npm install & build in marketplace
  log(`\n📦 Step 2: Installing dependencies...`, 'blue')
  try {
    execSync('npm install', { cwd: marketplaceDir, stdio: 'inherit' })
    execSync('npm run db:generate && npm run db:push', { cwd: marketplaceDir, stdio: 'inherit' })
    execSync('npm run build', { cwd: marketplaceDir, stdio: 'inherit' })
  } catch (error) {
    log(`⚠️  Build step had issues: ${error.message}`, 'yellow')
  }

  // 3. 캐시 디렉토리에 plugin/ 폴더 복사
  log(`\n📦 Step 3: Creating plugin cache...`, 'blue')
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true })
  }
  mkdirSync(cacheDir, { recursive: true })
  cpSync(join(marketplaceDir, 'plugin'), cacheDir, { recursive: true })

  // 4. known_marketplaces.json 업데이트
  log(`\n📦 Step 4: Registering marketplace...`, 'blue')
  const knownMarketplaces = readJsonFile(KNOWN_MARKETPLACES_FILE) || {}
  knownMarketplaces[MARKETPLACE_NAME] = {
    source: {
      source: 'local',
      path: PROJECT_ROOT
    },
    installLocation: marketplaceDir,
    lastUpdated: new Date().toISOString()
  }
  writeJsonFile(KNOWN_MARKETPLACES_FILE, knownMarketplaces)

  // 5. installed_plugins.json 업데이트
  log(`\n📦 Step 5: Registering plugin...`, 'blue')
  const installedPlugins = readJsonFile(INSTALLED_PLUGINS_FILE) || { version: 2, plugins: {} }
  installedPlugins.plugins[pluginId] = [
    {
      scope: 'user',
      installPath: cacheDir,
      version: version,
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    }
  ]
  writeJsonFile(INSTALLED_PLUGINS_FILE, installedPlugins)

  log('\n' + '─'.repeat(50))
  log(`✅ Plugin installed successfully!`, 'green')
  log(`\n📍 Marketplace: ${marketplaceDir}`, 'blue')
  log(`📍 Cache: ${cacheDir}`, 'blue')
  log(`\n🎉 Restart Claude Code to activate the plugin!`, 'cyan')
  log('')

  return true
}

function uninstallPlugin() {
  log('\n🗑️  Uninstalling jikime-mem plugin...', 'cyan')
  log('─'.repeat(50))

  const version = getPluginVersion()
  const pluginId = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
  const marketplaceDir = join(MARKETPLACES_DIR, MARKETPLACE_NAME)
  const cacheDir = join(CACHE_DIR, MARKETPLACE_NAME)

  // 1. 마켓플레이스 디렉토리 삭제
  if (existsSync(marketplaceDir)) {
    log(`🗑️  Removing marketplace: ${marketplaceDir}`, 'blue')
    rmSync(marketplaceDir, { recursive: true, force: true })
  }

  // 2. 캐시 디렉토리 삭제
  if (existsSync(cacheDir)) {
    log(`🗑️  Removing cache: ${cacheDir}`, 'blue')
    rmSync(cacheDir, { recursive: true, force: true })
  }

  // 3. known_marketplaces.json에서 제거
  const knownMarketplaces = readJsonFile(KNOWN_MARKETPLACES_FILE)
  if (knownMarketplaces && knownMarketplaces[MARKETPLACE_NAME]) {
    delete knownMarketplaces[MARKETPLACE_NAME]
    writeJsonFile(KNOWN_MARKETPLACES_FILE, knownMarketplaces)
    log(`📝 Removed from known_marketplaces.json`, 'blue')
  }

  // 4. installed_plugins.json에서 제거
  const installedPlugins = readJsonFile(INSTALLED_PLUGINS_FILE)
  if (installedPlugins && installedPlugins.plugins && installedPlugins.plugins[pluginId]) {
    delete installedPlugins.plugins[pluginId]
    writeJsonFile(INSTALLED_PLUGINS_FILE, installedPlugins)
    log(`📝 Removed from installed_plugins.json`, 'blue')
  }

  log('\n' + '─'.repeat(50))
  log(`✅ Plugin uninstalled successfully!`, 'green')
  log(`\n🔄 Restart Claude Code to complete uninstallation.`, 'cyan')
  log('')
}

// 메인 실행
const args = process.argv.slice(2)

if (args.includes('--uninstall') || args.includes('-u')) {
  uninstallPlugin()
} else {
  const force = args.includes('--force') || args.includes('-f')
  installPlugin(force)
}
