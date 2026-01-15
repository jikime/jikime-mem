import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/sessions/stop - 세션 종료
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // 세션 업데이트
    const session = await prisma.session.update({
      where: { sessionId },
      data: {
        status: 'completed',
        endedAt: new Date()
      }
    })

    return NextResponse.json({ session })
  } catch (error) {
    console.error('Failed to stop session:', error)
    return NextResponse.json(
      { error: 'Failed to stop session' },
      { status: 500 }
    )
  }
}
