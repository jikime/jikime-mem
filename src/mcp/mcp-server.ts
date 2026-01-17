/**
 * jikime-mem MCP Search Server
 *
 * MCP (Model Context Protocol) 서버로 Claude Desktop이나 다른 Claude 인스턴스에서
 * jikime-mem 메모리 검색 기능을 사용할 수 있게 해줍니다.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// Worker API 설정
const WORKER_PORT = 37888
const WORKER_HOST = '127.0.0.1'
const WORKER_BASE_URL = `http://${WORKER_HOST}:${WORKER_PORT}`

/**
 * Worker HTTP API 호출 (GET)
 */
async function callWorkerAPI(
  endpoint: string,
  params: Record<string, any>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value))
      }
    }

    const url = `${WORKER_BASE_URL}${endpoint}?${searchParams}`
    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Worker API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `Error calling Worker API: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}

/**
 * Worker HTTP API 호출 (POST)
 */
async function callWorkerAPIPost(
  endpoint: string,
  body: Record<string, any>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const url = `${WORKER_BASE_URL}${endpoint}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Worker API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `Error calling Worker API: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}

/**
 * Worker 연결 확인
 */
async function verifyWorkerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

/**
 * MCP Tool 정의
 */
const tools = [
  {
    name: 'search',
    description: '하이브리드 메모리 검색. SQLite 키워드 검색 + Chroma 시맨틱 검색을 결합합니다. Params: query (검색어), limit (결과 수), type (검색 대상), method (검색 방법)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '검색어'
        },
        limit: {
          type: 'number',
          description: '결과 수 (기본: 20)'
        },
        type: {
          type: 'string',
          enum: ['prompt', 'response'],
          description: '검색 대상 타입. 지정하지 않으면 모든 타입 검색'
        },
        method: {
          type: 'string',
          enum: ['sqlite', 'semantic', 'hybrid'],
          description: '검색 방법. sqlite: 키워드 검색, semantic: 시맨틱 검색, hybrid: 둘 다 (기본: hybrid)'
        }
      },
      required: ['query']
    },
    handler: async (args: any) => {
      return await callWorkerAPIPost('/api/search', args)
    }
  },
  {
    name: 'get_sessions',
    description: '세션 목록 조회. Params: limit (결과 수)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '결과 수 (기본: 50)'
        }
      }
    },
    handler: async (args: any) => {
      return await callWorkerAPI('/api/sessions', args)
    }
  },
  {
    name: 'get_prompts',
    description: '프롬프트 목록 조회. Params: limit (결과 수), session_id (세션 ID)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '결과 수 (기본: 50)'
        },
        session_id: {
          type: 'string',
          description: '특정 세션의 프롬프트만 조회'
        }
      }
    },
    handler: async (args: any) => {
      return await callWorkerAPI('/api/prompts', args)
    }
  },
  {
    name: 'get_responses',
    description: '응답 목록 조회. Params: limit (결과 수), session_id (세션 ID)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '결과 수 (기본: 50)'
        },
        session_id: {
          type: 'string',
          description: '특정 세션의 응답만 조회'
        }
      }
    },
    handler: async (args: any) => {
      return await callWorkerAPI('/api/responses', args)
    }
  },
  {
    name: 'get_stats',
    description: '전체 통계 조회 (세션 수, 프롬프트 수, 응답 수 등)',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      return await callWorkerAPI('/api/stats', {})
    }
  },
  {
    name: 'get_chroma_status',
    description: 'Chroma Vector DB 상태 확인. 연결 상태와 컬렉션 정보를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      return await callWorkerAPI('/api/chroma/status', {})
    }
  }
]

// MCP 서버 생성
const server = new Server(
  {
    name: 'jikime-mem-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// tools/list 핸들러 등록
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }
})

// tools/call 핸들러 등록
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find(t => t.name === request.params.name)

  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`)
  }

  try {
    return await tool.handler(request.params.arguments || {})
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
})

// 정리 함수
async function cleanup() {
  process.exit(0)
}

// Graceful shutdown
process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

// 서버 시작
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Worker 연결 확인 (백그라운드)
  setTimeout(async () => {
    const workerAvailable = await verifyWorkerConnection()
    if (!workerAvailable) {
      console.error('[jikime-mem] Worker not available at', WORKER_BASE_URL)
      console.error('[jikime-mem] Start Worker with: npm run worker:start')
    }
  }, 0)
}

main().catch((error) => {
  console.error('[jikime-mem] Fatal error:', error)
  process.exit(0)
})
