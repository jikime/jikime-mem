# jikime-mem 개발 문서

Claude Code 세션 메모리 시스템 개발 과정에서 논의된 주요 주제들을 정리한 문서입니다.

## 문서 목록

| 문서 | 주제 | 설명 |
|------|------|------|
| [01-session-summary.md](./01-session-summary.md) | 세션 요약 기능 | 통계 기반 세션 요약 구현 |
| [02-response-storage.md](./02-response-storage.md) | 응답 저장 기능 | Claude 응답 transcript 추출 및 저장 |
| [03-hook-system.md](./03-hook-system.md) | 훅 시스템 | claude-mem 스타일 훅 구조 적용 |
| [04-architecture-comparison.md](./04-architecture-comparison.md) | 아키텍처 비교 | claude-mem vs jikime-mem 비교 분석 |
| [05-headless-ai-processing.md](./05-headless-ai-processing.md) | Headless AI 처리 | SDK 없이 Claude Code headless 활용 방안 |

## 현재 구현 상태

### 완료된 기능
- [x] 세션 관리 (시작/종료)
- [x] 프롬프트 저장
- [x] 도구 사용 기록 (observations)
- [x] Claude 응답 저장 (transcript 추출)
- [x] 통계 기반 세션 요약
- [x] 웹 뷰어 UI
- [x] claude-mem 스타일 훅 구조

### 예정된 기능
- [ ] Claude Code headless AI 처리
- [ ] MCP Server 통합
- [ ] 스마트 컨텍스트 생성
- [ ] 설정 시스템 (settings.json)

## 데이터 흐름

```
Claude Code
    ↓ Hooks
┌─────────────────────────────────┐
│  context      → 컨텍스트 주입    │
│  user-message → 사용자 알림      │
│  session-init → 프롬프트 저장    │
│  observation  → 도구 사용 기록   │
│  summarize    → 요약 생성/종료   │
└─────────────────────────────────┘
    ↓
Worker Service (localhost:37888)
    ↓
SQLite Database (~/.jikime-mem/)
```

## 관련 프로젝트

- [claude-mem](https://github.com/thedotmack/claude-mem) - 참고한 원본 프로젝트
