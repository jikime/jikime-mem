/**
 * jikime-mem Express Server
 * 프로젝트별 API 서버 및 정적 파일 서빙
 */
import express, { Request, Response, NextFunction } from 'express'
import { join, dirname } from 'path'
import { getDatabase, getAllProjects } from './db'
import { getChromaSyncForProject, ChromaSearchResult } from './chroma'
import { getAllProjects as getProjectList, type ProjectInfo } from './project-manager'

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
    version: '2.0.0',  // 프로젝트별 DB 지원 버전
    timestamp: new Date().toISOString()
  })
})

// ========== Projects API ==========

// 프로젝트 목록 조회
app.get('/api/projects', (req: Request, res: Response) => {
  try {
    const projects = getProjectList()
    res.json({
      projects,
      total: projects.length
    })
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    res.status(500).json({ error: 'Failed to fetch projects' })
  }
})

// 프로젝트 상세 정보 조회
app.get('/api/projects/:projectId', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params
    const projects = getProjectList()
    const project = projects.find(p => p.id === projectId)

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    // 프로젝트의 DB에서 통계 가져오기
    const db = getDatabase(project.path)
    const stats = {
      sessions: db.sessions.count(),
      prompts: db.prompts.count(),
      responses: db.responses.count()
    }

    res.json({
      project,
      stats
    })
  } catch (error) {
    console.error('Failed to fetch project:', error)
    res.status(500).json({ error: 'Failed to fetch project' })
  }
})

// ========== Sessions API ==========

app.post('/api/sessions/start', (req: Request, res: Response) => {
  try {
    const { sessionId, projectPath, workingDirectory } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    // 프로젝트 경로 결정 (projectPath > workingDirectory > process.cwd())
    const effectiveProjectPath = projectPath || workingDirectory || process.cwd()

    // 프로젝트별 DB 가져오기
    const db = getDatabase(effectiveProjectPath)

    const existing = db.sessions.findBySessionId(sessionId)
    if (existing) {
      return res.json({ session: existing, created: false, projectPath: effectiveProjectPath })
    }

    const session = db.sessions.create(sessionId, effectiveProjectPath)
    res.json({ session, created: true, projectPath: effectiveProjectPath })
  } catch (error) {
    console.error('Failed to start session:', error)
    res.status(500).json({ error: 'Failed to start session' })
  }
})

app.post('/api/sessions/stop', (req: Request, res: Response) => {
  try {
    const { sessionId, projectPath } = req.body

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' })
    }

    // 프로젝트 경로가 있으면 해당 DB 사용, 없으면 모든 프로젝트에서 찾기
    if (projectPath) {
      const db = getDatabase(projectPath)
      const session = db.sessions.stop(sessionId)
      return res.json({ session })
    }

    // 프로젝트 경로가 없으면 모든 프로젝트에서 세션 찾기
    const projects = getProjectList()
    for (const project of projects) {
      const db = getDatabase(project.path)
      const existing = db.sessions.findBySessionId(sessionId)
      if (existing) {
        const session = db.sessions.stop(sessionId)
        return res.json({ session })
      }
    }

    res.status(404).json({ error: 'Session not found' })
  } catch (error) {
    console.error('Failed to stop session:', error)
    res.status(500).json({ error: 'Failed to stop session' })
  }
})

