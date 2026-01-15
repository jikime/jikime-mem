/**
 * ChromaSync Service
 *
 * Syncs prompts and observations to ChromaDB via MCP.
 * Uses uvx + chroma-mcp for local vector database without Docker.
 *
 * Design: Fail-fast - if Chroma is unavailable, operations throw errors.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'path'
import os from 'os'

const PACKAGE_VERSION = '1.0.0'

interface ChromaDocument {
  id: string
  document: string
  metadata: Record<string, string | number>
}

interface SearchResult {
  id: string
  type: 'prompt' | 'observation'
  content: string
  similarity: number
  metadata: Record<string, any>
}

export class ChromaSync {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private connected: boolean = false
  private collectionName: string
  private readonly VECTOR_DB_DIR: string
  private readonly BATCH_SIZE = 100
  private readonly PYTHON_VERSION = '3.12'

  constructor(projectName: string = 'default') {
    // Collection name with project prefix
    this.collectionName = `jm__${projectName.replace(/[^a-zA-Z0-9]/g, '_')}`
    this.VECTOR_DB_DIR = path.join(os.homedir(), '.jikime-mem', 'vector-db')
  }

  /**
   * Ensure MCP client is connected to Chroma server
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
          '--python', this.PYTHON_VERSION,
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.VECTOR_DB_DIR
        ],
        stderr: 'ignore'
      }

      // Windows: hide console window
      if (isWindows) {
        transportOptions.windowsHide = true
      }

      this.transport = new StdioClientTransport(transportOptions)

      this.client = new Client({
        name: 'jikime-mem-chroma-sync',
        version: PACKAGE_VERSION
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
   * Ensure collection exists, create if needed
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
      // Collection doesn't exist, create it
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
        throw new Error(`Collection creation failed: ${createError instanceof Error ? createError.message : String(createError)}`)
      }
    }
  }

  /**
   * Add documents to Chroma in batch
   */
  private async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) {
      return
    }

    await this.ensureCollection()

    if (!this.client) {
      throw new Error('Chroma client not initialized')
    }

    try {
      await this.client.callTool({
        name: 'chroma_add_documents',
        arguments: {
          collection_name: this.collectionName,
          documents: documents.map(d => d.document),
          ids: documents.map(d => d.id),
          metadatas: documents.map(d => d.metadata)
        }
      })
    } catch (error) {
      throw new Error(`Document add failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Sync a user prompt to Chroma
   */
  async syncPrompt(
    promptId: string,
    sessionId: string,
    content: string,
    timestamp: Date
  ): Promise<void> {
    const document: ChromaDocument = {
      id: `prompt_${promptId}`,
      document: content,
      metadata: {
        doc_type: 'prompt',
        session_id: sessionId,
        created_at_epoch: Math.floor(timestamp.getTime() / 1000)
      }
    }

    await this.addDocuments([document])
    console.log('[ChromaSync] Synced prompt:', promptId)
  }

  /**
   * Sync a tool observation to Chroma
   */
  async syncObservation(
    observationId: string,
    sessionId: string,
    toolName: string,
    input: string,
    output: string,
    timestamp: Date
  ): Promise<void> {
    // Combine tool info for better search
    const combinedContent = `Tool: ${toolName}\nInput: ${input}\nOutput: ${output}`

    const document: ChromaDocument = {
      id: `obs_${observationId}`,
      document: combinedContent,
      metadata: {
        doc_type: 'observation',
        session_id: sessionId,
        tool_name: toolName,
        created_at_epoch: Math.floor(timestamp.getTime() / 1000)
      }
    }

    await this.addDocuments([document])
    console.log('[ChromaSync] Synced observation:', observationId)
  }

  /**
   * Semantic search in Chroma
   */
  async search(
    query: string,
    limit: number = 10,
    docType?: 'prompt' | 'observation'
  ): Promise<SearchResult[]> {
    await this.ensureConnection()

    if (!this.client) {
      throw new Error('Chroma client not initialized')
    }

    const whereFilter = docType ? { doc_type: docType } : undefined

    try {
      const result = await this.client.callTool({
        name: 'chroma_query_documents',
        arguments: {
          collection_name: this.collectionName,
          query_texts: [query],
          n_results: limit,
          include: ['documents', 'metadatas', 'distances'],
          where: whereFilter ? JSON.stringify(whereFilter) : undefined
        }
      }) as { content: Array<{ type: string; text: string }> }

      const data = result.content[0]
      if (data.type !== 'text') {
        throw new Error('Unexpected response type')
      }

      const parsed = JSON.parse(data.text) as {
        ids?: string[][]
        documents?: string[][]
        distances?: number[][]
        metadatas?: Record<string, unknown>[][]
      }
      const ids = parsed.ids?.[0] || []
      const documents = parsed.documents?.[0] || []
      const distances = parsed.distances?.[0] || []
      const metadatas = parsed.metadatas?.[0] || []

      const results: SearchResult[] = []

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        const isPrompt = id.startsWith('prompt_')

        results.push({
          id: isPrompt ? id.replace('prompt_', '') : id.replace('obs_', ''),
          type: isPrompt ? 'prompt' : 'observation',
          content: documents[i] || '',
          similarity: 1 - (distances[i] || 0), // Convert distance to similarity
          metadata: metadatas[i] || {}
        })
      }

      return results
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Handle connection errors
      if (
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000')
      ) {
        this.connected = false
        this.client = null
        throw new Error(`Chroma search failed - connection lost: ${errorMessage}`)
      }

      throw error
    }
  }

  /**
   * Check if Chroma is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureConnection()
      return true
    } catch {
      return false
    }
  }

  /**
   * Close the Chroma client connection
   */
  async close(): Promise<void> {
    if (!this.connected && !this.client && !this.transport) {
      return
    }

    if (this.client) {
      await this.client.close()
    }

    if (this.transport) {
      await this.transport.close()
    }

    console.log('[ChromaSync] Connection closed')

    this.connected = false
    this.client = null
    this.transport = null
  }
}

// Singleton instance for the application
let chromaSyncInstance: ChromaSync | null = null

export function getChromaSync(projectName?: string): ChromaSync {
  if (!chromaSyncInstance) {
    chromaSyncInstance = new ChromaSync(projectName)
  }
  return chromaSyncInstance
}

export async function closeChromaSync(): Promise<void> {
  if (chromaSyncInstance) {
    await chromaSyncInstance.close()
    chromaSyncInstance = null
  }
}
