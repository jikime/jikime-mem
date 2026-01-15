#!/usr/bin/env node
/**
 * Smart Install Script for jikime-mem
 *
 * Ensures Bun runtime is installed (auto-installs if missing),
 * handles dependency installation, database setup, and Next.js build.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const MARKETPLACE_NAME = 'jikime';
const ROOT = join(homedir(), '.claude', 'plugins', 'marketplaces', MARKETPLACE_NAME);
const MARKER = join(ROOT, '.install-version');
const IS_WINDOWS = process.platform === 'win32';

/**
 * Check if Bun is installed and accessible
 */
function isBunInstalled() {
  try {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    });
    if (result.status === 0) return true;
  } catch {
    // PATH check failed, try common installation paths
  }

  // Check common installation paths
  const bunPaths = IS_WINDOWS
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];

  return bunPaths.some(existsSync);
}

/**
 * Get the Bun executable path
 */
function getBunPath() {
  try {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    });
    if (result.status === 0) return 'bun';
  } catch {
    // Not in PATH
  }

  const bunPaths = IS_WINDOWS
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];

  for (const bunPath of bunPaths) {
    if (existsSync(bunPath)) return bunPath;
  }

  return null;
}

/**
 * Get Bun version if installed
 */
function getBunVersion() {
  const bunPath = getBunPath();
  if (!bunPath) return null;

  try {
    const result = spawnSync(bunPath, ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Install Bun runtime
 */
function installBun() {
  console.error('📦 Installing Bun runtime...');
  try {
    if (IS_WINDOWS) {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', { stdio: 'inherit', shell: true });
    } else {
      execSync('curl -fsSL https://bun.sh/install | bash', { stdio: 'inherit', shell: true });
    }
    console.error('✅ Bun installed successfully');
  } catch (error) {
    console.error('❌ Failed to install Bun:', error.message);
    throw error;
  }
}

/**
 * Check if dependencies need to be installed
 */
function needsInstall() {
  if (!existsSync(join(ROOT, 'node_modules'))) return true;
  if (!existsSync(join(ROOT, '.next'))) return true;
  if (!existsSync(join(ROOT, '.env'))) return true;

  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const marker = JSON.parse(readFileSync(MARKER, 'utf-8'));
    return pkg.version !== marker.version || getBunVersion() !== marker.bun;
  } catch {
    return true;
  }
}

/**
 * Ensure .env file exists
 */
function ensureEnvFile() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    console.error('📝 Creating .env file...');
    writeFileSync(envPath, 'DATABASE_URL="file:./prisma/prisma/jikime-mem.db"\n');
    console.error('✅ .env file created');
  }
}

/**
 * Install dependencies using Bun with npm fallback
 */
function installDeps() {
  const bunPath = getBunPath();
  if (!bunPath) {
    throw new Error('Bun executable not found');
  }

  console.error('📦 Installing dependencies...');

  const bunCmd = IS_WINDOWS && bunPath.includes(' ') ? `"${bunPath}"` : bunPath;

  let bunSucceeded = false;
  try {
    execSync(`${bunCmd} install`, { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
    bunSucceeded = true;
  } catch {
    try {
      execSync(`${bunCmd} install --force`, { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
      bunSucceeded = true;
    } catch {
      // Bun failed, will try npm fallback
    }
  }

  if (!bunSucceeded) {
    console.error('⚠️  Bun install failed, falling back to npm...');
    try {
      execSync('npm install', { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
    } catch (npmError) {
      throw new Error('Both bun and npm install failed: ' + npmError.message);
    }
  }

  console.error('✅ Dependencies installed');
}

/**
 * Setup database
 */
function setupDatabase() {
  console.error('🗄️  Setting up database...');
  try {
    execSync('npm run db:generate', { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
    execSync('npm run db:push', { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
    console.error('✅ Database ready');
  } catch (error) {
    console.error('⚠️  Database setup warning:', error.message);
  }
}

/**
 * Build Next.js application
 */
function buildApp() {
  if (existsSync(join(ROOT, '.next'))) {
    console.error('✅ Next.js build already exists');
    return;
  }

  console.error('🔨 Building Next.js application...');
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: IS_WINDOWS });
    console.error('✅ Build completed');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    throw error;
  }
}

/**
 * Write version marker
 */
function writeMarker() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    writeFileSync(MARKER, JSON.stringify({
      version: pkg.version,
      bun: getBunVersion(),
      installedAt: new Date().toISOString()
    }, null, 2));
  } catch (error) {
    console.error('⚠️  Could not write version marker:', error.message);
  }
}

// Main execution
try {
  console.error('\n🔧 jikime-mem Smart Install\n');

  // Step 1: Ensure Bun is installed
  if (!isBunInstalled()) {
    installBun();
    if (!isBunInstalled()) {
      console.error('❌ Bun is required but not available');
      console.error('   Please restart your terminal after installation');
      process.exit(1);
    }
  } else {
    console.error(`✅ Bun ${getBunVersion()} found`);
  }

  // Step 2: Check if installation needed
  if (needsInstall()) {
    console.error('📦 Installation needed, setting up...\n');

    // Ensure .env exists
    ensureEnvFile();

    // Install dependencies
    installDeps();

    // Setup database
    setupDatabase();

    // Build Next.js
    buildApp();

    // Write marker
    writeMarker();

    console.error('\n✅ jikime-mem installation complete!\n');
  } else {
    console.error('✅ jikime-mem is up to date\n');
  }

} catch (e) {
  console.error('❌ Installation failed:', e.message);
  process.exit(1);
}
