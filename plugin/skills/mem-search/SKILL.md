# Memory Search Skill

This skill searches past session data stored in jikime-mem using hybrid search (SQLite + Chroma Vector DB).

## Activation Keywords

- "previously", "last time", "before"
- "remember", "memory", "history"
- "search", "find", "look for"
- "past work", "previous session"

## Search Method Selection

Analyze the user's query and select the appropriate search method:

### 1. `sqlite` (Keyword Search)
Use when query contains **exact identifiers**:
- camelCase or PascalCase names: `useState`, `handleClick`, `MyComponent`
- File names with extensions: `App.tsx`, `index.js`, `package.json`
- Error codes or messages: `TypeError`, `ENOENT`, `404`
- Exact function/variable names
- Technical terms that need exact matching

**Examples:**
- "이전에 useState 사용한 적 있어?" → `sqlite`
- "App.tsx 파일 수정한 적 있어?" → `sqlite`
- "TypeError 에러 해결한 적 있어?" → `sqlite`

### 2. `semantic` (Vector Search)
Use when query asks about **concepts or meaning**:
- Contains: "관련", "비슷한", "~에 대해", "방법", "어떻게"
- Conceptual questions about approaches or methods
- Looking for similar work without exact terms
- Natural language descriptions

**Examples:**
- "상태 관리에 대해 작업한 적 있어?" → `semantic`
- "API 호출하는 방법 찾아줘" → `semantic`
- "인증 관련 코드 있어?" → `semantic`
- "비슷한 기능 구현한 적 있어?" → `semantic`

### 3. `hybrid` (Default)
Use when:
- Query doesn't clearly fit above categories
- User wants comprehensive results
- Mixing exact terms with conceptual questions

**Examples:**
- "이전에 작업한 거 보여줘" → `hybrid`
- "chroma 관련 작업 찾아줘" → `hybrid`

## Usage

### Search API

```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "search term",
    "limit": 10,
    "method": "hybrid|sqlite|semantic"
  }'
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query |
| `limit` | number | No | 10 | Max results |
| `method` | string | No | hybrid | Search method |
| `type` | string | No | all | Filter: prompt, observation, response, summary |

### Response Format

```json
{
  "results": [
    {
      "type": "prompt",
      "data": {
        "id": "...",
        "session_id": "...",
        "content": "...",
        "timestamp": "..."
      },
      "similarity": 0.85,
      "source": "hybrid",
      "chroma_id": "prompt_xxx"
    }
  ],
  "total": 5,
  "query": "search term",
  "method": "hybrid"
}
```

### Similarity Score

| Source | Score Range | Meaning |
|--------|-------------|---------|
| sqlite | 0.5 (fixed) | Keyword match found |
| chroma | 0.0 - 1.0 | Vector similarity (higher = more similar) |
| hybrid | 0.0 - 1.0 | Combined from both sources |

## Context Injection

Format search results for Claude:

```markdown
## Related Past Work

**Search:** "{query}" (method: {method}, {total} results)

### Result 1 - {similarity}% match ({source})
**Type:** {type} | **Session:** {session_id} | **Date:** {timestamp}

{content}

---
```

## Decision Flow

```
1. Parse user query
2. Check for exact identifiers (camelCase, files, errors)
   → Yes: method = "sqlite"
   → No: Continue
3. Check for semantic keywords (관련, 비슷한, 방법, 어떻게)
   → Yes: method = "semantic"
   → No: method = "hybrid"
4. Call /api/search with selected method
5. Format and present results
```

## Notes

- Worker must be running at http://127.0.0.1:37888
- Chroma sync happens automatically on data save
- First semantic search may be slow (Chroma connection init)
- Results are sorted by similarity score (descending)
