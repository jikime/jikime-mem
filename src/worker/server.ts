/**
 * jikime-mem Express Server
 * API 서버 및 정적 파일 서빙
 */
import express, { Request, Response, NextFunction } from 'express'
import { join, dirname } from 'path'
import { sessions, prompts, responses } from './db'
import { getChromaSync, ChromaSearchResult } from './chroma'

const app = express()

// JSON 파싱
app.use(express.json({ limit: '10mb' }))

// CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// Viewer 정적 파일 서빙
const VIEWER_DIR = join(dirname(process.argv[1] || __filename), 'viewer')
app.use(express.static(VIEWER_DIR))

// Root path - serve viewer
app.get('/', (req: Request, res: Response) => {
  res.sendFile(join(VIEWER_DIR, 'index.html'))
})

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  })
})

// Sessions API
app.post('/api/sessions/start', (req: Request, res: Response) => {
  try {
    const { sessionId, projectPath, workingDirectory } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    const existing = sessions.findBySessionId(sessionId)
    if (existing) {
      return res.json({ session: existing, created: false })
    }

    const session = sessions.create(sessionId, projectPath || workingDirectory || process.cwd())
    res.json({ session, created: true })
  } catch (error) {
    console.error('Failed to start session:', error)
    res.status(500).json({ error: 'Failed to start session' })
  }
})

app.post('/api/sessions/stop', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    const session = sessions.stop(sessionId)
    res.json({ session })
  } catch (error) {
    console.error('Failed to stop session:', error)
    res.status(500).json({ error: 'Failed to stop session' })
  }
})

app.get('/api/sessions', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const sessionList = sessions.findAll(limit)
    const total = sessions.count()
    res.json({ sessions: sessionList, total })
  } catch (error) {
    console.error('Failed to fetch sessions:', error)
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// Prompts API
app.post('/api/prompts', (req: Request, res: Response) => {
  try {
    const { sessionId, content, metadata } = req.body

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' })
    }

    const prompt = prompts.create(
      sessionId,
      content,
      metadata ? JSON.stringify(metadata) : undefined
    )
    res.json({ prompt })
  } catch (error) {
    console.error('Failed to save prompt:', error)
    res.status(500).json({ error: 'Failed to save prompt' })
  }
})

app.get('/api/prompts', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string
    const limit = parseInt(req.query.limit as string) || 50

    const promptList = sessionId
      ? prompts.findBySession(sessionId, limit)
      : prompts.findAll(limit)

    const total = prompts.count()
    res.json({ prompts: promptList, total })
  } catch (error) {
    console.error('Failed to fetch prompts:', error)
    res.status(500).json({ error: 'Failed to fetch prompts' })
  }
})

// Responses API
app.post('/api/responses', (req: Request, res: Response) => {
  try {
    const { sessionId, content, metadata } = req.body

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' })
    }

    // 응답 내용 최대 50000자로 제한
    const truncatedContent = content.substring(0, 50000)

    const response = responses.create(
      sessionId,
      truncatedContent,
      metadata ? JSON.stringify(metadata) : undefined
    )
    res.json({ response })
  } catch (error) {
    console.error('Failed to save response:', error)
    res.status(500).json({ error: 'Failed to save response' })
  }
})

app.get('/api/responses', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string
    const limit = parseInt(req.query.limit as string) || 50

    const responseList = sessionId
      ? responses.findBySession(sessionId, limit)
      : responses.findAll(limit)

    const total = responses.count()
    res.json({ responses: responseList, total })
  } catch (error) {
    console.error('Failed to fetch responses:', error)
    res.status(500).json({ error: 'Failed to fetch responses' })
  }
})

