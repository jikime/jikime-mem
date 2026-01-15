/**
 * jikime-mem Express Server
 * API 서버 및 정적 파일 서빙
 */
import express, { Request, Response, NextFunction } from 'express'
import { join, dirname } from 'path'
import { sessions, prompts, observations, responses, contextSummaries } from './db'

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
    res.json({ sessions: sessionList })
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

    res.json({ prompts: promptList })
  } catch (error) {
    console.error('Failed to fetch prompts:', error)
    res.status(500).json({ error: 'Failed to fetch prompts' })
  }
})

// Observations API
app.post('/api/observations', (req: Request, res: Response) => {
  try {
    const { sessionId, toolName, toolInput, toolResponse, metadata } = req.body

    if (!sessionId || !toolName) {
      return res.status(400).json({ error: 'sessionId and toolName are required' })
    }

    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {})
    const responseStr = typeof toolResponse === 'string'
      ? toolResponse.substring(0, 10000)
      : JSON.stringify(toolResponse || '').substring(0, 10000)

    const observation = observations.create(
      sessionId,
      toolName,
      inputStr,
      responseStr,
      metadata ? JSON.stringify(metadata) : undefined
    )
    res.json({ observation })
  } catch (error) {
    console.error('Failed to save observation:', error)
    res.status(500).json({ error: 'Failed to save observation' })
  }
})

app.get('/api/observations', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string
    const toolName = req.query.toolName as string
    const limit = parseInt(req.query.limit as string) || 50

    let observationList
    if (sessionId) {
      observationList = observations.findBySession(sessionId, limit)
    } else if (toolName) {
      observationList = observations.findByTool(toolName, limit)
    } else {
      observationList = observations.findAll(limit)
    }

    res.json({ observations: observationList })
  } catch (error) {
    console.error('Failed to fetch observations:', error)
    res.status(500).json({ error: 'Failed to fetch observations' })
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

    res.json({ responses: responseList })
  } catch (error) {
    console.error('Failed to fetch responses:', error)
    res.status(500).json({ error: 'Failed to fetch responses' })
  }
})

// Search API
app.post('/api/search', (req: Request, res: Response) => {
  try {
    const { query, limit = 10, type } = req.body

    if (!query) {
      return res.status(400).json({ error: 'query is required' })
    }

    let results: any[] = []

    if (!type || type === 'prompt') {
      const promptResults = prompts.search(query, limit).map((p: any) => ({
        type: 'prompt',
        data: {
          id: p.id,
          content: p.content,
          timestamp: p.timestamp
        },
        similarity: 1
      }))
      results.push(...promptResults)
    }

    if (!type || type === 'observation') {
      const observationResults = observations.search(query, limit).map((o: any) => ({
        type: 'observation',
        data: {
          id: o.id,
          toolName: o.tool_name,
          timestamp: o.timestamp
        },
        similarity: 1
      }))
      results.push(...observationResults)
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
        similarity: 1
      }))
      results.push(...responseResults)
    }

    // 타임스탬프로 정렬
    results.sort((a, b) => {
      const dateA = new Date(a.data.timestamp).getTime()
      const dateB = new Date(b.data.timestamp).getTime()
      return dateB - dateA
    })

    // limit 적용
    results = results.slice(0, limit)

    res.json({
      results,
      total: results.length,
      query,
      method: 'sqlite'
    })
  } catch (error) {
    console.error('Search failed:', error)
    res.status(500).json({ error: 'Search failed' })
  }
})

// Context Summary API
app.post('/api/context', (req: Request, res: Response) => {
  try {
    const { sessionId, summary, tokens } = req.body

    if (!sessionId || !summary) {
      return res.status(400).json({ error: 'sessionId and summary are required' })
    }

    const contextSummary = contextSummaries.upsert(sessionId, summary, tokens)
    res.json({ contextSummary })
  } catch (error) {
    console.error('Failed to save context:', error)
    res.status(500).json({ error: 'Failed to save context' })
  }
})

