---
title: "Human In The Loop: Dynamic Form Generation"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Human In The Loop: Dynamic Form Generation

Agents can generate structured forms when they need additional data, making it easier to collect extra info and approvals from users.

<ExpandableImage src="/assets/user_form_demo.gif" alt="User Form Demo" title="Human In The Loop: Dynamic Form Generation" width={900} />

## What it does

When an agent needs clarification or additional input, it can:
- **Generate dynamic forms** with appropriate fields
- **Validate user input** before proceeding
- **Request approvals** for sensitive operations
- **Collect structured data** in an intuitive way

## How it works

The agent automatically triggers form generation when it needs more information:

```bash
# Example: Booking a flight
> "Book me a flight to New York"

# Agent generates a form requesting:
- Departure date
- Return date
- Preferred airline
- Budget range
- Seat preference
```

You fill out the form, submit it, and the agent continues with the complete information.

## Use Cases

### 1. Tool Approvals
Before executing sensitive operations (deleting files, making API calls), the agent requests confirmation with details about what will happen.

### 2. Missing Parameters
When a task requires specific data the agent doesn't have, it generates a form to collect it efficiently.

### 3. Configuration
Setting up complex configurations becomes easier with guided form inputs instead of free-form text.

### 4. Data Collection
Collect structured information for reports, bookings, or any multi-field data entry.

## Configuration

Configure approval requirements in your `agent.yml`:

```yaml
toolApproval:
  mode: selective
  requireApprovalFor:
    - deleteFile
    - executeCommand
    - makePurchase
```

## Benefits

- **Better UX**: Structured forms are easier than back-and-forth messages
- **Validation**: Ensure data is correct before processing
- **Safety**: Explicit approvals for dangerous operations
- **Efficiency**: Collect multiple fields at once

## Learn More

- [Agent Configuration](/docs/guides/configuring-dexto/overview)
- [Tool Confirmation Settings](/docs/guides/configuring-dexto/agent-yml#tool-confirmation)
- [MCP Elicitation](/docs/mcp/elicitation)
