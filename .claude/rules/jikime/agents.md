# Agent Delegation Rules

Rules for when and how to delegate tasks to specialized agents.

## Command Type Rules

### Type A: Workflow Commands

Commands: `/jikime:0-project`, `/jikime:1-plan`, `/jikime:2-run`, `/jikime:3-sync`

- Agent delegation **recommended** for complex tasks requiring specialized expertise
- Direct tool usage **permitted** for simpler operations
- User interaction only through Alfred using `AskUserQuestion`

### Type B: Utility Commands

Commands: `/jikime:alfred`, `/jikime:fix`, `/jikime:loop`

- [HARD] **Agent delegation MANDATORY** for all implementation/fix tasks
- Direct tool access permitted **ONLY** for diagnostics (LSP, tests, linters)
- ALL code modifications **MUST** be delegated to specialized agents
- This rule applies even after auto compact or session recovery

**WHY**: Prevents quality degradation when session context is lost.

### Type C: Feedback Commands

Commands: `/jikime:9-feedback`

- No restrictions on tool usage
- Quality gates are optional

## Selection Decision Tree

```
1. Read-only codebase exploration?
   → Use the Explore subagent

2. External documentation or API research needed?
   → Use WebSearch, WebFetch, Context7 MCP tools

3. Domain expertise needed?
   → Use the expert-[domain] subagent

4. Workflow coordination needed?
   → Use the manager-[workflow] subagent

5. Complex multi-step tasks?
   → Use the manager-strategy subagent
```

## Context Optimization

When delegating to agents:

- Pass **minimal context** (spec_id, max 3 bullet points, architecture summary under 200 chars)
- **Exclude** background information, reasoning, and non-essential details
- Each agent gets independent 200K token session

## Execution Patterns

### Sequential Chaining

```
expert-debug → expert-refactoring → expert-testing
(identify)      (implement)          (validate)
```

### Parallel Execution

```
expert-backend ─┬─→ Results
expert-frontend ─┘   (simultaneous)
```

## Checklist

- [ ] Complex implementation delegated to appropriate agent
- [ ] Type B commands use agent delegation for code modifications
- [ ] Minimal context passed to agents
- [ ] Correct agent selected for task domain

---

Version: 1.0.0
Source: Extracted from CLAUDE.md Section 3, 4