app.get('/api/context/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const contextSummary = contextSummaries.findBySession(sessionId)

    if (!contextSummary) {
      return res.status(404).json({ error: 'Context not found' })
    }

    res.json({ contextSummary })
  } catch (error) {
    console.error('Failed to fetch context:', error)
    res.status(500).json({ error: 'Failed to fetch context' })
  }
})

// Get context for session start (previous session summaries)
app.get('/api/context', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string
    const limit = parseInt(req.query.limit as string) || 5

    // 현재 세션을 제외한 최근 요약들 가져오기
    const recentSummaries = contextSummaries.findAll(limit + 1)
      .filter((s: any) => s.session_id !== sessionId)
      .slice(0, limit) as any[]

    if (recentSummaries.length === 0) {
      return res.json({ context: null, message: 'No previous context available' })
    }

    // 컨텍스트 문자열 생성
    const contextLines: string[] = [
      '<jikime-mem-context>',
      '# 이전 세션 컨텍스트',
      ''
    ]

    for (const summary of recentSummaries) {
      contextLines.push(`## 세션: ${summary.session_id.substring(0, 8)}...`)
      contextLines.push(`- 생성일: ${summary.created_at}`)
      contextLines.push('')
      contextLines.push(summary.summary)
      contextLines.push('')
      contextLines.push('---')
      contextLines.push('')
    }

    contextLines.push('</jikime-mem-context>')

    res.json({
      context: contextLines.join('\n'),
      summaryCount: recentSummaries.length
    })
  } catch (error) {
    console.error('Failed to fetch context:', error)
    res.status(500).json({ error: 'Failed to fetch context' })
  }
})

// Summarize API - 세션 요약 생성
app.post('/api/sessions/summarize', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    // 자동 요약 생성
    const summary = contextSummaries.generateSummary(sessionId)

    // 요약 저장
    const tokens = Math.ceil(summary.length / 4) // 대략적인 토큰 수 추정
    const contextSummary = contextSummaries.upsert(sessionId, summary, tokens)

    res.json({ contextSummary, generated: true })
  } catch (error) {
    console.error('Failed to generate summary:', error)
    res.status(500).json({ error: 'Failed to generate summary' })
  }
})

// Get all summaries
app.get('/api/summaries', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const summaries = contextSummaries.findAll(limit)
    res.json({ summaries })
  } catch (error) {
    console.error('Failed to fetch summaries:', error)
    res.status(500).json({ error: 'Failed to fetch summaries' })
  }
})

// AI Processing APIs

// Update observation with compressed version
app.patch('/api/observations/:id/compress', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { compressed } = req.body

    if (!compressed) {
      return res.status(400).json({ error: 'compressed is required' })
    }

    observations.updateCompressed(id, compressed)
    res.json({ success: true, id })
  } catch (error) {
    console.error('Failed to update compressed observation:', error)
    res.status(500).json({ error: 'Failed to update compressed observation' })
  }
})

// Update session with AI summary
app.patch('/api/sessions/:sessionId/ai-summary', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const { aiSummary } = req.body

    if (!aiSummary) {
      return res.status(400).json({ error: 'aiSummary is required' })
    }

    contextSummaries.updateAiSummary(sessionId, aiSummary)
    res.json({ success: true, sessionId })
  } catch (error) {
    console.error('Failed to update AI summary:', error)
    res.status(500).json({ error: 'Failed to update AI summary' })
  }
})

// Get uncompressed observations (for batch processing)
app.get('/api/observations/uncompressed', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10
    const uncompressed = observations.findUncompressed(limit)
    res.json({ observations: uncompressed })
  } catch (error) {
    console.error('Failed to fetch uncompressed observations:', error)
    res.status(500).json({ error: 'Failed to fetch uncompressed observations' })
  }
})

// Get sessions without AI summary (for batch processing)
app.get('/api/sessions/without-ai-summary', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10
    const withoutSummary = contextSummaries.findWithoutAiSummary(limit)
    res.json({ summaries: withoutSummary })
  } catch (error) {
    console.error('Failed to fetch sessions without AI summary:', error)
    res.status(500).json({ error: 'Failed to fetch sessions without AI summary' })
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
