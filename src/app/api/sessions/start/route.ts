import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/sessions/start - 세션 시작
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, projectPath } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // 이미 존재하는 세션인지 확인
    const existing = await prisma.session.findUnique({
      where: { sessionId }
    })

    if (existing) {
      // 기존 세션 반환
      return NextResponse.json({ session: existing, created: false })
    }

    // 새 세션 생성
    const session = await prisma.session.create({
      data: {
        sessionId,
        projectPath: projectPath || process.cwd(),
        status: 'active'
      }
    })

    return NextResponse.json({ session, created: true })
  } catch (error) {
    console.error('Failed to start session:', error)
    return NextResponse.json(
      { error: 'Failed to start session' },
      { status: 500 }
    )
  }
}
