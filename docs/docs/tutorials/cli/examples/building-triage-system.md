---
sidebar_position: 1
---

# Customer Support Triage System

Learn how to build an intelligent customer support triage system using multiple specialized agents that work together through MCP connections.

## Overview

We'll build a system where:
1. **Triage Agent** receives customer requests and routes them
2. **Specialist Agents** handle specific domains (technical, billing, etc.)
3. **MCP Tools** enable seamless agent-to-agent communication
4. **Auto-approval** provides smooth customer experience

```
Customer Request → Triage Agent → Specialist Agent → Complete Response
```

## Step 1: Create Specialist Agents

### Technical Support Agent

```yaml
# technical-support-agent.yml
systemPrompt: |
  You are a Technical Support Specialist with expertise in:
  - API troubleshooting and integration issues
  - Application bugs and system diagnostics
  - Performance optimization and monitoring
  
  Provide detailed, step-by-step solutions with clear explanations.

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
```

### Billing Support Agent

```yaml
# billing-agent.yml
systemPrompt: |
  You are a Billing Support Specialist handling:
  - Payment processing and subscription management
  - Plan upgrades, downgrades, and pricing questions
  - Refunds and billing disputes
  
  Always provide specific timelines and next steps.

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

## Step 2: Create the Triage Agent

The triage agent coordinates everything and connects to specialists:

```yaml
# triage-agent.yml
systemPrompt: |
  You are a Customer Support Triage Agent. Your process:
  
  1. Analyze the customer request
  2. Identify the best specialist (technical, billing, etc.)
  3. Call the chat_with_agent tool with the customer message
  4. Provide a complete response combining your routing decision with the specialist's answer
  
  After routing, you MUST:
  - Use chat_with_agent tool to get the specialist's response
  - Include the specialist's complete answer in your response
  
  Response format: "I've connected you with [specialist]. [Complete specialist answer]"

# Auto-approve tools for seamless delegation
permissions:
  mode: auto-approve
  allowedToolsStorage: memory

mcpServers:
  # Connect to specialist agents as MCP servers
  technical_support:
    type: stdio
    command: npx
    args: [dexto, --mode, mcp, --agent, technical-support-agent.yml]
    connectionMode: lenient
  
  billing_support:
    type: stdio
    command: npx
    args: [dexto, --mode, mcp, --agent, billing-agent.yml]
    connectionMode: lenient

llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
```

## Step 3: Test the System

### Start the Triage System

```bash
npx dexto --agent triage-agent.yml
```

This automatically:
- Starts the triage agent
- Connects to specialist agents as MCP servers
- Loads the `chat_with_agent` tool for delegation

### Test Scenarios

**Technical Issue:**
```
My API keeps returning 500 errors when uploading files.
```

**Expected Flow:**
1. Triage identifies → Technical Support
2. Calls `chat_with_agent` → Technical specialist responds
3. Customer gets complete troubleshooting guide

**Billing Issue:**
```
I want to upgrade my plan but confused about pricing.
```

**Expected Flow:**
1. Triage identifies → Billing Support  
2. Calls `chat_with_agent` → Billing specialist responds
3. Customer gets complete pricing explanation

## Step 4: Add More Specialists

### Product Information Agent

```yaml
# product-info-agent.yml
systemPrompt: |
  You are a Product Information Specialist covering:
  - Feature descriptions and plan comparisons
  - Integration capabilities and setup guides
  - How-to questions and best practices

mcpServers:
  web_search:
    type: stdio
    command: npx
    args: ["-y", "tavily-mcp@0.1.3"]
    env:
      TAVILY_API_KEY: $TAVILY_API_KEY

llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

### Update Triage Agent

Add the new specialist to your triage configuration:

```yaml
# Add to mcpServers section
product_info:
  type: stdio
  command: npx
  args: [dexto, --mode, mcp, --agent, product-info-agent.yml]
  connectionMode: lenient
```

Update the system prompt to include routing to Product Info Agent:

```yaml
systemPrompt: |
  Available specialists:
  - Technical Support: API errors, bugs, performance issues
  - Billing Support: payments, subscriptions, pricing  
  - Product Info: features, plans, integrations, how-to guides
  
  # ... rest of prompt
```

## Step 5: Advanced Features

### Add Business Context

Create documentation files that agents can access:

```markdown
<!-- company-info.md -->
# Company Plans

- Basic Plan: $9/month, 10 users, 5GB storage
- Pro Plan: $19/month, 100 users, 100GB storage  
- Enterprise Plan: $39/month, unlimited users, 1TB storage
```

Reference in agent configurations:

```yaml
systemPrompt:
  contributors:
    - id: base-prompt
      type: static
      content: |
        Your main system prompt here...
    
    - id: company-info
      type: file
      files: ["${{dexto.agent_dir}}/company-info.md"]  # Resolve to absolute path at load time
```

### Production Deployment

For production, run specialists as separate servers:

```bash
# Terminal 1: Technical Support
npx dexto --agent technical-support-agent.yml --mode server --port 3001

# Terminal 2: Billing Support
npx dexto --agent billing-agent.yml --mode server --port 3002

# Terminal 3: Triage Coordinator
npx dexto --agent triage-agent.yml --mode server --port 3000
```

Update triage agent to use HTTP connections:

```yaml
mcpServers:
  technical_support:
    type: http
    url: "http://localhost:3001/mcp"

  billing_support:
    type: http
    url: "http://localhost:3002/mcp"
```

## Key Concepts

### MCP Tool Delegation

The `chat_with_agent` tool enables one agent to execute another:

```yaml
# When triage agent connects to specialist as MCP server
# It gets access to chat_with_agent tool automatically
# Tool calls specialist with customer message
# Returns specialist's complete response
```

### Auto-Approval Configuration

Essential for smooth delegation:

```yaml
permissions:
  mode: auto-approve        # No manual confirmation
  allowedToolsStorage: memory  # Session-only approvals
```

### Stdio vs SSE Connections

**Development (stdio):**
- Agents start automatically
- Simple configuration
- Single machine deployment

**Production (sse):**
- Agents run as separate servers
- Distributed deployment
- Better scalability

## Complete Example

Your final file structure:

```
triage-system/
├── triage-agent.yml
├── technical-support-agent.yml  
├── billing-agent.yml
├── product-info-agent.yml
└── docs/
    └── company-info.md
```

**Test the complete system:**

```bash
npx dexto --agent triage-agent.yml "I need help with API integration and want to upgrade my billing plan"
```

The triage agent will:
1. Identify this as a technical issue (primary)
2. Route to Technical Support specialist
3. Execute the specialist via `chat_with_agent`
4. Provide complete API integration guidance
5. Optionally route billing question to Billing specialist

## Next Steps

- Add more specialists (Sales, Escalation, etc.)
- Include external tools (CRM, knowledge base)
- Implement logging and analytics
- Deploy with authentication and scaling

This pattern works for any domain where you need intelligent routing and specialized expertise! 
