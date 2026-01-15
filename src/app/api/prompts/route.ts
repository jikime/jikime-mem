import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getChromaSync } from '@/services/chroma/ChromaSync'

// POST /api/prompts - 프롬프트 저장
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, content, metadata } = body

    if (!sessionId || !content) {
      return NextResponse.json(
        { error: 'sessionId and content are required' },
        { status: 400 }
      )
    }

    // SQLite에 저장
    const prompt = await prisma.prompt.create({
      data: {
        sessionId,
        content,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    })

    // ChromaSync로 벡터 임베딩 저장 (MCP 기반)
    try {
      const chromaSync = getChromaSync()
      await chromaSync.syncPrompt(
        prompt.id,
        sessionId,
        content,
        prompt.timestamp
      )
    } catch (chromaError) {
      console.error('Chroma sync failed:', chromaError)
      // Chroma 실패해도 SQLite 저장은 성공으로 처리
    }

    return NextResponse.json({ prompt })
  } catch (error) {
    console.error('Failed to save prompt:', error)
    return NextResponse.json(
      { error: 'Failed to save prompt' },
      { status: 500 }
    )
  }
}

// GET /api/prompts - 프롬프트 조회
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const sessionId = searchParams.get('sessionId')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    const where = sessionId ? { sessionId } : {}

    const prompts = await prisma.prompt.findMany({
      where,
      take: limit,
      orderBy: { timestamp: 'desc' }
    })

    return NextResponse.json({ prompts })
  } catch (error) {
    console.error('Failed to fetch prompts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch prompts' },
      { status: 500 }
    )
  }
}
