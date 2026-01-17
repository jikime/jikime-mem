/**
 * ChromaSync - 프로젝트별 Chroma Vector DB 동기화 서비스
 *
 * SQLite 데이터를 ChromaDB에 동기화하여 시맨틱 검색을 가능하게 합니다.
 * 프로젝트별로 별도의 vector-db 폴더와 컬렉션을 사용합니다.
 * chroma-mcp를 통해 MCP 프로토콜로 통신합니다.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'path'
import { homedir } from 'os'
import {
  getProjectVectorDbPath,
  getCachedProject,
  getDefaultVectorDbPath
} from './project-manager'

// Chroma 문서 인터페이스
interface ChromaDocument {
  id: string
  document: string
  metadata: Record<string, string | number>
}

// 검색 결과 인터페이스
export interface ChromaSearchResult {
  id: string
  document: string
  metadata: Record<string, string | number>
  distance: number
}

// LRU 캐시 설정
const MAX_CHROMA_CACHE_SIZE = 3  // 최대 3개 Chroma 인스턴스 캐시 (메모리 절약)

export class ChromaSync {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private connected: boolean = false
  private collectionName: string
  private vectorDbDir: string
  private projectPath: string
  private projectId: string
  private readonly BATCH_SIZE = 100

  constructor(projectPath: string) {
    this.projectPath = projectPath

    const project = getCachedProject(projectPath)
    this.projectId = project.id

    // 프로젝트별 컬렉션명과 vector-db 경로
    this.collectionName = `jm__${this.projectId}`
    this.vectorDbDir = getProjectVectorDbPath(projectPath)
  }

  /**
   * Chroma MCP 서버에 연결
   */
  private async ensureConnection(): Promise<void> {
    if (this.connected && this.client) {
      return
    }

    console.log(`[ChromaSync:${this.projectId}] Connecting to Chroma MCP server...`)

    try {
      const isWindows = process.platform === 'win32'

      const transportOptions: any = {
        command: 'uvx',
        args: [
          '--python', '3.12',
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.vectorDbDir
        ],
        stderr: 'ignore'
      }

      if (isWindows) {
        transportOptions.windowsHide = true
      }

      this.transport = new StdioClientTransport(transportOptions)

      this.client = new Client({
        name: `jikime-mem-chroma-sync-${this.projectId}`,
        version: '1.0.0'
      }, {
        capabilities: {}
      })

      await this.client.connect(this.transport)
      this.connected = true

      console.log(`[ChromaSync:${this.projectId}] Connected to Chroma MCP server`)
    } catch (error) {
      console.error(`[ChromaSync:${this.projectId}] Failed to connect:`, error)
      throw new Error(`Chroma connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 컬렉션 존재 확인 및 생성
   */
  private async ensureCollection(): Promise<void> {
    await this.ensureConnection()

    if (!this.client) {
      throw new Error('Chroma client not initialized')
    }

    try {
      await this.client.callTool({
        name: 'chroma_get_collection_info',
        arguments: {
          collection_name: this.collectionName
        }
      })
    } catch (error) {
      // 컬렉션이 없으면 생성
      console.log(`[ChromaSync:${this.projectId}] Creating collection:`, this.collectionName)

      try {
        await this.client.callTool({
          name: 'chroma_create_collection',
          arguments: {
            collection_name: this.collectionName,
            embedding_function_name: 'default'
          }
        })
        console.log(`[ChromaSync:${this.projectId}] Collection created`)
      } catch (createError) {
        console.error(`[ChromaSync:${this.projectId}] Failed to create collection:`, createError)
        throw createError
      }
    }
  }

  /**
   * 문서 추가
   */
  private async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) return

    await this.ensureCollection()

    if (!this.client) {
      throw new Error('Chroma client not initialized')
    }

    // 배치 처리
    for (let i = 0; i < documents.length; i += this.BATCH_SIZE) {
      const batch = documents.slice(i, i + this.BATCH_SIZE)

      await this.client.callTool({
        name: 'chroma_add_documents',
        arguments: {
          collection_name: this.collectionName,
          documents: batch.map(d => d.document),
          ids: batch.map(d => d.id),
          metadatas: batch.map(d => d.metadata)
        }
      })
    }
  }

  /**
   * 프롬프트 동기화
   */
  async syncPrompt(
    promptId: number | string,
    sessionId: string,
    content: string,
    timestamp: string
  ): Promise<void> {
    const doc: ChromaDocument = {
      id: `prompt_${promptId}`,
      document: content,
      metadata: {
        sqlite_id: String(promptId),
        doc_type: 'prompt',
        session_id: sessionId,
        project_id: this.projectId,
        created_at: timestamp
      }
    }

    try {
      await this.addDocuments([doc])
      console.log(`[ChromaSync:${this.projectId}] Prompt synced:`, promptId)
    } catch (error) {
      console.error(`[ChromaSync:${this.projectId}] Failed to sync prompt:`, error)
    }
  }

  /**
   * 응답 동기화
   */
  async syncResponse(
    responseId: number | string,
    sessionId: string,
    content: string,
    timestamp: string
  ): Promise<void> {
    // 긴 응답은 청크로 분할
    const chunks = this.splitContent(content, 2000)
    const docs: ChromaDocument[] = chunks.map((chunk, idx) => ({
      id: `response_${responseId}_${idx}`,
      document: chunk,
      metadata: {
        sqlite_id: String(responseId),
        doc_type: 'response',
        session_id: sessionId,
        project_id: this.projectId,
        chunk_index: idx,
        total_chunks: chunks.length,
        created_at: timestamp
      }
    }))

    try {
      await this.addDocuments(docs)
      console.log(`[ChromaSync:${this.projectId}] Response synced:`, responseId, `(${chunks.length} chunks)`)
    } catch (error) {
      console.error(`[ChromaSync:${this.projectId}] Failed to sync response:`, error)
    }
  }

  /**
   * 시맨틱 검색
   */
  async search(query: string, limit: number = 20): Promise<ChromaSearchResult[]> {
    await this.ensureCollection()

    if (!this.client) {
      throw new Error('Chroma client not initialized')
    }

    try {
      const result = await this.client.callTool({
        name: 'chroma_query_documents',
        arguments: {
          collection_name: this.collectionName,
          query_texts: [query],
          n_results: limit
        }
      })

      // MCP 응답 파싱
      const content = result.content as Array<{ type: string; text: string }>
      if (!content || content.length === 0) {
        return []
      }

      const data = JSON.parse(content[0].text)

      // Chroma 결과를 변환
      const results: ChromaSearchResult[] = []
      if (data.ids && data.ids[0]) {
        for (let i = 0; i < data.ids[0].length; i++) {
          results.push({
            id: data.ids[0][i],
            document: data.documents?.[0]?.[i] || '',
            metadata: data.metadatas?.[0]?.[i] || {},
            distance: data.distances?.[0]?.[i] || 0
          })
        }
      }

      return results
    } catch (error) {
      console.error(`[ChromaSync:${this.projectId}] Search failed:`, error)
      return []
    }
  }

  /**
   * 콘텐츠를 청크로 분할
   */
  private splitContent(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) {
      return [content]
    }

    const chunks: string[] = []
    let start = 0

    while (start < content.length) {
      let end = start + maxLength

      // 단어 경계에서 자르기
      if (end < content.length) {
        const lastSpace = content.lastIndexOf(' ', end)
        if (lastSpace > start) {
          end = lastSpace
        }
      }

      chunks.push(content.slice(start, end).trim())
      start = end
    }

    return chunks
  }

  /**
   * 프로젝트 ID 반환
   */
  getProjectId(): string {
    return this.projectId
  }

  /**
   * 프로젝트 경로 반환
   */
  getProjectPath(): string {
    return this.projectPath
  }

  /**
   * 연결 종료
   */
  async close(): Promise<void> {
    if (this.transport) {
      try {
        // 프로세스 종료
        const childProcess = (this.transport as any)._process
        if (childProcess && childProcess.pid) {
          process.kill(childProcess.pid, 'SIGTERM')
        }
      } catch {}
      this.transport = null
    }

    this.client = null
    this.connected = false
    console.log(`[ChromaSync:${this.projectId}] Connection closed`)
  }
}

// ========== Chroma 인스턴스 캐시 관리 ==========

class ChromaCache {
  private cache = new Map<string, ChromaSync>()
  private accessOrder: string[] = []
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(projectPath: string): ChromaSync {
    let chroma = this.cache.get(projectPath)

    if (chroma) {
      // LRU: 접근 순서 업데이트
      this.accessOrder = this.accessOrder.filter(p => p !== projectPath)
      this.accessOrder.push(projectPath)
      return chroma
    }

    // 새 Chroma 인스턴스 생성
    chroma = new ChromaSync(projectPath)

    // 캐시가 꽉 찼으면 가장 오래된 항목 제거
    if (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestPath = this.accessOrder.shift()
      if (oldestPath) {
        const oldChroma = this.cache.get(oldestPath)
        if (oldChroma) {
          console.log(`[ChromaCache] Evicting: ${oldChroma.getProjectId()}`)
          oldChroma.close().catch(() => {})
          this.cache.delete(oldestPath)
        }
      }
    }

    this.cache.set(projectPath, chroma)
    this.accessOrder.push(projectPath)

    return chroma
  }

  has(projectPath: string): boolean {
    return this.cache.has(projectPath)
  }

  async closeAll(): Promise<void> {
    for (const chroma of this.cache.values()) {
      await chroma.close()
    }
    this.cache.clear()
    this.accessOrder = []
  }

  size(): number {
    return this.cache.size
  }
}

// 싱글톤 캐시 인스턴스
const chromaCache = new ChromaCache(MAX_CHROMA_CACHE_SIZE)

/**
 * 프로젝트별 ChromaSync 인스턴스 가져오기
 */
export function getChromaSyncForProject(projectPath: string): ChromaSync {
  return chromaCache.get(projectPath)
}

/**
 * 모든 Chroma 연결 닫기
 */
export async function closeAllChromaConnections(): Promise<void> {
  await chromaCache.closeAll()
}

// ========== 레거시 호환성 ==========
// 기존 코드와의 호환을 위한 인터페이스
// 새 코드에서는 getChromaSyncForProject(projectPath)를 사용하세요.

let legacyChromaInstance: ChromaSync | null = null

/**
 * 레거시 ChromaSync 인스턴스 (기본 프로젝트용)
 * @deprecated getChromaSyncForProject(projectPath)를 사용하세요
 */
export function getChromaSync(): ChromaSync {
  if (!legacyChromaInstance) {
    // 레거시 호환: 기본 vector-db 경로 사용
    const defaultPath = process.cwd()
    legacyChromaInstance = new ChromaSync(defaultPath)
  }
  return legacyChromaInstance
}

/**
 * 레거시 Chroma 연결 닫기
 * @deprecated closeAllChromaConnections()를 사용하세요
 */
export async function closeChromaSync(): Promise<void> {
  if (legacyChromaInstance) {
    await legacyChromaInstance.close()
    legacyChromaInstance = null
  }
}
