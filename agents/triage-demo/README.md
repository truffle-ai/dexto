# TeamFlow Customer Support Triage Agent System

This demonstration showcases an intelligent **Customer Support Triage System** built with Dexto agents for **TeamFlow**, a cloud-based project management and team collaboration platform. The system automatically analyzes customer inquiries, routes them to specialized support agents, and provides complete customer support responses.

## 🏢 About TeamFlow (Demo Business Context)

TeamFlow is a fictional cloud-based project management platform used for this demonstration. It offers three service tiers:

- **Basic Plan ($9/user/month)**: Up to 10 team members, 5GB storage, basic features
- **Pro Plan ($19/user/month)**: Up to 100 team members, 100GB storage, advanced integrations (Slack, GitHub, Salesforce)  
- **Enterprise Plan ($39/user/month)**: Unlimited users, 1TB storage, SSO, dedicated support

Key features include project management, team collaboration, time tracking, mobile apps, and a comprehensive API. The platform integrates with popular tools like Slack, GitHub, Salesforce, and Google Workspace.

This realistic business context allows the agents to provide specific, accurate responses about pricing, features, technical specifications, and policies using the FileContributor system to access comprehensive documentation.

## 🏗️ Architecture Overview

```
Customer Request
       ↓
   Triage Agent (Main Coordinator)
       ↓
   [Analyzes, Routes & Executes via MCP]
       ↓
┌─────────────────────────────────────────┐
│  Technical Support  │  Billing Agent   │
│      Agent          │                  │
├─────────────────────┼──────────────────┤
│  Product Info       │  Escalation      │
│     Agent           │    Agent         │
└─────────────────────────────────────────┘
       ↓
   Complete Customer Response
```

The triage agent doesn't just route requests - it **executes the specialized agents as MCP servers** and provides complete, integrated customer support responses that combine routing intelligence with expert answers.

## 🤖 Agent Roles

### 1. **Triage Agent** (`triage-agent.yml`)
- **Primary Role**: Intelligent routing coordinator AND customer response provider
- **Capabilities**: 
  - Analyzes requests and categorizes issues
  - Routes to specialists via `chat_with_agent` tool calls
  - **Executes specialist agents directly through MCP connections**
  - **Provides complete customer responses** combining routing + specialist answers
- **Tools**: Filesystem, web research, **chat_with_agent** (connects to all specialists)
- **Tool Confirmation**: Auto-approve mode for seamless delegation

### 2. **Technical Support Agent** (`technical-support-agent.yml`) 
- **Specialization**: Bug fixes, troubleshooting, system issues
- **Tools**: Filesystem, terminal, browser automation
- **Model**: GPT-4o (higher capability for complex technical issues)
- **Connection**: Available as MCP server via stdio

### 3. **Billing Agent** (`billing-agent.yml`)
- **Specialization**: Payments, subscriptions, financial inquiries  
- **Tools**: Browser automation, filesystem for policy docs
- **Model**: GPT-4o-mini (efficient for structured billing processes)
- **Connection**: Available as MCP server via stdio

### 4. **Product Info Agent** (`product-info-agent.yml`)
- **Specialization**: Features, comparisons, documentation
- **Tools**: Web research (Tavily), filesystem, browser automation
- **Model**: GPT-4o-mini (efficient for information retrieval)
- **Connection**: Available as MCP server via stdio

### 5. **Escalation Agent** (`escalation-agent.yml`)
- **Specialization**: Complex issues, Enterprise customers, management approval
- **Tools**: Filesystem, web research for compliance/legal info
- **Model**: GPT-4o (higher capability for sensitive issues)
- **Connection**: Available as MCP server via stdio

## 📚 Business Context Documentation

Each agent has access to relevant TeamFlow documentation via the FileContributor system:

### Documentation Files (`docs/` folder)
- **`company-overview.md`**: General company information, plans, SLAs, contact info
- **`technical-documentation.md`**: API docs, system requirements, troubleshooting guides
- **`billing-policies.md`**: Pricing, refund policies, billing procedures, payment methods
- **`product-features.md`**: Feature descriptions, plan comparisons, integrations
- **`escalation-policies.md`**: Escalation procedures, contact information, incident templates

