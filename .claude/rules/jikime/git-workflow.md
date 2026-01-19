# Git Workflow Rules

Git conventions and workflow guidelines for consistent version control.

## Commit Message Format

```
<type>: <description>

<optional body>
```

### Commit Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code refactoring (no behavior change) |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvements |
| `ci` | CI/CD changes |

### Examples

```bash
# Good
feat: add user authentication with JWT
fix: resolve memory leak in WebSocket handler
refactor: extract validation logic to separate module
docs: update API documentation for v2 endpoints

# Bad
update code
fixed bug
WIP
asdf
```

## Pull Request Workflow

When creating PRs:

1. **Analyze full commit history** (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

### PR Description Template

```markdown
## Summary
- Brief description of changes
- Key features or fixes

## Test Plan
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Related Issues
- Closes #123
```

## Feature Implementation Workflow

### 1. Plan First

Use **manager-spec** or **manager-strategy** subagent:
- Create implementation plan
- Identify dependencies and risks
- Break down into phases

### 2. DDD Approach (JikiME Standard)

Use **manager-ddd** subagent:
- **ANALYZE**: Understand existing behavior
- **PRESERVE**: Write characterization tests
- **IMPROVE**: Implement with test validation

### 3. Code Review

Use **manager-quality** subagent:
- Address CRITICAL and HIGH issues immediately
- Fix MEDIUM issues when possible
- Document LOW issues for future

### 4. Commit & Push

- Detailed commit messages
- Follow conventional commits format
- Reference related issues

## Branch Naming

```
<type>/<description>
```

| Type | Usage |
|------|-------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `refactor/` | Code refactoring |
| `docs/` | Documentation |
| `chore/` | Maintenance |

### Examples

```
feature/user-authentication
fix/memory-leak-websocket
refactor/validation-module
docs/api-v2-endpoints
```

## Git Checklist

Before pushing:

- [ ] Commit messages follow conventional format
- [ ] Branch name is descriptive
- [ ] No sensitive data in commits (secrets, API keys)
- [ ] Tests pass locally
- [ ] Code is properly formatted

Before merging PR:

- [ ] All CI checks pass
- [ ] Code review completed
- [ ] Conflicts resolved
- [ ] Documentation updated if needed

## Prohibited Practices

| Practice | Reason |
|----------|--------|
| Force push to main/master | Destroys history |
| Committing secrets | Security risk |
| Large monolithic commits | Hard to review/revert |
| Merge commits in feature branches | Clutters history |
| Committing build artifacts | Bloats repository |

---

Version: 1.0.0
Source: Adapted from everything-claude-code/rules/git-workflow.md (TDD → DDD)
