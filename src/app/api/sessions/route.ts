import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/sessions - 세션 목록 조회
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '20')
  const status = searchParams.get('status')

  try {
    const where = status ? { status } : {}

    const sessions = await prisma.session.findMany({
      where,
      take: limit,
      orderBy: { startedAt: 'desc' },
      include: {
        _count: {
          select: {
            prompts: true,
            observations: true
          }
        }
      }
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Failed to fetch sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}
