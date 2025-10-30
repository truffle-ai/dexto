# Built-In Specialist Agents

This directory contains built-in specialist agents designed for delegation via the `spawn_agent` tool. These agents provide focused capabilities for common sub-tasks that require isolation and specialized expertise.

## Available Built-In Agents

### 1. General Purpose (`general-purpose.yml`)

**Use Case**: Analysis, research, and information synthesis

**Capabilities**:
- Read and analyze files
- Search codebases and documentation
- Compare implementations
- Synthesize findings into summaries

**Tool Access**:
- `read_file` - Read file contents
- `glob_files` - Search for files by pattern
- `grep_content` - Search within files
- `search_history` - Access conversation history

**Model**: Claude Haiku 4.5 (efficient for analysis)

**When to Use**:
```typescript
// Research a specific topic
spawn_agent({
  agent: 'general-purpose',
  prompt: 'Analyze the authentication implementation in src/auth/',
  description: 'Auth analysis'
})

// Compare implementations
spawn_agent({
  agent: 'general-purpose',
  prompt: 'Compare the error handling patterns in services/ vs controllers/',
  description: 'Error handling comparison'
})
```

---

### 2. Code Reviewer (`code-reviewer.yml`)

**Use Case**: Thorough code review and security analysis

**Capabilities**:
- Identify bugs and security vulnerabilities
- Assess code quality and maintainability
- Check performance and best practices
- Evaluate test coverage
- Provide actionable recommendations

**Review Focus**:
- Security (injection, XSS, auth issues)
- Correctness (logic errors, edge cases)
- Performance (complexity, optimization)
- Maintainability (readability, SOLID)
- Testing (coverage, quality)

**Tool Access**:
- `read_file` - Read source files
- `glob_files` - Find related files
- `grep_content` - Search for patterns
- `search_history` - Check previous discussions

**Model**: Claude Sonnet 4 (powerful for thorough review)

**When to Use**:
```typescript
// Review specific changes
spawn_agent({
  agent: 'code-reviewer',
  prompt: 'Review the changes in packages/api/src/routes/auth.ts',
  description: 'Auth endpoint review'
})

// Security audit
spawn_agent({
  agent: 'code-reviewer',
  prompt: 'Security audit of all authentication and authorization code',
  description: 'Security audit'
})
```

---

### 3. Test Runner (`test-runner.yml`)

**Use Case**: Execute tests and analyze failures

**Capabilities**:
- Run test commands (npm test, pytest, etc.)
- Monitor test execution
- Parse test output and failures
- Analyze error messages and stack traces
- Suggest fixes for failing tests
- Kill hanging test processes

**Tool Access**:
- `read_file` - Read test files
- `glob_files` - Find test files
- `grep_content` - Search patterns
- `bash_exec` - Execute test commands
- `bash_output` - Monitor progress
- `kill_process` - Kill hanging tests

**Model**: Claude Haiku 4.5 (efficient with flexibility)

**When to Use**:
```typescript
// Run test suite
spawn_agent({
  agent: 'test-runner',
  prompt: 'Run the unit tests and analyze any failures',
  description: 'Unit test run'
})

// Debug failing tests
spawn_agent({
  agent: 'test-runner',
  prompt: 'Run integration tests and debug the authentication test failures',
  description: 'Auth test debug'
})
```

---

## Using Built-In Agents

### Basic Usage

```typescript
// In your agent code or via spawn_agent tool
const result = await spawn_agent({
  agent: 'general-purpose',    // Built-in agent name
  prompt: 'Your task description here',
  description: 'Short task label'
});
```

### From Agent Config

```yaml
# In your agent's systemPrompt
systemPrompt:
  contributors:
    - id: primary
      content: |
        When you need to delegate analysis work, use:

        spawn_agent({
          agent: 'general-purpose',
          prompt: 'Detailed task description',
          description: 'Brief label'
        })

# Enable spawn_agent tool
internalTools:
  - spawn_agent
```

### From API

```bash
# Via REST API
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "spawn_agent({ agent: \"code-reviewer\", prompt: \"Review auth.ts\", description: \"Auth review\" })"
  }'
```

---

## Design Principles

### 1. **Focused Specialization**
Each built-in agent is designed for a specific category of tasks with appropriate tool access.

### 2. **Read-Only by Default**
Most agents have read-only access (except test-runner which needs execution). This prevents accidental modifications.

### 3. **No Recursion**
Built-in agents cannot spawn additional sub-agents, preventing infinite recursion.

### 4. **Autonomous Execution**
All built-in agents use `auto-approve` mode, working autonomously without user prompts.

### 5. **Efficient Models**
Agents use appropriate LLMs for their tasks:
- **Haiku**: Fast, efficient for analysis and testing
- **Sonnet**: Powerful for thorough code review

---

## Creating Custom Specialist Agents

While built-in agents cover common cases, you can create custom specialists:

### Example: Security Auditor

```yaml
# agents/security-auditor.yml
systemPrompt:
  contributors:
    - id: primary
      type: static
      content: |
        You are a Security Auditor specialized in finding vulnerabilities...

internalTools:
  - read_file
  - glob_files
  - grep_content

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  temperature: 0.1
```

Usage:
```typescript
spawn_agent({
  agent: './agents/security-auditor.yml',
  prompt: 'Audit the payment processing code',
  description: 'Payment security audit'
})
```

---

## Comparison: Built-In vs Custom vs External

