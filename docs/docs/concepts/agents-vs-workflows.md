---
sidebar_position: 2
---

# AI Agents vs. LLM Workflows

People often get confused between AI Agents and LLM workflows.

Understanding the distinction between **AI agents** and **LLM (Large Language Model) workflows** is key to choosing the right automation approach for your use-case.

## What is an AI Agent?

- An autonomous software entity that can perceive, reason, and act to achieve goals.
- Handles complex, multi-step tasks by making decisions and orchestrating tools/services.
- Can adapt to changing environments and user requests.

## What is an LLM Workflow?

- A predefined sequence of steps or prompts executed by a large language model (like GPT-4 or Claude).
- Typically linear and deterministic: each step follows the previous one.
- Great for repeatable, well-defined processes (e.g., data extraction, summarization, formatting).

## Key Differences

| Feature                | AI Agent                                 | LLM Workflow                         |
|------------------------|------------------------------------------|--------------------------------------|
| Autonomy               | High (makes decisions)                   | Low (follows set steps)              |
| Adaptability           | Can handle unexpected situations         | Rigid, limited to defined flow       |
| Use of Tools/Services  | Orchestrates multiple tools/services     | May call tools, but generally in fixed order   |
| User Interaction       | Can ask clarifying questions, replan     | Usually no dynamic interaction       |
| Example Use Case       | "Book a flight and notify me on Slack"  | "A button on a web page to summarize a document"           |

## When to Use Each

- **Use an AI Agent when:**
  - The problem is vague and complex - requires decision-making, adaptation, or chaining multiple services.
  - The process may change based on context, user input or something else.

- **Use an LLM Workflow when:**
  - The problem is small, and requires a repeatable, well-defined sequence.
  - You want predictable, consistent output.
  - The process does not require dynamic decision-making.


## In Dexto

Dexto CLI spins up a powerful AI Agent you can use for solving complex problems

Choosing the right tools for the job helps you get the most out of Dexto's automation capabilities. 