---
description: Test skill that runs in isolated forked context
context: fork
---

# Test Fork Skill

You are running in an isolated forked context. This means:
- You have NO access to the previous conversation history
- You should complete the task independently based only on the context provided
- Return a concise summary of what you accomplished

## Your Task

If task context was provided above, complete that task.

Otherwise, simply respond with: "Fork skill executed successfully! I'm running in isolation without conversation history."
