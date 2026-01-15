import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getChromaSync } from '@/services/chroma/ChromaSync'

// POST /api/observations - 관찰 저장
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, toolName, toolInput, toolResponse, metadata } = body

    if (!sessionId || !toolName) {
      return NextResponse.json(
        { error: 'sessionId and toolName are required' },
        { status: 400 }
      )
    }

    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)
    const responseStr = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse)

    // SQLite에 저장
    const observation = await prisma.observation.create({
      data: {
        sessionId,
        toolName,
        toolInput: inputStr,
        toolResponse: responseStr,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    })

    // ChromaSync로 벡터 임베딩 저장 (MCP 기반)
    try {
      const chromaSync = getChromaSync()
      await chromaSync.syncObservation(
        observation.id,
        sessionId,
        toolName,
        inputStr.substring(0, 1000),
        responseStr.substring(0, 2000),
        observation.timestamp
      )
    } catch (chromaError) {
      console.error('Chroma sync failed:', chromaError)
      // Chroma 실패해도 SQLite 저장은 성공으로 처리
    }

    return NextResponse.json({ observation })
  } catch (error) {
    console.error('Failed to save observation:', error)
    return NextResponse.json(
      { error: 'Failed to save observation' },
      { status: 500 }
    )
  }
}

// GET /api/observations - 관찰 조회
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const sessionId = searchParams.get('sessionId')
  const toolName = searchParams.get('toolName')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    const where: Record<string, string> = {}
    if (sessionId) where.sessionId = sessionId
    if (toolName) where.toolName = toolName

    const observations = await prisma.observation.findMany({
      where,
      take: limit,
      orderBy: { timestamp: 'desc' }
    })

    return NextResponse.json({ observations })
  } catch (error) {
    console.error('Failed to fetch observations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch observations' },
      { status: 500 }
    )
  }
}
