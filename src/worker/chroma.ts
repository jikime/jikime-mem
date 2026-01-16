/**
 * ChromaSync - Chroma Vector DB 동기화 서비스
 *
 * SQLite 데이터를 ChromaDB에 동기화하여 시맨틱 검색을 가능하게 합니다.
 * chroma-mcp를 통해 MCP 프로토콜로 통신합니다.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'path'
import { homedir } from 'os'

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

export class ChromaSync {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private connected: boolean = false
  private collectionName: string
  private readonly VECTOR_DB_DIR: string
  private readonly BATCH_SIZE = 100

  constructor(project: string = 'jikime-mem') {
    this.collectionName = `jm__${project.replace(/[^a-zA-Z0-9]/g, '_')}`
    this.VECTOR_DB_DIR = join(homedir(), '.jikime-mem', 'vector-db')
  }

  /**
   * Chroma MCP 서버에 연결
   */
  private async ensureConnection(): Promise<void> {
    if (this.connected && this.client) {
      return
    }

    console.log('[ChromaSync] Connecting to Chroma MCP server...')

    try {
      const isWindows = process.platform === 'win32'

      const transportOptions: any = {
        command: 'uvx',
        args: [
          '--python', '3.12',
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.VECTOR_DB_DIR
        ],
        stderr: 'ignore'
      }

      if (isWindows) {
        transportOptions.windowsHide = true
      }

      this.transport = new StdioClientTransport(transportOptions)

      this.client = new Client({
        name: 'jikime-mem-chroma-sync',
        version: '1.0.0'
      }, {
        capabilities: {}
      })

      await this.client.connect(this.transport)
      this.connected = true

      console.log('[ChromaSync] Connected to Chroma MCP server')
    } catch (error) {
      console.error('[ChromaSync] Failed to connect:', error)
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
      console.log('[ChromaSync] Creating collection:', this.collectionName)

      try {
        await this.client.callTool({
          name: 'chroma_create_collection',
          arguments: {
            collection_name: this.collectionName,
            embedding_function_name: 'default'
          }
        })
        console.log('[ChromaSync] Collection created')
      } catch (createError) {
        console.error('[ChromaSync] Failed to create collection:', createError)
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
    promptId: number,
    sessionId: string,
    content: string,
    timestamp: string
  ): Promise<void> {
    const doc: ChromaDocument = {
      id: `prompt_${promptId}`,
      document: content,
      metadata: {
        sqlite_id: promptId,
        doc_type: 'prompt',
        session_id: sessionId,
        created_at: timestamp
      }
    }

    try {
      await this.addDocuments([doc])
      console.log('[ChromaSync] Prompt synced:', promptId)
    } catch (error) {
      console.error('[ChromaSync] Failed to sync prompt:', error)
    }
  }

  /**
   * 응답 동기화
   */
  async syncResponse(
    responseId: number,
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
        sqlite_id: responseId,
        doc_type: 'response',
        session_id: sessionId,
        chunk_index: idx,
        total_chunks: chunks.length,
        created_at: timestamp
      }
    }))

    try {
      await this.addDocuments(docs)
      console.log('[ChromaSync] Response synced:', responseId, `(${chunks.length} chunks)`)
    } catch (error) {
      console.error('[ChromaSync] Failed to sync response:', error)
    }
  }

  /**
   * 관찰(도구 사용) 동기화
   */
  async syncObservation(
    observationId: number,
    sessionId: string,
    toolName: string,
    toolInput: string,
    toolResponse: string,
    timestamp: string
  ): Promise<void> {
    const docs: ChromaDocument[] = []

    // 도구 입력
    if (toolInput) {
      docs.push({
        id: `observation_${observationId}_input`,
        document: `[${toolName}] ${toolInput}`,
        metadata: {
          sqlite_id: observationId,
          doc_type: 'observation_input',
          session_id: sessionId,
          tool_name: toolName,
          created_at: timestamp
        }
      })
    }

    // 도구 응답 (청크 분할)
    if (toolResponse) {
      const chunks = this.splitContent(toolResponse, 2000)
      chunks.forEach((chunk, idx) => {
        docs.push({
          id: `observation_${observationId}_response_${idx}`,
          document: chunk,
          metadata: {
            sqlite_id: observationId,
            doc_type: 'observation_response',
            session_id: sessionId,
            tool_name: toolName,
            chunk_index: idx,
            total_chunks: chunks.length,
            created_at: timestamp
          }
        })
      })
    }

    try {
      await this.addDocuments(docs)
      console.log('[ChromaSync] Observation synced:', observationId)
    } catch (error) {
      console.error('[ChromaSync] Failed to sync observation:', error)
    }
  }

  /**
   * 요약 동기화
   */
  async syncSummary(
    summaryId: number,
    sessionId: string,
    summary: string,
    aiSummary: string | null,
    timestamp: string
  ): Promise<void> {
    const docs: ChromaDocument[] = []

    // 통계 요약
    if (summary) {
      docs.push({
        id: `summary_${summaryId}_stats`,
        document: summary,
        metadata: {
          sqlite_id: summaryId,
          doc_type: 'summary_stats',
          session_id: sessionId,
          created_at: timestamp
        }
      })
    }

    // AI 요약
    if (aiSummary) {
      docs.push({
        id: `summary_${summaryId}_ai`,
        document: aiSummary,
        metadata: {
          sqlite_id: summaryId,
          doc_type: 'summary_ai',
          session_id: sessionId,
          created_at: timestamp
        }
      })
    }

    try {
      await this.addDocuments(docs)
      console.log('[ChromaSync] Summary synced:', summaryId)
    } catch (error) {
      console.error('[ChromaSync] Failed to sync summary:', error)
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
      console.error('[ChromaSync] Search failed:', error)
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
    console.log('[ChromaSync] Connection closed')
  }
}

// 싱글톤 인스턴스
let chromaSyncInstance: ChromaSync | null = null

export function getChromaSync(): ChromaSync {
  if (!chromaSyncInstance) {
    chromaSyncInstance = new ChromaSync()
  }
  return chromaSyncInstance
}

export async function closeChromaSync(): Promise<void> {
  if (chromaSyncInstance) {
    await chromaSyncInstance.close()
    chromaSyncInstance = null
  }
}
