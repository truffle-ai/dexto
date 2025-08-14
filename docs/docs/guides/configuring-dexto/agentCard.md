---
sidebar_position: 8
sidebar_label: "Agent Card (A2A)"
---

# Agent Card Configuration

Configure your agent's public metadata for Agent-to-Agent (A2A) communication and service discovery.

## Overview

The agent card provides standardized metadata about your agent's capabilities, allowing other agents and services to discover and interact with your agent programmatically.

Learn more about Agent-to-Agent communication: [A2A: A new era of agent interoperability](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

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

### `name`
- **Type:** String
- **Description:** Display name for your agent

### `url`
- **Type:** String (URL)
- **Description:** Public endpoint where your agent can be accessed

### `version`
- **Type:** String
- **Description:** Version identifier for your agent

## Optional Fields

### `description`
- **Type:** String
- **Default:** "Dexto is an AI assistant capable of chat and task delegation, accessible via multiple protocols."
- **Description:** Brief description of your agent's capabilities

### `documentationUrl`
- **Type:** String (URL)
- **Description:** Link to your agent's documentation

### `provider`
- **Type:** Object
- **Description:** Information about the organization providing this agent

```yaml
provider:
  organization: "Your Organization Name"
  url: "https://yourorganization.com"
```

### `capabilities`
- **Type:** Object
- **Description:** Technical capabilities your agent supports

```yaml
capabilities:
  streaming: true                    # Supports real-time streaming responses
  pushNotifications: false           # Can send push notifications
  stateTransitionHistory: false      # Maintains state transition history
```

### `authentication`
- **Type:** Object
- **Description:** Supported authentication methods

```yaml
authentication:
  schemes: ["bearer", "apiKey"]      # Supported auth schemes
  credentials: "optional"            # Credential requirements
```

### `defaultInputModes`
- **Type:** Array of strings
- **Default:** `["application/json", "text/plain"]`
- **Description:** Content types your agent accepts

### `defaultOutputModes`
- **Type:** Array of strings  
- **Default:** `["application/json", "text/event-stream", "text/plain"]`
- **Description:** Content types your agent can produce

### `skills`
- **Type:** Array of skill objects
- **Description:** Specific capabilities your agent provides

```yaml
skills:
  - id: "unique_skill_id"
    name: "Human-readable skill name"
    description: "What this skill does"
    tags: ["category", "keywords"]
    examples: ["Example usage 1", "Example usage 2"]
    inputModes: ["text/plain"]        # Optional, defaults to ["text/plain"]
    outputModes: ["application/json"] # Optional, defaults to ["text/plain"]
```

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
  defaultInputModes: ["application/json", "text/csv", "application/xml"]
  defaultOutputModes: ["application/json", "image/png", "text/html"]
  skills:
    - id: "csv_analysis"
      name: "CSV Analysis"
      description: "Parse and analyze CSV data files"
      tags: ["data", "csv", "analysis"]
      examples: ["Analyze sales data CSV", "Generate summary statistics"]
      inputModes: ["text/csv", "text/plain"]
      outputModes: ["application/json", "text/html"]
    - id: "chart_generation"
      name: "Chart Generation"
      description: "Create visualizations from data"
      tags: ["visualization", "charts", "graphs"]
      examples: ["Create bar chart", "Generate trend analysis"]
      inputModes: ["application/json"]
      outputModes: ["image/png", "image/svg+xml"]
```

## Agent-to-Agent Communication

The agent card enables:

- **Service Discovery:** Other agents can find and understand your agent's capabilities
- **Protocol Negotiation:** Automatic selection of compatible input/output formats
- **Capability Matching:** Agents can determine if your agent can help with specific tasks
- **Authentication:** Proper setup of secure agent-to-agent communication

## Default Behavior

If no agent card is specified, Dexto will generate basic metadata based on your configuration. For A2A communication, it's recommended to configure your agent card explicitly.

