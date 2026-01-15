#!/usr/bin/env bun
/**
 * jikime-mem 빌드 스크립트
 * Bun 번들러를 사용하여 worker-service.js 및 viewer 생성
 */
import { join } from 'path'
import { cpSync, existsSync, mkdirSync, copyFileSync } from 'fs'

const ROOT = import.meta.dir.replace('/scripts', '')
const WORKER_DIR = join(ROOT, 'src/worker')
const VIEWER_DIR = join(ROOT, 'src/viewer')
const PLUGIN_DIR = join(ROOT, 'plugin')
const OUTPUT_DIR = join(PLUGIN_DIR, 'scripts')
const VIEWER_OUTPUT_DIR = join(OUTPUT_DIR, 'viewer')

console.log('🔨 Building jikime-mem...\n')

// 출력 디렉토리 생성
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}
if (!existsSync(VIEWER_OUTPUT_DIR)) {
  mkdirSync(VIEWER_OUTPUT_DIR, { recursive: true })
}

// 1. Worker 서비스 빌드
console.log('📦 Building worker service...')
const workerResult = await Bun.build({
  entrypoints: [join(WORKER_DIR, 'index.ts')],
  outdir: OUTPUT_DIR,
  target: 'bun',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  naming: {
    entry: 'worker-service.js'
  },
  external: ['bun:sqlite'],
})

if (!workerResult.success) {
  console.error('❌ Worker build failed:')
  for (const log of workerResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

for (const output of workerResult.outputs) {
  const sizeKB = (output.size / 1024).toFixed(1)
  console.log(`   ✅ ${output.path} (${sizeKB} KB)`)
}

// 2. Viewer 빌드 (React)
console.log('\n📦 Building viewer...')
const viewerResult = await Bun.build({
  entrypoints: [join(VIEWER_DIR, 'index.tsx')],
  outdir: VIEWER_OUTPUT_DIR,
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  naming: {
    entry: 'viewer.js'
  },
})

if (!viewerResult.success) {
  console.error('❌ Viewer build failed:')
  for (const log of viewerResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

for (const output of viewerResult.outputs) {
  const sizeKB = (output.size / 1024).toFixed(1)
  console.log(`   ✅ ${output.path} (${sizeKB} KB)`)
}

// 3. Viewer HTML 복사
console.log('\n📋 Copying viewer assets...')
copyFileSync(
  join(VIEWER_DIR, 'index.html'),
  join(VIEWER_OUTPUT_DIR, 'index.html')
)
console.log(`   ✅ ${join(VIEWER_OUTPUT_DIR, 'index.html')}`)

console.log('\n✅ Build completed successfully!')