// Search API - 하이브리드 검색 지원
// method: 'sqlite' | 'semantic' | 'hybrid' (default: 'hybrid')
app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10, type, method = 'hybrid' } = req.body

    if (!query) {
      return res.status(400).json({ error: 'query is required' })
    }

    let results: any[] = []
    let searchMethod = method

    // SQLite 검색 함수
    const sqliteSearch = () => {
      const sqliteResults: any[] = []

      if (!type || type === 'prompt') {
        const promptResults = prompts.search(query, limit).map((p: any) => ({
          type: 'prompt',
          data: {
            id: p.id,
            session_id: p.session_id,
            content: p.content,
            timestamp: p.timestamp
          },
          similarity: 0.5, // SQLite LIKE 검색은 기본 유사도 0.5
          source: 'sqlite'
        }))
        sqliteResults.push(...promptResults)
      }

      if (!type || type === 'response') {
        const responseResults = responses.search(query, limit).map((r: any) => ({
          type: 'response',
          data: {
            id: r.id,
            session_id: r.session_id,
            content: r.content,
            timestamp: r.timestamp
          },
          similarity: 0.5,
          source: 'sqlite'
        }))
        sqliteResults.push(...responseResults)
      }

      return sqliteResults
    }

    // 시맨틱 검색 함수
    // 유사도 임계값: 70% 이상만 반환 (관련성 높은 결과만)
    const SIMILARITY_THRESHOLD = 0.7

    const semanticSearch = async (): Promise<any[]> => {
      try {
        const chromaResults = await getChromaSync().search(query, limit * 2)

        return chromaResults
          .map((r: ChromaSearchResult) => {
            // Chroma 코사인 거리(0~2)를 유사도(0~1)로 변환
            // distance 0 = 동일, 1 = 무관, 2 = 반대
            const similarity = Math.max(0, 1 - (r.distance / 2))

            // doc_type에서 타입 추출
            const docType = r.metadata.doc_type as string || 'unknown'
            let resultType = 'unknown'

            if (docType.includes('prompt')) resultType = 'prompt'
            else if (docType.includes('response')) resultType = 'response'
            else if (docType.includes('summary')) resultType = 'summary'

            return {
              type: resultType,
              data: {
                id: r.metadata.sqlite_id,
                session_id: r.metadata.session_id,
                content: r.document,
                timestamp: r.metadata.created_at
              },
              similarity,
              source: 'chroma',
              chroma_id: r.id
            }
          })
          .filter(r => r.similarity >= SIMILARITY_THRESHOLD) // 임계값 이상만 반환
      } catch (error) {
        console.error('[Search] Semantic search failed:', error)
        return []
      }
    }

    // 검색 방법에 따른 처리
    if (method === 'sqlite') {
      results = sqliteSearch()
    } else if (method === 'semantic') {
      results = await semanticSearch()
    } else {
      // hybrid: 두 검색 결과를 병합
      const [sqliteResults, semanticResults] = await Promise.all([
        Promise.resolve(sqliteSearch()),
        semanticSearch()
      ])

      // 결과 병합 및 중복 제거
      const resultMap = new Map<string, any>()

      // 시맨틱 결과 먼저 추가 (더 높은 유사도)
      for (const r of semanticResults) {
        const key = `${r.type}_${r.data.id}`
        if (!resultMap.has(key) || resultMap.get(key).similarity < r.similarity) {
          resultMap.set(key, r)
        }
      }

      // SQLite 결과 추가 (중복이 아닌 경우)
      for (const r of sqliteResults) {
        const key = `${r.type}_${r.data.id}`
        if (!resultMap.has(key)) {
          resultMap.set(key, r)
        } else {
          // 이미 시맨틱 결과가 있으면 hybrid 표시
          const existing = resultMap.get(key)
          existing.source = 'hybrid'
        }
      }

      results = Array.from(resultMap.values())
      searchMethod = semanticResults.length > 0 ? 'hybrid' : 'sqlite'
    }

    // 유사도로 정렬 (높은 것부터)
    results.sort((a, b) => b.similarity - a.similarity)

    // type 필터링
    if (type) {
      results = results.filter(r => r.type === type)
    }

    // limit 적용
    results = results.slice(0, limit)

    res.json({
      results,
      total: results.length,
      query,
      method: searchMethod
    })
  } catch (error) {
    console.error('Search failed:', error)
    res.status(500).json({ error: 'Search failed' })
  }
})

// Stats API - 전체 통계
app.get('/api/stats', (req: Request, res: Response) => {
  try {
    const sessionCount = sessions.count()
    const promptCount = prompts.count()
    const responseCount = responses.count()

    res.json({
      sessions: sessionCount,
      prompts: promptCount,
      responses: responseCount,
      total: sessionCount + promptCount + responseCount
    })
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// Chroma Status API - Chroma 상태 확인
app.get('/api/chroma/status', async (req: Request, res: Response) => {
  try {
    const chroma = getChromaSync()

    // 간단한 검색으로 Chroma 연결 및 문서 수 확인
    const testResults = await chroma.search('test', 1)

    res.json({
      status: 'connected',
      collection: 'jm__jikime_mem',
      message: 'Chroma is available',
      sample_count: testResults.length
    })
  } catch (error) {
    console.error('Chroma status check failed:', error)
    res.json({
      status: 'disconnected',
      collection: 'jm__jikime_mem',
      message: error instanceof Error ? error.message : 'Unknown error',
      sample_count: 0
    })
  }
})

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

export { app }
