# Memory Search Skill

This skill searches past session data stored in jikime-mem.

## Activation Keywords

- "previously", "last time", "before"
- "remember", "memory", "history"
- "search", "find", "look for"
- "past work", "previous session"

## Usage

This skill is activated when users ask about past work.

### Search API

```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "search term", "limit": 10}'
```

### Response Format

```json
{
  "results": [
    {
      "id": "...",
      "type": "prompt|observation",
      "content": "...",
      "timestamp": "...",
      "sessionId": "...",
      "similarity": 0.95
    }
  ]
}
```

## Context Injection

Search results are injected into Claude in this format:

```
## Related Past Work

### Session [session_id] - [date]
- [summary content]

### Related Tool Usage
- [tool_name]: [summary]
```

## Notes

- Vector search is performed via Chroma
- Results are sorted by similarity
- Sensitive information is automatically filtered
