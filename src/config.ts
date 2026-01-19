/**
 * jikime-mem Configuration
 * 중앙 집중식 설정 관리
 */

export const CONFIG = {
  // Server
  WORKER_PORT: 37888,
  WORKER_HOST: '127.0.0.1',
  JSON_LIMIT: '10mb',

  // Database
  DB_CACHE_SIZE: 5,

  // Chroma
  CHROMA_CACHE_SIZE: 3,
  CHROMA_BATCH_SIZE: 100,
  CHROMA_CHUNK_SIZE: 2000,

  // Search
  SIMILARITY_THRESHOLD: 0.7,
  DEFAULT_LIMIT: 50,
  SEARCH_LIMIT: 10,

  // Response
  RESPONSE_MAX_CHARS: 50000,

  // Project Manager
  ACCESS_UPDATE_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes

  // API Version
  API_VERSION: '2.0.0'
} as const

export type Config = typeof CONFIG