| Aspect | Built-In Agents | Custom Agents | External Agents (HTTP MCP) |
|--------|----------------|---------------|----------------------------|
| **Definition** | Pre-configured YML | User YML files | Separate processes |
| **Lifecycle** | Parent session | Parent session | Independent |
| **Execution** | Synchronous | Synchronous | Can be async |
| **Resource Sharing** | Shared process | Shared process | Network boundary |
| **Use Case** | Common delegation | Specialized tasks | Long-running services |
| **Cleanup** | Automatic | Automatic | Manual management |

---

## Tool Access Matrix

| Agent | read_file | glob_files | grep_content | bash_exec | write_file | spawn_agent |
|-------|-----------|------------|--------------|-----------|------------|-------------|
| **general-purpose** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **code-reviewer** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **test-runner** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

All agents have access to `search_history` for context.

---

## Security Considerations

### 1. **No Nested Spawning**
Built-in agents cannot spawn additional sub-agents, preventing:
- Infinite recursion
- Uncontrolled resource consumption
- Complex debugging scenarios

### 2. **Tool Scoping Enforcement**
Each agent's tool access is strictly limited by its `internalTools` configuration.

### 3. **Command Execution Safety**
Test-runner includes explicit denylists for dangerous operations:
```yaml
toolPolicies:
  alwaysDeny:
    - internal--bash_exec--rm -rf*
    - internal--bash_exec--sudo*
```

### 4. **Session Isolation**
Sub-agent sessions are isolated from parent:
- Separate tool execution context
- Independent system prompts
- Guaranteed cleanup on completion/error

---

## Performance Characteristics

### Resource Usage
- **Memory**: ~50-100MB per spawned agent (temporary)
- **CPU**: Depends on task complexity
- **Duration**: Most tasks complete in 5-30 seconds

### Config Loading
- Built-in agents are cached after first load
- Subsequent spawns use cached configs
- No file I/O after initial load

### Cleanup
- Automatic session cleanup via `finally` block
- No orphaned sessions even on errors
- Parent session unaffected by child failures

---

## Troubleshooting

### Agent Not Found
```
Error: Built-in agent 'code-reviwer' not found
```
**Solution**: Check spelling. Available built-ins: `general-purpose`, `code-reviewer`, `test-runner`

### Tool Not Allowed
```
Error: Tool 'write_file' not allowed for agent 'general-purpose'
```
**Solution**: Built-in agents have restricted tool access. Use custom agent if you need write operations.

### Spawn Depth Exceeded
```
Error: Maximum sub-agent depth (1) exceeded
```
**Solution**: Built-in agents cannot spawn additional sub-agents. Restructure your delegation.

### Test Timeout
```
Error: Test execution timed out after 120s
```
**Solution**: Tests are taking too long. Consider running subset of tests or increasing timeout.

---

## Best Practices

### 1. **Choose the Right Agent**
- **Analysis**: Use `general-purpose`
- **Code review**: Use `code-reviewer`
- **Test execution**: Use `test-runner`

### 2. **Provide Clear Prompts**
```typescript
// Good: Specific and actionable
spawn_agent({
  agent: 'code-reviewer',
  prompt: 'Review packages/api/auth.ts for security vulnerabilities, focusing on JWT validation and session management',
  description: 'JWT security review'
})

// Bad: Vague and unclear
spawn_agent({
  agent: 'code-reviewer',
  prompt: 'Check this',
  description: 'Review'
})
```

### 3. **Scope Tasks Appropriately**
Don't overload sub-agents with massive tasks. Break down large work:
```typescript
// Instead of: "Review entire codebase"
// Do this:
const modules = ['auth', 'api', 'database'];
for (const module of modules) {
  await spawn_agent({
    agent: 'code-reviewer',
    prompt: `Review the ${module} module`,
    description: `${module} review`
  });
}
```

### 4. **Handle Errors Gracefully**
```typescript
try {
  const result = await spawn_agent({
    agent: 'test-runner',
    prompt: 'Run tests',
    description: 'Test execution'
  });
  // Process result...
} catch (error) {
  // Sub-agent failures return errors, not throw exceptions
  console.error('Tests failed:', error);
}
```

---

## Roadmap

### Future Built-In Agents

- **documentation-writer**: Generate docs from code
- **refactoring-assistant**: Suggest code improvements
- **dependency-auditor**: Check for outdated/vulnerable deps
- **performance-profiler**: Analyze performance bottlenecks
- **api-tester**: Test API endpoints
- **sql-analyst**: Optimize database queries

### Planned Features

- Agent discovery API (`GET /api/agents/built-in`)
- Agent capability matching (auto-select best agent)
- Parallel agent execution
- Agent result aggregation
- Performance metrics and monitoring

---

## Contributing

### Adding New Built-In Agents

1. Create agent config in `agents/built-in/[name].yml`
2. Follow existing structure and principles
3. Document capabilities in this README
4. Add validation tests
5. Update examples in documentation

### Testing Built-In Agents

```bash
# Validate all built-in configs
npm run test:agents:built-in

# Test specific agent
npm test -- agents/built-in/general-purpose.test.ts
```

---

## Additional Resources

- [Multi-Agent Systems Tutorial](../../docs/docs/tutorials/multi-agent-systems.md)
- [spawn_agent Migration Guide](../../docs/guides/migration/spawn-agent.md)
- [Agent Configuration Reference](../../docs/docs/configuration/agent-config.md)
- [Internal Tools Documentation](../../docs/docs/tools/internal-tools.md)

---

**Last Updated**: 2025-10-30
**Version**: 1.0.0
**Status**: Active Development
