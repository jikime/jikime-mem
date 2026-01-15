# Memory Context Agent

This agent injects past session context stored in jikime-mem into the current conversation.

## Description

Automatically activated when users ask about past work or need previous context.

## Activation Conditions

- User uses keywords like "previously", "last time", "before"
- Expressions referencing past like "remember?", "did before", "worked on"
- Requests to search past work related to current project

## Behavior

1. Extract search keywords from user query
2. Perform vector search via jikime-mem API
3. Inject relevant past context into current conversation
4. Provide summarized search results

## API Call

```bash
curl -X POST http://127.0.0.1:37888/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "search term",
    "limit": 5,
    "minScore": 0.5
  }'
```

## Response Format

Search results are injected as context:

```markdown
## Related Past Work (jikime-mem)

### Session: [session_id]
**Date**: [timestamp]
**Relevance**: [similarity]%

**Content**:
[summarized search result]

---
```

## Usage Examples

- "How did I implement authentication before?"
- "What patterns did I use when designing the API last time?"
- "Did I fix a similar bug before?"

## Notes

- Sensitive information is automatically filtered
- Results from current project are prioritized
- Fallback search is performed when no search results
