# jikime-mem

Claude Code 세션 메모리 시스템 - SQLite + Chroma 기반의 대화 기록 및 시맨틱 검색 플러그인

## 개요

jikime-mem은 Claude Code 세션에서 발생하는 대화와 도구 사용 기록을 저장하고, 나중에 시맨틱 검색으로 관련 컨텍스트를 찾을 수 있게 해주는 플러그인입니다.

### 주요 기능

- **세션 관리**: 세션 시작/종료 추적
- **프롬프트 저장**: 사용자 입력 저장 및 벡터 인덱싱
- **도구 관찰 저장**: 도구 사용 결과 저장 및 벡터 인덱싱
- **시맨틱 검색**: Chroma를 통한 유사도 기반 검색
- **웹 대시보드**: 통계 및 검색 UI

## 기술 스택

- **Frontend**: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui
- **Database**: SQLite (Prisma ORM)
- **Vector DB**: ChromaDB via MCP (Docker 불필요)
- **Runtime**: Node.js 18+

## 설치

```bash
# 의존성 설치
npm install

# 데이터베이스 초기화
npm run db:generate
npm run db:push

# 개발 서버 실행
npm run dev
```

## 사용법

### 서버 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 빌드 후 실행
npm run build
npm run start
```

서버는 기본적으로 `http://127.0.0.1:37888`에서 실행됩니다.

### CLI 사용

```bash
# 서버 시작 (백그라운드)
node scripts/cli.js start

# 서버 상태 확인
node scripts/cli.js status

# 서버 중지
node scripts/cli.js stop

# 서버 재시작
node scripts/cli.js restart

# 데이터베이스 초기화
node scripts/cli.js init-db
```

## API 엔드포인트

### 헬스체크
```
GET /api/health
```

### 세션 관리
```
GET  /api/sessions         # 세션 목록
POST /api/sessions/start   # 세션 시작
POST /api/sessions/stop    # 세션 종료
```

### 프롬프트
```
GET  /api/prompts          # 프롬프트 목록
POST /api/prompts          # 프롬프트 저장
```

### 도구 관찰
```
GET  /api/observations     # 관찰 목록
POST /api/observations     # 관찰 저장
```

### 검색
```
POST /api/search           # 시맨틱 검색
```

## Claude Code 플러그인 설정

### hooks.json 설정

Claude Code의 설정 파일에 다음 훅을 추가하세요:

```json
{
  "hooks": {
    "SessionStart": ["node /path/to/jikime-mem/plugin/scripts/session-start.js"],
    "UserPromptSubmit": ["node /path/to/jikime-mem/plugin/scripts/prompt-submit.js"],
    "PostToolUse": ["node /path/to/jikime-mem/plugin/scripts/post-tool-use.js"],
    "Stop": ["node /path/to/jikime-mem/plugin/scripts/session-stop.js"]
  }
}
```

## 프로젝트 구조

```
jikime-mem/
├── prisma/                 # Prisma 스키마 및 DB
│   └── schema.prisma
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── api/          # API 라우트
│   │   │   ├── health/
│   │   │   ├── sessions/
│   │   │   ├── prompts/
│   │   │   ├── observations/
│   │   │   └── search/
│   │   └── page.tsx      # 대시보드 UI
│   ├── components/       # UI 컴포넌트
│   │   └── ui/
│   ├── lib/              # 유틸리티
│   │   ├── prisma.ts
│   │   └── utils.ts
│   └── services/         # 비즈니스 로직
│       ├── chroma/
│       └── process/
├── plugin/                # Claude Code 플러그인
│   ├── .claude-plugin/   # 플러그인 메타데이터
│   ├── hooks/            # 훅 설정
│   ├── scripts/          # 훅 스크립트
│   ├── skills/           # 스킬 정의
│   └── agents/           # 에이전트 정의
├── scripts/              # CLI 스크립트
└── .claude-plugin/       # 마켓플레이스 메타데이터
```

## 환경 변수

`.env.example`을 `.env`로 복사하고 필요한 값을 설정하세요:

```env
PORT=37888
DATABASE_URL="file:./prisma/jikime-mem.db"
CHROMA_PATH="${HOME}/.jikime-mem/vector-db"
SEARCH_LIMIT=10
SEARCH_MIN_SCORE=0.5
```

## 라이선스

MIT License
# jikime-mem