### Agent-Specific Context
- **Technical Support**: Company overview + technical documentation
- **Billing Agent**: Company overview + billing policies
- **Product Info**: Company overview + product features
- **Escalation**: Company overview + escalation policies
- **Triage Agent**: Company overview for routing context

## 🚀 Getting Started

### Quick Start - Integrated Triage System

The **recommended way** to run the triage system is using the main triage agent, which automatically connects to all specialists:

```bash
# Run the complete triage system (connects to all specialist agents automatically)
npx dexto --agent agents/triage-demo/triage-agent.yml

# Test with a customer inquiry
npx dexto --agent agents/triage-demo/triage-agent.yml "I want to upgrade from Basic to Pro but confused about pricing"
```

This will:
1. **Auto-connect** to all 4 specialist agents as MCP servers
2. **Analyze** your request and route to the appropriate specialist  
3. **Execute** the specialist agent to get the expert answer
4. **Respond** with a complete customer support response

### Running Individual Agents (Advanced)

For testing individual specialist agents:

```bash
# Run specialized agents individually  
npx dexto --agent agents/triage-demo/technical-support-agent.yml
npx dexto --agent agents/triage-demo/billing-agent.yml
npx dexto --agent agents/triage-demo/product-info-agent.yml
npx dexto --agent agents/triage-demo/escalation-agent.yml
```

### Environment Setup

Ensure you have the required API keys in your `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key  # For web research
```

## 📋 Example Scenarios

### Scenario 1: Technical Issue
**Customer Input**: *"My app keeps crashing when I try to upload files. Getting error code 500."*

**Triage Agent Response**:
- **Analysis**: Technical Issue → Route to Technical Support Agent
- **Execution**: Calls `chat_with_agent` → Technical Support provides debugging steps
- **Customer Response**: *"I've routed your issue to our Technical Support team. Here's how to resolve the 500 error when uploading files: [detailed technical troubleshooting steps from specialist]"*

### Scenario 2: Billing Question  
**Customer Input**: *"I want to upgrade from Basic to Pro but confused about pricing. Will I be charged the full amount?"*

**Triage Agent Response**:
- **Analysis**: Billing Question → Route to Billing Agent  
- **Execution**: Calls `chat_with_agent` → Billing Agent explains prorated pricing
- **Customer Response**: *"I've routed your inquiry to our Billing team. When upgrading from Basic to Pro, you'll only be charged a prorated amount for the remaining billing period - just the difference between plans for the time left in your cycle. The upgrade takes effect immediately."*

### Scenario 3: Product Information
**Customer Input**: *"What's the difference between your Pro and Enterprise plans? I need API access."*

**Triage Agent Response**:
- **Analysis**: Product Inquiry → Route to Product Info Agent
- **Execution**: Calls `chat_with_agent` → Product Info Agent provides detailed comparison
- **Customer Response**: *"I've connected you with our Product team. Both Pro and Enterprise plans include full API access. The main differences are: Pro supports up to 100 users with 100GB storage, while Enterprise offers unlimited users, 1TB storage, SSO, and dedicated support. [detailed feature comparison]"*

### Scenario 4: Escalation Required
**Customer Input**: *"This is my third time contacting support about data privacy concerns. I'm considering legal action."*

**Triage Agent Response**:
- **Analysis**: Legal/Compliance Issue → Route to Escalation Agent
- **Execution**: Calls `chat_with_agent` → Escalation Agent provides management contact
- **Customer Response**: *"I've escalated your data privacy concerns to our senior support team. Given the legal implications, I'm connecting you directly with our compliance manager Sarah Johnson (sarah.johnson@teamflow.com). She'll address your concerns within 2 hours."*

## 🔧 Advanced Configuration

### Current MCP Server Configuration (Automatic)

The triage agent automatically connects to specialists via stdio MCP servers:

```yaml
# Current configuration in triage-agent.yml
mcpServers:
  technical_support:
    type: stdio
    command: npx
    args: [dexto, --mode, mcp, --agent, agents/triage-demo/technical-support-agent.yml]
  
  billing_support:
    type: stdio  
    command: npx
    args: [dexto, --mode, mcp, --agent, agents/triage-demo/billing-agent.yml]
  
  # Similar configuration for product_info and escalation agents...
```

### Production Configuration (Distributed Servers)

For production deployment, you would run each specialist as a separate server:

