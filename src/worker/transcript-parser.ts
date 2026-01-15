/**
 * Transcript Parser for jikime-mem
 * Claude Code transcript 파일에서 메시지 추출
 */
import { readFileSync, existsSync } from 'fs'

/**
 * transcript JSONL 파일에서 마지막 메시지 추출
 * @param transcriptPath transcript 파일 경로
 * @param role 'user' 또는 'assistant'
 * @param stripSystemReminders system-reminder 태그 제거 여부
 */
export function extractLastMessage(
  transcriptPath: string,
  role: 'user' | 'assistant',
  stripSystemReminders: boolean = false
): string {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    throw new Error(`Transcript 파일이 없거나 경로가 잘못되었습니다: ${transcriptPath}`)
  }

  const content = readFileSync(transcriptPath, 'utf-8').trim()
  if (!content) {
    throw new Error(`Transcript 파일이 비어있습니다: ${transcriptPath}`)
  }

  const lines = content.split('\n')
  let foundMatchingRole = false

  // 역순으로 검색하여 마지막 메시지 찾기
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = JSON.parse(lines[i])
      if (line.type === role) {
        foundMatchingRole = true

        if (line.message?.content) {
          let text = ''
          const msgContent = line.message.content

          if (typeof msgContent === 'string') {
            text = msgContent
          } else if (Array.isArray(msgContent)) {
            // content가 배열인 경우 text 타입만 추출
            text = msgContent
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n')
          } else {
            throw new Error(`알 수 없는 메시지 형식: ${typeof msgContent}`)
          }

          // system-reminder 태그 제거
          if (stripSystemReminders) {
            text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
            text = text.replace(/\n{3,}/g, '\n\n').trim()
          }

          return text
        }
      }
    } catch (parseError) {
      // JSON 파싱 실패시 다음 줄로 계속
      continue
    }
  }

  if (!foundMatchingRole) {
    throw new Error(`'${role}' 역할의 메시지를 찾을 수 없습니다: ${transcriptPath}`)
  }

  return ''
}

/**
 * transcript 경로에서 마지막 assistant 응답 추출 (편의 함수)
 */
export function extractLastAssistantMessage(transcriptPath: string): string {
  return extractLastMessage(transcriptPath, 'assistant', true)
}

/**
 * transcript 경로에서 마지막 user 메시지 추출 (편의 함수)
 */
export function extractLastUserMessage(transcriptPath: string): string {
  return extractLastMessage(transcriptPath, 'user', false)
}
