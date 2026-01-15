import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getChromaSync } from '@/services/chroma/ChromaSync'

// POST /api/search - 시맨틱 검색
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, limit = 10, type, sessionId } = body

    if (!query) {
      return NextResponse.json(
        { error: 'query is required' },
        { status: 400 }
      )
    }

    // ChromaSync 벡터 검색 시도 (MCP 기반)
    try {
      const chromaSync = getChromaSync()
      const chromaResults = await chromaSync.search(
        query,
        limit,
        type as 'prompt' | 'observation' | undefined
      )

      // 검색 결과에서 원본 데이터 조회
      const enrichedResults = await Promise.all(
        chromaResults.map(async (result) => {
          if (result.type === 'prompt') {
            const prompt = await prisma.prompt.findUnique({
              where: { id: result.id }
            })
            return {
              type: 'prompt',
              data: prompt ? {
                id: prompt.id,
                content: prompt.content,
                timestamp: prompt.timestamp
              } : null,
              similarity: result.similarity
            }
          } else {
            const observation = await prisma.observation.findUnique({
              where: { id: result.id }
            })
            return {
              type: 'observation',
              data: observation ? {
                id: observation.id,
                toolName: observation.toolName,
                timestamp: observation.timestamp
              } : null,
              similarity: result.similarity
            }
          }
        })
      )

      return NextResponse.json({
        results: enrichedResults.filter(r => r.data !== null),
        total: enrichedResults.length,
        query,
        method: 'vector'
      })
    } catch (chromaError) {
      console.error('Chroma search failed, falling back to SQLite:', chromaError)

      // Fallback: SQLite LIKE 검색
      const prompts = await prisma.prompt.findMany({
        where: {
          content: { contains: query },
          ...(sessionId && { sessionId })
        },
        take: limit,
        orderBy: { timestamp: 'desc' }
      })

      const observations = await prisma.observation.findMany({
        where: {
          OR: [
            { toolName: { contains: query } },
            { toolInput: { contains: query } },
            { toolResponse: { contains: query } }
          ],
          ...(sessionId && { sessionId })
        },
        take: limit,
        orderBy: { timestamp: 'desc' }
      })

      const results = [
        ...prompts.map(p => ({
          type: 'prompt' as const,
          data: {
            id: p.id,
            content: p.content,
            timestamp: p.timestamp
          },
          similarity: 1
        })),
        ...observations.map(o => ({
          type: 'observation' as const,
          data: {
            id: o.id,
            toolName: o.toolName,
            timestamp: o.timestamp
          },
          similarity: 1
        }))
      ].sort((a, b) => {
        const dateA = new Date(a.data.timestamp).getTime()
        const dateB = new Date(b.data.timestamp).getTime()
        return dateB - dateA
      }).slice(0, limit)

      return NextResponse.json({
        results,
        total: results.length,
        query,
        method: 'fallback'
      })
    }
  } catch (error) {
    console.error('Search failed:', error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
}
