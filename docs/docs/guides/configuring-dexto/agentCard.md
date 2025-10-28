---
sidebar_position: 12
sidebar_label: "Agent Card (A2A)"
---

# Agent Card Configuration

Configure your agent's public metadata for Agent-to-Agent (A2A) communication and service discovery.

:::tip Complete Reference
For complete field documentation and A2A specifications, see **[agent.yml → Agent Card](./agent-yml.md#agent-identity--a2a)**.
:::

## Overview

The agent card provides standardized metadata about your agent's capabilities, enabling other agents and services to discover and interact with your agent programmatically through the Agent-to-Agent (A2A) protocol.

**Key benefits:**
- Service discovery by other agents
- Protocol negotiation (input/output formats)
- Capability matching for task delegation
- Standardized authentication setup

Learn more: [A2A: A new era of agent interoperability](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

## Configuration

```yaml
agentCard:
  name: "My Dexto Agent"
  description: "A helpful AI assistant with specialized capabilities"
  url: "https://my-agent.example.com"
  version: "1.0.0"
  documentationUrl: "https://docs.example.com/my-agent"
  provider:
    organization: "My Company"
    url: "https://mycompany.com"
  capabilities:
    streaming: true
    pushNotifications: false
    stateTransitionHistory: false
  authentication:
    schemes: ["bearer", "apiKey"]
    credentials: "optional"
  defaultInputModes: ["application/json", "text/plain"]
  defaultOutputModes: ["application/json", "text/plain"]
  skills:
    - id: "data_analysis"
      name: "Data Analysis"
      description: "Analyze and visualize data from various sources"
      tags: ["analytics", "data", "visualization"]
      examples: ["Analyze sales data", "Create charts from CSV"]
```

## Required Fields

- **name** - Display name for your agent
- **url** - Public endpoint where your agent can be accessed
- **version** - Version identifier (semantic versioning recommended)

## Optional Fields

- **description** - Brief capability description
- **documentationUrl** - Link to documentation
- **provider** - Organization information (organization, url)
- **capabilities** - Technical capabilities (streaming, pushNotifications, stateTransitionHistory)
- **authentication** - Supported auth methods (schemes, credentials)
- **defaultInputModes** - Accepted content types
- **defaultOutputModes** - Produced content types
- **skills** - Specific agent capabilities with examples

## Examples

### Basic Agent Card

```yaml
agentCard:
  name: "Support Bot"
  description: "Customer support assistant"
  url: "https://support.mycompany.com/agent"
  version: "2.1.0"
```

### Full-Featured Agent Card

```yaml
agentCard:
  name: "Analytics Assistant"
  description: "Advanced data analysis and visualization agent"
  url: "https://analytics.mycompany.com"
  version: "3.0.0"
  documentationUrl: "https://docs.mycompany.com/analytics-agent"
  provider:
    organization: "Data Insights Corp"
    url: "https://datainsights.com"
  capabilities:
    streaming: true
    pushNotifications: true
    stateTransitionHistory: true
  authentication:
    schemes: ["bearer", "oauth2"]
    credentials: "required"
  defaultInputModes: ["application/json", "text/csv"]
  defaultOutputModes: ["application/json", "image/png", "text/html"]
  skills:
    - id: "csv_analysis"
      name: "CSV Analysis"
      description: "Parse and analyze CSV data files"
      tags: ["data", "csv", "analysis"]
      examples: ["Analyze sales data CSV", "Generate summary statistics"]
    - id: "chart_generation"
      name: "Chart Generation"
      description: "Create visualizations from data"
      tags: ["visualization", "charts"]
      examples: ["Create bar chart", "Generate trend analysis"]
```

## Skill Configuration

Skills describe specific capabilities:

```yaml
skills:
  - id: "unique_skill_id"
    name: "Human-readable name"
    description: "What this skill does"
    tags: ["category", "keywords"]
    examples: ["Example 1", "Example 2"]
    inputModes: ["text/plain"]        # Optional
    outputModes: ["application/json"] # Optional
```

## A2A Communication

The agent card enables:
- **Service Discovery** - Other agents find your capabilities
- **Protocol Negotiation** - Compatible format selection
- **Capability Matching** - Task delegation decisions
- **Authentication** - Secure agent-to-agent setup

## Default Behavior

If no agent card is specified, Dexto generates basic metadata from your configuration. For A2A communication, explicit configuration is recommended.

## See Also

- [agent.yml Reference → Agent Card](./agent-yml.md#agent-identity--a2a) - Complete field documentation
- [A2A Documentation](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) - Official A2A specification