app.get('/api/sessions', (req: Request, res: Response) => {
  try {
    const projectPath = req.query.projectPath as string
    const limit = parseInt(req.query.limit as string) || 50

    if (projectPath) {
      // 특정 프로젝트의 세션만 조회
      const db = getDatabase(projectPath)
      const sessionList = db.sessions.findAll(limit)
      const total = db.sessions.count()
      return res.json({ sessions: sessionList, total, projectPath })
    }

    // 모든 프로젝트의 세션 조회 (최근 순)
    const projects = getProjectList()
    const allSessions: any[] = []

    for (const project of projects) {
      const db = getDatabase(project.path)
      const sessions = db.sessions.findAll(limit) as any[]
      sessions.forEach(s => {
        s.projectId = project.id
        s.projectName = project.name
      })
      allSessions.push(...sessions)
    }

    // 최근 순 정렬 및 limit 적용
    allSessions.sort((a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )
    const limitedSessions = allSessions.slice(0, limit)

    res.json({ sessions: limitedSessions, total: allSessions.length })
  } catch (error) {
    console.error('Failed to fetch sessions:', error)
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// ========== Prompts API ==========

app.post('/api/prompts', (req: Request, res: Response) => {
  try {
    const { sessionId, content, metadata, projectPath } = req.body

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' })
    }

    // 프로젝트 경로가 있으면 해당 DB 사용
    if (projectPath) {
      const db = getDatabase(projectPath)
      const prompt = db.prompts.create(
        sessionId,
        content,
        metadata ? JSON.stringify(metadata) : undefined
      )
      return res.json({ prompt })
    }

    // 프로젝트 경로가 없으면 세션에서 프로젝트 찾기
    const projects = getProjectList()
    for (const project of projects) {
      const db = getDatabase(project.path)
      const session = db.sessions.findBySessionId(sessionId)
      if (session) {
        const prompt = db.prompts.create(
          sessionId,
          content,
          metadata ? JSON.stringify(metadata) : undefined
        )
        return res.json({ prompt })
      }
    }

    res.status(404).json({ error: 'Session not found' })
  } catch (error) {
    console.error('Failed to save prompt:', error)
    res.status(500).json({ error: 'Failed to save prompt' })
  }
})

app.get('/api/prompts', (req: Request, res: Response) => {
  try {
    const projectPath = req.query.projectPath as string
    const sessionId = req.query.sessionId as string
    const limit = parseInt(req.query.limit as string) || 50

    if (projectPath) {
      const db = getDatabase(projectPath)
      const promptList = sessionId
        ? db.prompts.findBySession(sessionId, limit)
        : db.prompts.findAll(limit)
      const total = db.prompts.count()
      return res.json({ prompts: promptList, total, projectPath })
    }

    // 모든 프로젝트에서 조회
    const projects = getProjectList()
    const allPrompts: any[] = []

    for (const project of projects) {
      const db = getDatabase(project.path)
      const prompts = (sessionId
        ? db.prompts.findBySession(sessionId, limit)
        : db.prompts.findAll(limit)) as any[]
      prompts.forEach(p => {
        p.projectId = project.id
        p.projectName = project.name
      })
      allPrompts.push(...prompts)
    }

    allPrompts.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    const limitedPrompts = allPrompts.slice(0, limit)

    res.json({ prompts: limitedPrompts, total: allPrompts.length })
  } catch (error) {
    console.error('Failed to fetch prompts:', error)
    res.status(500).json({ error: 'Failed to fetch prompts' })
  }
})

// ========== Responses API ==========

app.post('/api/responses', (req: Request, res: Response) => {
  try {
    const { sessionId, content, metadata, projectPath, promptId } = req.body

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' })
    }

    // 응답 내용 최대 50000자로 제한
    const truncatedContent = content.substring(0, 50000)

    // 프로젝트 경로가 있으면 해당 DB 사용
    if (projectPath) {
      const db = getDatabase(projectPath)
      // promptId가 없으면 해당 세션의 마지막 프롬프트를 자동 연결
      let effectivePromptId = promptId
      if (!effectivePromptId) {
        const lastPrompt = db.prompts.findLastBySession(sessionId) as { id: string } | undefined
        if (lastPrompt) {
          effectivePromptId = lastPrompt.id
        }
      }
      const response = db.responses.create(
        sessionId,
        truncatedContent,
        metadata ? JSON.stringify(metadata) : undefined,
        effectivePromptId
      )
      return res.json({ response })
    }

    // 프로젝트 경로가 없으면 세션에서 프로젝트 찾기
    const projects = getProjectList()
    for (const project of projects) {
      const db = getDatabase(project.path)
      const session = db.sessions.findBySessionId(sessionId)
      if (session) {
        // promptId가 없으면 해당 세션의 마지막 프롬프트를 자동 연결
        let effectivePromptId = promptId
        if (!effectivePromptId) {
          const lastPrompt = db.prompts.findLastBySession(sessionId) as { id: string } | undefined
          if (lastPrompt) {
            effectivePromptId = lastPrompt.id
          }
        }
        const response = db.responses.create(
          sessionId,
          truncatedContent,
          metadata ? JSON.stringify(metadata) : undefined,
          effectivePromptId
        )
        return res.json({ response })
      }
    }

    res.status(404).json({ error: 'Session not found' })
  } catch (error) {
    console.error('Failed to save response:', error)
    res.status(500).json({ error: 'Failed to save response' })
  }
})

app.get('/api/responses', (req: Request, res: Response) => {
  try {
    const projectPath = req.query.projectPath as string
    const sessionId = req.query.sessionId as string
    const limit = parseInt(req.query.limit as string) || 50

    if (projectPath) {
      const db = getDatabase(projectPath)
      const responseList = sessionId
        ? db.responses.findBySession(sessionId, limit)
        : db.responses.findAll(limit)
      const total = db.responses.count()
      return res.json({ responses: responseList, total, projectPath })
    }

    // 모든 프로젝트에서 조회
    const projects = getProjectList()
    const allResponses: any[] = []

    for (const project of projects) {
      const db = getDatabase(project.path)
      const responses = (sessionId
        ? db.responses.findBySession(sessionId, limit)
        : db.responses.findAll(limit)) as any[]
      responses.forEach(r => {
        r.projectId = project.id
        r.projectName = project.name
      })
      allResponses.push(...responses)
    }

    allResponses.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    const limitedResponses = allResponses.slice(0, limit)

    res.json({ responses: limitedResponses, total: allResponses.length })
  } catch (error) {
    console.error('Failed to fetch responses:', error)
    res.status(500).json({ error: 'Failed to fetch responses' })
  }
})

// ========== Search API ==========
// 하이브리드 검색 지원: method = 'sqlite' | 'semantic' | 'hybrid'

app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10, type, method = 'hybrid', projectPath } = req.body

    if (!query) {
      return res.status(400).json({ error: 'query is required' })
    }

    let results: any[] = []
    let searchMethod = method

    // 검색 대상 프로젝트 결정
    const targetProjects = projectPath
      ? [{ path: projectPath, id: '', name: '' }]
      : getProjectList()

    // 유사도 임계값: 70% 이상만 반환
    const SIMILARITY_THRESHOLD = 0.7

    // SQLite 검색 함수
    const sqliteSearch = (project: { path: string; id: string; name: string }) => {
      const db = getDatabase(project.path)
      const sqliteResults: any[] = []

      if (!type || type === 'prompt') {
        const promptResults = db.prompts.search(query, limit).map((p: any) => ({
          type: 'prompt',
          data: {
            id: p.id,
            session_id: p.session_id,
            content: p.content,
            timestamp: p.timestamp
          },
          projectId: project.id,
          projectName: project.name,
          similarity: 0.5, // SQLite LIKE 검색은 기본 유사도 0.5
          source: 'sqlite'
        }))
        sqliteResults.push(...promptResults)
      }

      if (!type || type === 'response') {
        const responseResults = db.responses.search(query, limit).map((r: any) => ({
          type: 'response',
          data: {
            id: r.id,
            session_id: r.session_id,
            content: r.content,
            timestamp: r.timestamp
          },
          projectId: project.id,
          projectName: project.name,
          similarity: 0.5,
          source: 'sqlite'
        }))
        sqliteResults.push(...responseResults)
      }

      return sqliteResults
    }

    // 시맨틱 검색 함수
    const semanticSearch = async (project: { path: string; id: string; name: string }): Promise<any[]> => {
      try {
        const chroma = getChromaSyncForProject(project.path)
        const chromaResults = await chroma.search(query, limit * 2)

        return chromaResults
          .map((r: ChromaSearchResult) => {
            // Chroma 코사인 거리(0~2)를 유사도(0~1)로 변환
            const similarity = Math.max(0, 1 - (r.distance / 2))

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
              projectId: project.id,
              projectName: project.name,
              similarity,
              source: 'chroma',
              chroma_id: r.id
            }
          })
          .filter(r => r.similarity >= SIMILARITY_THRESHOLD)
      } catch (error) {
        console.error('[Search] Semantic search failed:', error)
        return []
      }
    }

    // 검색 방법에 따른 처리
    for (const project of targetProjects) {
      if (method === 'sqlite') {
        results.push(...sqliteSearch(project))
      } else if (method === 'semantic') {
        const semanticResults = await semanticSearch(project)
        results.push(...semanticResults)
      } else {
        // hybrid: 두 검색 결과를 병합
        const [sqliteResults, semanticResults] = await Promise.all([
          Promise.resolve(sqliteSearch(project)),
          semanticSearch(project)
        ])

        // 결과 병합 및 중복 제거
        const resultMap = new Map<string, any>()

        // 시맨틱 결과 먼저 추가
        for (const r of semanticResults) {
          const key = `${r.type}_${r.data.id}_${project.id}`
          if (!resultMap.has(key) || resultMap.get(key).similarity < r.similarity) {
            resultMap.set(key, r)
          }
        }

        // SQLite 결과 추가
        for (const r of sqliteResults) {
          const key = `${r.type}_${r.data.id}_${project.id}`
          if (!resultMap.has(key)) {
            resultMap.set(key, r)
          } else {
            const existing = resultMap.get(key)
            existing.source = 'hybrid'
          }
        }

        results.push(...Array.from(resultMap.values()))
        if (semanticResults.length > 0) {
          searchMethod = 'hybrid'
        }
      }
    }

    // 유사도로 정렬
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
      method: searchMethod,
      projectPath: projectPath || null
    })
  } catch (error) {
    console.error('Search failed:', error)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ========== Stats API ==========

app.get('/api/stats', (req: Request, res: Response) => {
  try {
    const projectPath = req.query.projectPath as string

    if (projectPath) {
      // 특정 프로젝트 통계
      const db = getDatabase(projectPath)
      const sessionCount = db.sessions.count()
      const promptCount = db.prompts.count()
      const responseCount = db.responses.count()

      return res.json({
        sessions: sessionCount,
        prompts: promptCount,
        responses: responseCount,
        total: sessionCount + promptCount + responseCount,
        projectPath
      })
    }

    // 전체 통계 (모든 프로젝트 합산)
    const projects = getProjectList()
    let totalSessions = 0
    let totalPrompts = 0
    let totalResponses = 0

    for (const project of projects) {
      const db = getDatabase(project.path)
      totalSessions += db.sessions.count()
      totalPrompts += db.prompts.count()
      totalResponses += db.responses.count()
    }

    res.json({
      projects: projects.length,
      sessions: totalSessions,
      prompts: totalPrompts,
      responses: totalResponses,
      total: totalSessions + totalPrompts + totalResponses
    })
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ========== Chroma Status API ==========

app.get('/api/chroma/status', async (req: Request, res: Response) => {
  try {
    const projectPath = req.query.projectPath as string

    if (projectPath) {
      // 특정 프로젝트의 Chroma 상태
      const chroma = getChromaSyncForProject(projectPath)
      const testResults = await chroma.search('test', 1)

      return res.json({
        status: 'connected',
        projectId: chroma.getProjectId(),
        collection: `jm__${chroma.getProjectId()}`,
        message: 'Chroma is available',
        sample_count: testResults.length
      })
    }

    // 전체 프로젝트 Chroma 상태
    const projects = getProjectList()
    const chromaStatus: any[] = []

    for (const project of projects) {
      try {
        const chroma = getChromaSyncForProject(project.path)
        const testResults = await chroma.search('test', 1)
        chromaStatus.push({
          projectId: project.id,
          projectName: project.name,
          status: 'connected',
          sample_count: testResults.length
        })
      } catch {
        chromaStatus.push({
          projectId: project.id,
          projectName: project.name,
          status: 'disconnected'
        })
      }
    }

    res.json({
      status: 'ok',
      projects: chromaStatus
    })
  } catch (error) {
    console.error('Chroma status check failed:', error)
    res.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
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