```yaml
# triage-agent.yml - Production Configuration
mcpServers:
  technical_support:
    type: sse
    url: "http://localhost:3001/mcp"
    headers:
      Authorization: "Bearer your-auth-token"
  
  billing_support:
    type: sse  
    url: "http://localhost:3002/mcp"
    headers:
      Authorization: "Bearer your-auth-token"
  
  product_info:
    type: sse
    url: "http://localhost:3003/mcp"
    headers:
      Authorization: "Bearer your-auth-token"
    
  escalation:
    type: sse
    url: "http://localhost:3004/mcp"
    headers:
      Authorization: "Bearer your-auth-token"
```

### Running Distributed Servers

```bash
# Terminal 1: Technical Support Server
npx dexto --agent agents/triage-demo/technical-support-agent.yml --mode server --port 3001

# Terminal 2: Billing Support Server  
npx dexto --agent agents/triage-demo/billing-agent.yml --mode server --port 3002

# Terminal 3: Product Info Server
npx dexto --agent agents/triage-demo/product-info-agent.yml --mode server --port 3003

# Terminal 4: Escalation Server
npx dexto --agent agents/triage-demo/escalation-agent.yml --mode server --port 3004

# Terminal 5: Main Triage Coordinator
npx dexto --agent agents/triage-demo/triage-agent.yml --mode server --port 3000
```

## 🎯 Key Features Demonstrated

### 1. **Intelligent Routing with Execution**
- Natural language analysis to determine issue category
- **Automatic execution** of specialist agents via MCP
- **Complete customer responses** combining routing + expert answers
- Seamless tool confirmation with auto-approve mode

### 2. **Specialized Expertise Integration**
- Each agent has domain-specific knowledge and tools
- **Real-time coordination** between triage and specialists
- **Unified customer experience** despite multi-agent backend

### 3. **Scalable MCP Architecture**
- **Stdio connections** for local development and testing
- **SSE connections** for distributed production deployment
- **Tool-based delegation** using `chat_with_agent`

### 4. **Comprehensive Tool Access**
- Filesystem access for documentation and logging
- Web research capabilities for up-to-date information
- Browser automation for testing and demonstrations
- **Agent-to-agent communication** via MCP tools

## 🔍 Testing the System

### Interactive Testing

1. **Start the complete triage system**:
   ```bash
   npx dexto --agent agents/triage-demo/triage-agent.yml
   ```

2. **Test with various customer scenarios** and observe:
   - **Routing analysis** (which specialist is chosen)
   - **Tool execution** (`chat_with_agent` calls)
   - **Complete responses** (routing confirmation + specialist answer)

### Sample Test Cases

```
Test 1: "API returns 401 unauthorized error"
Expected: Technical Support Agent → Complete troubleshooting response

Test 2: "Cancel my subscription immediately"  
Expected: Billing Agent → Complete cancellation process and policy info

Test 3: "Do you have a mobile app?"
Expected: Product Info Agent → Complete feature details and download links

Test 4: "Your service caused my business to lose $10,000"
Expected: Escalation Agent → Complete escalation with management contact
```

### One-Shot Testing

```bash
# Test billing scenario
npx dexto --agent agents/triage-demo/triage-agent.yml "I was charged twice this month"

# Test technical scenario  
npx dexto --agent agents/triage-demo/triage-agent.yml "Getting 500 errors on file upload"

# Test product scenario
npx dexto --agent agents/triage-demo/triage-agent.yml "What integrations do you support?"
```

## 🚦 Production Considerations

### Security
- Implement proper authentication between agents
- Secure API key management  
- Customer data privacy controls
- **Tool confirmation policies** for sensitive operations

### Monitoring  
- Log all routing decisions and tool executions
- Track resolution times by agent type
- Monitor escalation patterns
- **Tool usage analytics** for optimization

### Scaling
- Load balance multiple instances of specialist agents
- Implement request queuing for high volume
- **Distributed MCP server deployment**
- Add more specialized agents as needed (e.g., Sales, Onboarding)

## 🤝 Contributing

To extend this triage system:

1. **Add new specialist agents** by creating new YAML configs
2. **Update triage routing logic** in the main agent's system prompt  
3. **Configure new agents as MCP servers** in the triage agent's mcpServers section
4. **Test end-to-end flow** including tool execution and complete responses

This demonstration showcases the power of **multi-agent coordination with tool execution** using Dexto's MCP integration capabilities! 