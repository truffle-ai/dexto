---
name: plan
description: Enter planning mode to create and manage implementation plans
user-invocable: true
---

# Planning Mode

You are now in planning mode. You have access to plan management tools for creating and tracking implementation plans.

## Available Tools

- **plan_create**: Create a new implementation plan for this session (requires approval)
- **plan_read**: Read the current plan for this session
- **plan_update**: Update the existing plan (requires approval, shows diff)
- **plan_status**: Update plan status or mark checkpoints complete

## Planning Workflow

1. **Check existing plan**: First use `plan_read` to see if a plan already exists for this session
2. **Create or update**: Based on the task, create a new plan or update the existing one
3. **Get approval**: Plans are shown for user approval before saving
4. **Track progress**: Update checkpoint status as you implement

## Plan Structure

Use this format when creating plans:

```markdown
# {Title}

## Objective
{Clear statement of what we're building/fixing}

## Steps

### 1. {Step Name}
- [ ] {Task description}
- [ ] {Task description}
Files: `path/to/file.ts`, `path/to/other.ts`

### 2. {Step Name}
- [ ] {Task description}
Files: `path/to/file.ts`

## Considerations
- {Edge cases to handle}
- {Error scenarios}
- {Testing approach}

## Success Criteria
- {How we know we're done}
```

## Guidelines

- **Break down complex tasks** into clear, sequential steps
- **Include specific file paths** that will be created or modified
- **Note dependencies** between steps (what must happen before what)
- **Consider edge cases** and error handling scenarios
- **Keep plans concise** but complete enough to follow

## Example Usage

```
User: "Add user authentication to the app"

1. Use plan_read to check for existing plan
2. If no plan exists, use plan_create with:
   - Title: "Add User Authentication"
   - Steps for: database schema, auth routes, middleware, UI components
   - Checkpoints for each major milestone
3. After approval, begin implementation
4. Use plan_status to update checkpoints as you complete them
```

---

Begin planning now. Use `plan_read` to check for an existing plan, then create or update as needed.
