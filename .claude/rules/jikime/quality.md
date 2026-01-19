# Quality Gates

Quality validation rules and checklists for all operations.

## HARD Rules Checklist

These must be verified before completing any task:

- [ ] All implementation tasks delegated to agents when specialized expertise is needed
- [ ] User responses in `conversation_language`
- [ ] Independent operations executed in parallel
- [ ] XML tags never shown to users
- [ ] URLs verified before inclusion (WebSearch)
- [ ] Source attribution when WebSearch used

## SOFT Rules Checklist

These are recommended best practices:

- [ ] Appropriate agent selected for task
- [ ] Minimal context passed to agents
- [ ] Results integrated coherently
- [ ] Agent delegation for complex operations (Type B commands)

## Violation Detection

The following actions constitute violations:

| Violation | Description |
|-----------|-------------|
| **No Agent Consideration** | Alfred responds to complex implementation requests without considering agent delegation |
| **Skipped Validation** | Alfred skips quality validation for critical changes |
| **Language Mismatch** | Alfred ignores user's `conversation_language` preference |

## Enforcement

When specialized expertise is needed, Alfred **SHOULD** invoke corresponding agent for optimal results.

## DDD Quality Standards

When using Domain-Driven Development:

- [ ] Existing tests run before refactoring
- [ ] Characterization tests created for uncovered code
- [ ] Behavior preserved through ANALYZE-PRESERVE-IMPROVE cycle
- [ ] Changes are incremental and validated

## TRUST 5 Framework

Quality principles (when enabled in configuration):

| Principle | Description |
|-----------|-------------|
| **T**ested | All code has appropriate test coverage |
| **R**eadable | Code is self-documenting and clear |
| **U**nified | Consistent patterns across codebase |
| **S**ecured | Security best practices applied |
| **T**rackable | Changes are documented and traceable |

---

Version: 1.0.0
Source: Extracted from CLAUDE.md Section 6
