#!/usr/bin/env bun
/**
 * jikime-mem 빌드 스크립트
 * Bun 번들러를 사용하여 worker-service.cjs 생성
 */
import { join } from 'path'
import { cpSync, existsSync, mkdirSync } from 'fs'

const ROOT = import.meta.dir.replace('/scripts', '')
const SRC_DIR = join(ROOT, 'src/worker')
const PLUGIN_DIR = join(ROOT, 'plugin')
const OUTPUT_DIR = join(PLUGIN_DIR, 'scripts')

console.log('🔨 Building jikime-mem worker...\n')

// 출력 디렉토리 생성
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Bun 번들러로 빌드
const result = await Bun.build({
  entrypoints: [join(SRC_DIR, 'index.ts')],
  outdir: OUTPUT_DIR,
  target: 'bun',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  naming: {
    entry: 'worker-service.js'
  },
  external: ['bun:sqlite'], // Bun 내장 모듈은 external
})

if (!result.success) {
  console.error('❌ Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// 빌드된 파일 정보 출력
for (const output of result.outputs) {
  const sizeKB = (output.size / 1024).toFixed(1)
  console.log(`✅ Built: ${output.path} (${sizeKB} KB)`)
}

console.log('\n✅ Build completed successfully!')
