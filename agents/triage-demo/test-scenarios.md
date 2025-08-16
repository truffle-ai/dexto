# TeamFlow Triage Agent Test Scenarios

Use these realistic TeamFlow customer support scenarios to test the triage agent's **complete customer support workflow**. The triage agent will analyze each request, route to the appropriate specialist agent, execute the specialist via MCP tools, and provide complete customer responses.

## 🔧 Technical Support Scenarios

### Scenario T1: API Integration Issue
```
Hi, I'm trying to integrate the TeamFlow API with our system but I keep getting a 401 unauthorized error even though I'm using the correct API key. I've checked the documentation but can't figure out what's wrong. Our rate limit should be 10,000/hour on our Pro plan. Can you help?
```
**Expected Route**: Technical Support Agent  
**Expected Response**: Complete troubleshooting guide including API key validation steps, common 401 causes, rate limit verification, and Pro plan API specifications  
**Tool Execution**: `chat_with_agent` → Technical Support provides detailed debugging steps

### Scenario T2: App Crash  
```
My TeamFlow mobile app crashes every time I try to export project data. It worked fine last week but now it just freezes and closes. I'm using iPhone 15 with iOS 17.2. This is really urgent as I need this data for a client presentation tomorrow.
```
**Expected Route**: Technical Support Agent  
**Expected Response**: Complete crash resolution including device-specific troubleshooting, export alternatives, and immediate workarounds for urgent timeline  
**Tool Execution**: `chat_with_agent` → Technical Support provides iOS-specific fixes and emergency data export options

### Scenario T3: Performance Issue
```
Your web dashboard has been extremely slow for the past 3 days. Pages take 30+ seconds to load and sometimes timeout completely. My internet connection is fine and other websites work normally.
```
**Expected Route**: Technical Support Agent  
**Expected Response**: Complete performance troubleshooting including browser optimization, cache clearing, system status check, and escalation to infrastructure team if needed  
**Tool Execution**: `chat_with_agent` → Technical Support provides systematic performance diagnosis steps

## 💳 Billing Support Scenarios

### Scenario B1: Double Charge
```
I just checked my credit card statement and I was charged twice for this month's subscription - once on the 1st for $49.99 and again on the 3rd for the same amount. I need the duplicate charge refunded immediately.
```
**Expected Route**: Billing Agent  
**Expected Response**: Complete refund process including charge verification, refund timeline (3-5 business days), and account credit options for immediate resolution  
**Tool Execution**: `chat_with_agent` → Billing Agent provides specific refund procedures and account investigation steps

### Scenario B2: Subscription Management
```
I want to upgrade from the Basic plan to Pro plan but I'm confused about the pricing. Will I be charged the full Pro amount or just the difference? Also, when would the upgrade take effect?
```
**Expected Route**: Billing Agent  
**Expected Response**: Complete upgrade explanation including prorated billing calculation, immediate feature access, next billing cycle details, and upgrade procedure  
**Tool Execution**: `chat_with_agent` → Billing Agent provides detailed prorated pricing explanation and upgrade process

### Scenario B3: Payment Failure
```
My payment failed this morning and now my account is suspended. I updated my credit card last week so I'm not sure why it didn't work. How can I get my account reactivated quickly?
```
**Expected Route**: Billing Agent  
**Expected Response**: Complete reactivation process including payment method verification, retry options, account status restoration timeline, and prevention steps  
**Tool Execution**: `chat_with_agent` → Billing Agent provides immediate account reactivation steps and payment troubleshooting

## 📖 Product Information Scenarios

### Scenario P1: Feature Comparison
```
What's the difference between TeamFlow's Pro and Enterprise plans? I specifically need to know about API rate limits, user management features, and data export capabilities. We're a team of 25 people and currently on the Basic plan.
```
**Expected Route**: Product Info Agent  
**Expected Response**: Complete plan comparison including detailed feature matrix, specific API limits (Pro: 10K/hour, Enterprise: 100K/hour), user management differences, and upgrade recommendation for 25-person team  
**Tool Execution**: `chat_with_agent` → Product Info Agent provides comprehensive plan comparison with team-size specific recommendations

### Scenario P2: How-To Question
```
How do I set up automated reports to be sent to my team every Monday? I see the reporting feature but can't figure out how to schedule them. Is this available in my current plan?
```
**Expected Route**: Product Info Agent  
**Expected Response**: Complete setup guide including step-by-step report scheduling instructions, plan feature verification, and links to relevant documentation  
**Tool Execution**: `chat_with_agent` → Product Info Agent provides detailed automated reporting setup walkthrough

### Scenario P3: Integration Capabilities
```
Does TeamFlow integrate with Salesforce and Slack? I need to sync customer project data and get notifications in our Slack channels. What's the setup process like and are there any limitations I should know about? We're on the Pro plan.
```
**Expected Route**: Product Info Agent  
**Expected Response**: Complete integration overview including supported Salesforce/Slack features, Pro plan limitations, setup documentation links, and configuration best practices  
**Tool Execution**: `chat_with_agent` → Product Info Agent provides comprehensive integration capabilities and setup guidance

## 🚨 Escalation Scenarios

### Scenario E1: Legal Threat
```
This is my fourth email about data privacy violations. Your service exposed my customer data to unauthorized parties and I'm considering legal action. I need to speak with a manager immediately about this data breach.
```
**Expected Route**: Escalation Agent  
**Expected Response**: Complete escalation including immediate management contact information, legal/compliance team connection, incident escalation procedure, and 2-hour response commitment  
**Tool Execution**: `chat_with_agent` → Escalation Agent provides senior management contact and legal compliance escalation process

