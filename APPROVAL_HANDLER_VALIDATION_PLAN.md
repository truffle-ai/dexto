# Approval Handler Validation - Implementation Plan

**Status**: ✅ Implemented  
**Commit**: `a767162c`

## Problem Statement
Currently, agents configured with `toolConfirmation.mode: 'manual'` can start without an approval handler, leading to runtime failures when tools are actually executed. This is poor DX.

## Solution: Strict Validation at Start

Validate that manual mode has a handler **before** `agent.start()` completes.

---

## Code Paths to Handle

### Path 1: Initial Agent Startup (CLI/Server)
**Flow:**
1. Create DextoAgent instance (not started)
2. Call `createDextoApp({ getAgent, ... })`
   - Inside createDextoApp: Set approval handler if manual mode
3. Start agent
4. **✅ WORKS** - Handler is already set before start()

### Path 2: Agent Switching
**Current Flow (BROKEN):**
1. Create new DextoAgent instance
2. Register webhookSubscriber
3. **Start new agent** ← NO HANDLER SET!
4. Switch activeAgent reference

**Fixed Flow:**
1. Create new DextoAgent instance
2. Wire approval handler + SSE subscribers to new agent
3. Start new agent ← Handler validated, passes!
4. Switch activeAgent reference
5. Stop old agent

### Path 3: Direct Library Usage
**Flow:**
```typescript
const agent = new DextoAgent({ toolConfirmation: { mode: 'manual' }, ... });
await agent.start(); // Should throw!
```
**✅ WORKS** - Will throw with helpful message

---

## Implementation Tasks

### 1. Add `hasHandler()` Method to ApprovalManager
**File:** `packages/core/src/approval/manager.ts`

```typescript
/**
 * Check if an approval handler is configured
 */
public hasHandler(): boolean {
    return this.handler !== undefined;
}
```

### 2. Add Validation in `DextoAgent.start()`
**File:** `packages/core/src/agent/DextoAgent.ts`

Add after service initialization, before marking as started:

```typescript
// Validate approval configuration
if (this.config.toolConfirmation.mode === 'manual') {
    if (!this.approvalManager.hasHandler()) {
        throw AgentError.invalidConfig(
            'Tool confirmation mode is "manual" but no approval handler is configured.\n' +
            'Call agent.setApprovalHandler(...) before starting the agent.'
        );
    }
}
```

### 3. Move Subscriber Creation to CLI Layer
**File:** `packages/cli/src/api/server-hono.ts`

Move subscriber creation OUT of `createDextoApp` and INTO CLI layer for full control:

```typescript
// Create subscribers at top level in initializeHonoApi
const webhookSubscriber = new WebhookEventSubscriber();
const sseSubscriber = new A2ASseEventSubscriber();
const messageStreamManager = new MessageStreamManager();

// Helper function to wire services to an agent
async function wireServicesToAgent(agent: DextoAgent) {
    // Subscribe to event bus (methods handle aborting previous subscriptions)
    webhookSubscriber.subscribe(agent.agentEventBus);
    sseSubscriber.subscribe(agent.agentEventBus);
    messageStreamManager.subscribeToEventBus(agent.agentEventBus);
    
    // Set approval handler if manual mode
    const config = agent.getEffectiveConfig();
    if (config.toolConfirmation?.mode === 'manual') {
        const { createManualApprovalHandler } = await import('@dexto/server');
        const timeoutMs = config.toolConfirmation?.timeout ?? 120_000;
        const handler = createManualApprovalHandler(agent.agentEventBus, timeoutMs);
        agent.setApprovalHandler(handler);
    }
}

// Wire to initial agent BEFORE starting
await wireServicesToAgent(activeAgent);
```

### 4. Update createDextoApp to Accept Subscribers
**File:** `packages/server/src/hono/index.ts`

Remove subscriber creation, accept as parameters:

```typescript
export type CreateDextoAppOptions = {
    apiPrefix?: string;
    getAgent: () => DextoAgent;
    getAgentCard: () => AgentCard;
    agentsContext?: AgentsRouterContext;
    messageStreamManager: MessageStreamManager; // Add
    webhookSubscriber: WebhookEventSubscriber; // Add
    sseSubscriber: A2ASseEventSubscriber; // Add
};

export function createDextoApp(options: CreateDextoAppOptions) {
    const { 
        getAgent, 
        getAgentCard, 
        agentsContext,
        messageStreamManager,
        webhookSubscriber,
        sseSubscriber,
    } = options;
    
    const app = new OpenAPIHono({ strict: false }) as DextoApp;
    
    // NOTE: Subscribers are already wired in CLI layer before agent.start()
    // No need to wire them here
    
    app.webhookSubscriber = webhookSubscriber;
    
    // ... rest of app setup (routes, etc.)
}
```

### 5. Update Agent Switching
**File:** `packages/cli/src/api/server-hono.ts`

```typescript
async function performAgentSwitch(
    newAgent: DextoAgent,
    agentId: string,
    bridge: ReturnType<typeof createNodeServer>
) {
    logger.info('Preparing new agent for switch...');
    
    // Register webhook subscriber for LLM streaming events
    if (bridge.webhookSubscriber) {
        newAgent.registerSubscriber(bridge.webhookSubscriber);
    }

    // Switch activeAgent reference
    const previousAgent = activeAgent;
    activeAgent = newAgent;
    activeAgentId = agentId;

    // Wire SSE subscribers and approval handler BEFORE starting
    // This is critical for validation to pass
    logger.info('Wiring services to new agent...');
    await wireServicesToAgent(newAgent);

    // Now start the agent (validation will pass!)
    logger.info(`Starting new agent: ${agentId}`);
    await newAgent.start();

    // Update agent card
    agentCardData = createAgentCard({ ... });

    // Stop previous agent last
    try {
        if (previousAgent && previousAgent !== newAgent) {
            await previousAgent.stop();
        }
    } catch (err) {
        logger.warn(`Stopping previous agent failed: ${err}`);
    }

    return await resolveAgentInfo(agentId);
}
```

---

## Edge Cases Handled

1. **✅ Initial agent without handler** - Throws at start()
2. **✅ Agent switching without handler** - Rewires before start()
3. **✅ SSE subscribers on switch** - Resubscribed via wireAgentServices()
4. **✅ Multiple switches** - Each switch calls rewire, abort controllers handle cleanup
5. **✅ Auto-approve/deny modes** - No handler needed, validation skipped
6. **✅ Elicitation mode** - Always requires handler (existing logic)

---

## Testing Checklist

- [ ] Direct DextoAgent instantiation with manual mode, no handler → throws at start()
- [ ] Server starts with manual mode → works (handler set before start)
- [ ] Server starts with auto-approve mode → works (no handler needed)
- [ ] Switch from manual to manual agent → works (rewires handler)
- [ ] Switch from auto-approve to manual agent → works (rewires handler)
- [ ] Switch from manual to auto-approve agent → works (no handler needed)
- [ ] Tool approval works after switch → modal appears
- [ ] SSE streams work after switch → events received

---

## Migration Notes for Users

No breaking changes for existing users:
- Server setup already sets handler before start()
- Agent switching now properly rewires services
- Direct library users get clear error with fix instructions

