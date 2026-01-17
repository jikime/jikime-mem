/**
 * Project Manager - 프로젝트별 데이터 격리 관리
 *
 * 기능:
 * - 프로젝트 경로 → 해시 ID 변환
 * - 프로젝트별 데이터 디렉토리 관리
 * - projects.json 매핑 관리
 * - LRU 캐시로 성능 최적화
 */

import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

// 상수 정의
const DATA_DIR = join(homedir(), '.jikime-mem')
const PROJECTS_DIR = join(DATA_DIR, 'projects')
const PROJECTS_FILE = join(DATA_DIR, 'projects.json')

// 기본 프로젝트 (마이그레이션 및 폴백용)
const DEFAULT_PROJECT_ID = '_default'

// LRU 캐시 설정
const MAX_CACHE_SIZE = 10  // 최대 10개 프로젝트 캐시

// 프로젝트 정보 인터페이스
export interface ProjectInfo {
  id: string           // 해시 ID
  path: string         // 원본 경로
  name: string         // 프로젝트 이름 (폴더명)
  dataDir: string      // 데이터 디렉토리 경로
  createdAt: string    // 생성 시간
  lastAccessedAt: string // 마지막 접근 시간
}

// 프로젝트 목록 인터페이스
interface ProjectsRegistry {
  version: number
  projects: Record<string, ProjectInfo>  // id -> ProjectInfo
  pathIndex: Record<string, string>      // path -> id (빠른 조회용)
}

/**
 * 프로젝트 경로를 안전한 해시 ID로 변환
 * - 짧고 읽기 쉬운 ID 생성
 * - 충돌 가능성 최소화
 */
export function hashProjectPath(projectPath: string): string {
  // 경로 정규화 (trailing slash 제거, 소문자 변환은 하지 않음 - 대소문자 구분 유지)
  const normalized = projectPath.replace(/\/+$/, '')

  // SHA256 해시 생성 후 앞 12자리만 사용
  const hash = createHash('sha256').update(normalized).digest('hex').substring(0, 12)

  return hash
}

/**
 * 프로젝트 경로에서 이름 추출
 */
export function extractProjectName(projectPath: string): string {
  const parts = projectPath.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || 'unknown'
}

/**
 * 프로젝트 레지스트리 로드
 */
function loadProjectsRegistry(): ProjectsRegistry {
  try {
    if (existsSync(PROJECTS_FILE)) {
      const data = readFileSync(PROJECTS_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('[ProjectManager] Failed to load projects registry:', error)
  }

  return {
    version: 1,
    projects: {},
    pathIndex: {}
  }
}

/**
 * 프로젝트 레지스트리 저장
 */
function saveProjectsRegistry(registry: ProjectsRegistry): void {
  try {
    ensureDir(DATA_DIR)
    writeFileSync(PROJECTS_FILE, JSON.stringify(registry, null, 2))
  } catch (error) {
    console.error('[ProjectManager] Failed to save projects registry:', error)
  }
}

/**
 * 디렉토리 생성 (없으면)
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * 프로젝트 정보 조회 또는 생성
 */
export function getOrCreateProject(projectPath: string): ProjectInfo {
  const registry = loadProjectsRegistry()

  // 경로로 기존 프로젝트 찾기
  const existingId = registry.pathIndex[projectPath]
  if (existingId && registry.projects[existingId]) {
    const project = registry.projects[existingId]

    // 마지막 접근 시간 업데이트
    project.lastAccessedAt = new Date().toISOString()
    saveProjectsRegistry(registry)

    return project
  }

  // 새 프로젝트 생성
  const id = hashProjectPath(projectPath)
  const name = extractProjectName(projectPath)
  const dataDir = join(PROJECTS_DIR, id)
  const now = new Date().toISOString()

  const project: ProjectInfo = {
    id,
    path: projectPath,
    name,
    dataDir,
    createdAt: now,
    lastAccessedAt: now
  }

  // 데이터 디렉토리 생성
  ensureDir(dataDir)
  ensureDir(join(dataDir, 'vector-db'))

  // 레지스트리에 추가
  registry.projects[id] = project
  registry.pathIndex[projectPath] = id
  saveProjectsRegistry(registry)

  console.log(`[ProjectManager] New project registered: ${name} (${id})`)

  return project
}

/**
 * 프로젝트 ID로 조회
 */
export function getProjectById(projectId: string): ProjectInfo | null {
  const registry = loadProjectsRegistry()
  return registry.projects[projectId] || null
}

/**
 * 모든 프로젝트 목록 조회
 */
export function getAllProjects(): ProjectInfo[] {
  const registry = loadProjectsRegistry()
  return Object.values(registry.projects).sort((a, b) =>
    new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
  )
}

/**
 * 프로젝트 데이터 디렉토리 경로 반환
 */
export function getProjectDataDir(projectPath: string): string {
  const project = getOrCreateProject(projectPath)
  return project.dataDir
}

/**
 * 프로젝트 DB 경로 반환
 */
export function getProjectDbPath(projectPath: string): string {
  const dataDir = getProjectDataDir(projectPath)
  return join(dataDir, 'jikime-mem.db')
}

/**
 * 프로젝트 Vector DB 경로 반환
 */
export function getProjectVectorDbPath(projectPath: string): string {
  const dataDir = getProjectDataDir(projectPath)
  return join(dataDir, 'vector-db')
}

/**
 * 기본(레거시) 데이터 경로 반환
 * - 마이그레이션 및 폴백용
 */
export function getDefaultDataDir(): string {
  return DATA_DIR
}

export function getDefaultDbPath(): string {
  return join(DATA_DIR, 'jikime-mem.db')
}

export function getDefaultVectorDbPath(): string {
  return join(DATA_DIR, 'vector-db')
}

// LRU 캐시 구현
class LRUCache<T> {
  private cache = new Map<string, T>()
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // LRU: 접근 시 맨 뒤로 이동
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: string, value: T): void {
    // 이미 있으면 삭제 (순서 갱신용)
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // 캐시가 꽉 찼으면 가장 오래된 항목 삭제
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, value)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  keys(): string[] {
    return Array.from(this.cache.keys())
  }
}

// 프로젝트별 리소스 캐시
export const projectCache = new LRUCache<ProjectInfo>(MAX_CACHE_SIZE)

/**
 * 캐시된 프로젝트 정보 조회
 */
export function getCachedProject(projectPath: string): ProjectInfo {
  let project = projectCache.get(projectPath)

  if (!project) {
    project = getOrCreateProject(projectPath)
    projectCache.set(projectPath, project)
  }

  return project
}

/**
 * 기본 데이터 디렉토리 초기화
 */
export function initializeDataDirs(): void {
  ensureDir(DATA_DIR)
  ensureDir(PROJECTS_DIR)

  // 기존 레거시 데이터 확인
  const legacyDbPath = getDefaultDbPath()
  if (existsSync(legacyDbPath)) {
    console.log('[ProjectManager] Legacy database found at:', legacyDbPath)
  }
}

// 모듈 로드 시 디렉토리 초기화
initializeDataDirs()
