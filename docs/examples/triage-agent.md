---
title: "Triage Agent: Multi-Agent Customer Support"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Triage Agent: Multi-Agent Customer Support

Create multi-agent systems that intelligently coordinate and delegate tasks among themselves based on user queries.

```bash
dexto --agent triage-agent
```

<ExpandableImage src="/assets/triage_agent_demo.gif" alt="Triage Agent Demo" title="Triage Agent: Multi-Agent Customer Support" width={900} />

## What it does

The Triage Agent demonstrates multi-agent collaboration:
- **Router Agent**: Analyzes incoming requests and routes them to specialists
- **Technical Support Agent**: Handles technical issues and troubleshooting
- **Billing Agent**: Manages billing inquiries and account questions
- **General Support Agent**: Handles general questions and information requests

## How it works

1. User submits a support request
2. Triage agent analyzes the request
3. Routes to the appropriate specialist agent
4. Specialist agent handles the specific task
5. Response is returned to the user

## Example Interactions

```bash
# Technical issue
"My API key isn't working"
→ Routes to Technical Support Agent

# Billing question
"How much does the premium plan cost?"
→ Routes to Billing Agent

# General inquiry
"What features do you offer?"
→ Routes to General Support Agent
```

## Key Features

- **Intelligent Routing**: Automatically determines the best agent for each request
- **Context Preservation**: Maintains conversation context across agent handoffs
- **Scalable**: Easy to add new specialist agents
- **Collaborative**: Agents can consult each other when needed

## Try it

```bash
# Install the agent
dexto install triage-agent

# Run it
dexto --agent triage-agent
```

Try different types of requests:
```
"I have a billing question"
"My API isn't responding"
"What are your business hours?"
```

Watch the multi-agent system communicate to get your responses.

## Learn More

- [Multi-Agent Systems Tutorial](/docs/tutorials/cli/examples/multi-agent-systems)
- [Building a Triage System](/docs/tutorials/cli/examples/building-triage-system)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