### Scenario E2: Business Impact
```
Your system outage yesterday caused my e-commerce site to be down for 6 hours during Black Friday. This resulted in approximately $50,000 in lost sales. I need compensation for this business interruption and want to discuss SLA violations.
```
**Expected Route**: Escalation Agent  
**Expected Response**: Complete business impact assessment including SLA review, compensation evaluation process, senior account manager contact, and formal incident investigation  
**Tool Execution**: `chat_with_agent` → Escalation Agent provides business impact claim process and executive contact information

### Scenario E3: Service Quality Complaint
```
I've been a customer for 3 years and the service quality has declined dramatically. Multiple support tickets have been ignored, features are constantly broken, and I'm considering switching to a competitor. I want to speak with someone who can actually resolve these ongoing issues.
```
**Expected Route**: Escalation Agent  
**Expected Response**: Complete retention process including account review, senior support contact, service improvement plan, and customer success manager assignment  
**Tool Execution**: `chat_with_agent` → Escalation Agent provides customer retention specialist contact and service quality improvement plan

## 🤔 Mixed/Complex Scenarios

### Scenario M1: Technical + Billing
```
My API requests started failing yesterday with 429 rate limit errors, but I'm on the Pro plan which should have higher limits. Did my plan get downgraded? I'm still being charged the Pro price but getting Basic plan limits.
```
**Expected Route**: Technical Support Agent (primary) or Billing Agent  
**Expected Response**: Complete investigation including API limit verification, account status check, billing verification, and either technical resolution or billing escalation  
**Tool Execution**: `chat_with_agent` → Technical Support investigates API limits and coordinates with billing if needed

### Scenario M2: Product + Escalation
```
I was promised during the sales call that your Enterprise plan includes custom integrations. However, after upgrading, I'm being told this requires an additional $10,000 implementation fee. This contradicts what I was told by your sales team.
```
**Expected Route**: Escalation Agent  
**Expected Response**: Complete sales promise review including sales team consultation, Enterprise feature verification, implementation fee clarification, and senior sales manager contact  
**Tool Execution**: `chat_with_agent` → Escalation Agent provides sales promise investigation and senior management contact

### Scenario M3: Vague Request
```
Hi, I'm having trouble with your service. Can you help me?
```
**Expected Route**: Should ask for clarification before routing  
**Expected Response**: Polite clarification request with specific questions to help identify the issue type and appropriate specialist  
**Tool Execution**: Triage agent asks clarifying questions without executing specialist tools

## 🎯 Testing Instructions

### Interactive Testing

1. **Start the complete triage system**:
   ```bash
   npx dexto --agent agents/triage-demo/triage-agent.yml
   ```

2. **Copy and paste** scenarios from above into the chat

3. **Observe the complete workflow**:
   - **Routing analysis** (which specialist is chosen and why)
   - **Tool execution** (`chat_with_agent` tool calls)  
   - **Complete customer response** (routing confirmation + specialist answer)
   - **Response quality** (specificity, completeness, helpfulness)

### One-Shot Testing

Test scenarios quickly with command-line execution:

```bash
# Test Technical Support scenario
npx dexto --agent agents/triage-demo/triage-agent.yml "My TeamFlow mobile app crashes every time I try to export project data. I'm using iPhone 15 with iOS 17.2. This is urgent."

# Test Billing scenario  
npx dexto --agent agents/triage-demo/triage-agent.yml "I want to upgrade from Basic to Pro but confused about pricing. Will I be charged the full amount?"

# Test Product Info scenario
npx dexto --agent agents/triage-demo/triage-agent.yml "What's the difference between Pro and Enterprise plans? I need API access for 25 people."

# Test Escalation scenario
npx dexto --agent agents/triage-demo/triage-agent.yml "Your system outage cost my business $50,000 in lost sales. I need compensation and want to discuss SLA violations."
```

### Expected Response Quality

For each test, verify that responses include:

1. **Brief routing confirmation** (one sentence about which specialist was consulted)
2. **Complete specialist answer** with specific, actionable information
3. **Relevant details** from TeamFlow's business documentation
4. **Appropriate tone** (professional, helpful, empathetic when needed)
5. **Follow-up invitation** (offering additional help if needed)

## 📊 Expected Results Summary

| Category | Count | Expected Workflow |
|----------|-------|-------------------|
| Technical | 3 | Route → Execute Technical Support → Complete troubleshooting response |
| Billing | 3 | Route → Execute Billing Agent → Complete billing/payment resolution |
| Product Info | 3 | Route → Execute Product Info Agent → Complete feature/plan information |
| Escalation | 3 | Route → Execute Escalation Agent → Complete escalation with contacts |
| Mixed/Complex | 3 | Route → Execute Primary Agent → Complete investigation/resolution |

## 🔍 Success Criteria

The triage system should demonstrate:

- **95%+ routing accuracy** to appropriate specialist agents
- **100% tool execution** success (no failed `chat_with_agent` calls)
- **Complete responses** that directly address customer needs
- **Professional tone** with empathy for customer situations
- **Specific information** from TeamFlow business context (plans, policies, features)
- **Clear next steps** for customer resolution

## 🚫 Common Issues to Watch For

- **Routing without execution**: Agent identifies correct specialist but doesn't call `chat_with_agent`
- **Tool confirmation prompts**: Should auto-approve due to configuration
- **Incomplete responses**: Missing specialist answers or generic routing messages
- **Wrong specialist**: Incorrect routing based on request analysis
- **Multiple tool calls**: Unnecessary repeated calls to specialists

The complete triage system should provide **seamless, professional customer support** that customers would expect from a real enterprise support team! 