# User Interaction Rules

Rules for user interaction and AskUserQuestion usage.

## Critical Constraint

> Subagents invoked via Task() operate in isolated, stateless contexts and cannot interact with users directly.

**Only Alfred can use AskUserQuestion** - subagents cannot.

## Correct Workflow Pattern

```
Step 1: Alfred uses AskUserQuestion to collect user preferences
        ↓
Step 2: Alfred invokes Task() with user choices in the prompt
        ↓
Step 3: Subagent executes based on provided parameters (no user interaction)
        ↓
Step 4: Subagent returns structured response with results
        ↓
Step 5: Alfred uses AskUserQuestion for next decision based on agent response
```

## AskUserQuestion Constraints

| Constraint | Rule |
|------------|------|
| **Options per question** | Maximum 4 |
| **Emoji usage** | NO emoji in question text, headers, or option labels |
| **Language** | Questions must be in user's `conversation_language` |

## Clarification Rules

- When user intent is unclear, use AskUserQuestion to clarify **before** proceeding
- Collect all necessary user preferences **before** delegating to agents
- Never assume user preferences without asking

## Prohibited Patterns

**DO NOT** (Subagent trying to ask user):
```python
# Inside subagent Task()
AskUserQuestion(...)  # WILL FAIL - subagents cannot interact with users
```

**DO** (Alfred handling user interaction):
```
Alfred: AskUserQuestion("Which approach do you prefer?", options=[...])
User: "Option A"
Alfred: Task("expert-backend", "Implement using approach A as user requested")
```

## Checklist

- [ ] Only Alfred uses AskUserQuestion
- [ ] Questions have max 4 options
- [ ] No emoji in questions
- [ ] Questions in user's conversation_language
- [ ] All preferences collected before delegation

---

Version: 1.0.0
Source: Extracted from CLAUDE.md Section 7
