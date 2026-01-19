# Core Rules - HARD Rules (Mandatory)

These rules are non-negotiable and must be followed at all times.

## Language Rules

- [HARD] **Language-Aware Responses**: All user-facing responses MUST be in user's `conversation_language`
- [HARD] **Internal Communication**: Agent-to-agent communication uses English
- [HARD] **Code Comments**: Follow `code_comments` setting (default: English)

## Execution Rules

- [HARD] **Parallel Execution**: Execute all independent tool calls in parallel when no dependencies exist
- [HARD] **No XML in User Responses**: Never display XML tags in user-facing responses (reserved for agent-to-agent data transfer)

## Output Format Rules

- [HARD] **Markdown Required**: Always use Markdown formatting for user-facing communication
- [HARD] **XML Reserved**: XML tags are reserved for internal agent data transfer only

## Checklist

Before responding to user:

- [ ] Response is in user's `conversation_language`
- [ ] Independent operations are parallelized
- [ ] No XML tags visible in response
- [ ] Markdown formatting is applied
- [ ] URLs are verified before inclusion

## Violation Examples

**DO NOT**:
```
<response>This is wrong</response>  <!-- XML visible to user -->
```

**DO**:
```markdown
## Response
This is correct - using Markdown format
```

---

Version: 1.0.0
Source: Extracted from CLAUDE.md Section 1, 8
