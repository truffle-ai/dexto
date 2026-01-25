---
name: plan
description: Enter planning mode to create and manage implementation plans
user-invocable: true
---

# Planning Mode - PLAN FIRST, THEN IMPLEMENT

**CRITICAL**: You are in planning mode. You MUST create and get approval for a plan BEFORE writing any code or making any changes.

## MANDATORY WORKFLOW

**DO NOT skip these steps. DO NOT start implementing until the plan is approved.**

1. **Research first** (if needed): Use the explore agent or read relevant files to understand the codebase
2. **Check for existing plan**: Use `plan_read` to see if a plan exists
3. **Create/update plan**: Use `plan_create` or `plan_update` to define your approach
4. **Request review**: Use `plan_review` to get user approval
5. **WAIT for approval**: Only proceed to implementation after user approves
6. **Implement**: Execute the approved plan, updating checkboxes as you go

## Research Phase

Before creating your plan, you should understand the codebase:

- **Use the explore agent** (spawn_agent with subagent_type="Explore") to search for relevant code, patterns, and existing implementations
- **Read key files** to understand the current architecture
- **Identify dependencies** and files that will need changes

This research informs your plan and prevents wasted effort from incorrect assumptions.

## Available Tools

- **plan_create**: Create a new plan (REQUIRED before any implementation)
- **plan_read**: Read the current plan
- **plan_update**: Update the existing plan (shows diff preview)
- **plan_review**: Request user review - returns approve/iterate/reject with feedback

## WHAT YOU MUST DO NOW

1. **Research**: Use the explore agent or read files to understand the relevant parts of the codebase
2. **Check plan**: Use `plan_read` to check if a plan already exists
3. **Create plan**: Use `plan_create` to create a comprehensive plan based on your research
4. **Get approval**: Use `plan_review` to request user approval
5. **STOP and WAIT** - do not write any code until the user approves via plan_review

## Plan Structure

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

## Success Criteria
- {How we know we're done}
```

## Guidelines

- **Break down complex tasks** into clear, sequential steps
- **Include specific file paths** that will be created or modified
- **Note dependencies** between steps
- **Keep plans concise** but complete

## Handling Review Responses

After calling `plan_review`, handle the response:

- **approve**: User approved - proceed with implementation
- **iterate**: User wants changes - update the plan based on feedback, then call `plan_review` again
- **reject**: User rejected - ask what they want instead

## DO NOT

- ❌ Start writing code before creating a plan
- ❌ Skip the plan_review step
- ❌ Assume approval - wait for explicit user response
- ❌ Make changes outside the approved plan without updating it first

---

**START NOW**:
1. Research the codebase using the explore agent if needed
2. Use `plan_read` to check for an existing plan
3. Use `plan_create` to create your plan
4. Use `plan_review` to get approval before any implementation
