#!/usr/bin/env node
/**
 * Smart Install Script for jikime-mem
 *
 * Ensures Bun runtime is installed (auto-installs if missing).
 * No npm install or build required - everything is bundled!
 */
import { existsSync } from 'fs'
import { execSync, spawnSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'

const IS_WINDOWS = process.platform === 'win32'

/**
 * Check if Bun is installed and accessible
 */
function isBunInstalled() {
  try {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    })
    if (result.status === 0) return true
  } catch {
    // PATH check failed, try common installation paths
  }

  // Check common installation paths
  const bunPaths = IS_WINDOWS
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun']

  return bunPaths.some(existsSync)
}

/**
 * Get Bun version if installed
 */
function getBunVersion() {
  try {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    })
    return result.status === 0 ? result.stdout.trim() : null
  } catch {
    return null
  }
}

/**
 * Install Bun runtime
 */
function installBun() {
  console.error('📦 Installing Bun runtime...')
  try {
    if (IS_WINDOWS) {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', { stdio: 'inherit', shell: true })
    } else {
      execSync('curl -fsSL https://bun.sh/install | bash', { stdio: 'inherit', shell: true })
    }
    console.error('✅ Bun installed successfully')
  } catch (error) {
    console.error('❌ Failed to install Bun:', error.message)
    throw error
  }
}

// Main execution
try {
  console.error('\n🔧 jikime-mem Smart Install\n')

  // Step 1: Ensure Bun is installed
  if (!isBunInstalled()) {
    installBun()
    if (!isBunInstalled()) {
      console.error('❌ Bun is required but not available')
      console.error('   Please restart your terminal after installation')
      process.exit(1)
    }
  } else {
    console.error(`✅ Bun ${getBunVersion()} found`)
  }

  // No npm install or build needed - everything is bundled!
  console.error('✅ jikime-mem is ready to use!\n')

} catch (e) {
  console.error('❌ Installation failed:', e.message)
  process.exit(1)
}
