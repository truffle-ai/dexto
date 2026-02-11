import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentStateManager } from './state-manager.js';
import { AgentEventBus } from '../events/index.js';
import { LLMConfigSchema } from '@core/llm/schemas.js';
import { McpServerConfigSchema, ServerConfigsSchema } from '@core/mcp/schemas.js';
import { SystemPromptConfigSchema } from '@core/systemPrompt/schemas.js';
import { SessionConfigSchema } from '@core/session/schemas.js';
import { ToolConfirmationConfigSchema, ElicitationConfigSchema } from '@core/tools/schemas.js';
import { InternalResourcesSchema } from '@core/resources/schemas.js';
import { PromptsSchema } from '@core/prompts/schemas.js';
import type { AgentRuntimeSettings } from '@core/agent/runtime-config.js';

describe('AgentStateManager Events', () => {
    let stateManager: AgentStateManager;
    let eventBus: AgentEventBus;
    let validatedConfig: AgentRuntimeSettings;
    let mockLogger: any;

    beforeEach(() => {
        eventBus = new AgentEventBus();
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;

        const llm = LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5',
            apiKey: 'test-key',
            maxIterations: 50,
        });

        const mcpServer = McpServerConfigSchema.parse({
            type: 'stdio',
            command: 'test',
            args: [],
            env: {},
            timeout: 30000,
            connectionMode: 'lenient',
        });

        validatedConfig = {
            systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant'),
            llm,
            agentId: 'test-agent',
            mcpServers: ServerConfigsSchema.parse({ test: mcpServer }),
            sessions: SessionConfigSchema.parse({ maxSessions: 100, sessionTTL: 3600000 }),
            toolConfirmation: ToolConfirmationConfigSchema.parse({
                mode: 'manual',
                timeout: 30000,
                allowedToolsStorage: 'storage',
            }),
            elicitation: ElicitationConfigSchema.parse({ enabled: false }),
            internalResources: InternalResourcesSchema.parse([]),
            prompts: PromptsSchema.parse([]),
        };

        stateManager = new AgentStateManager(validatedConfig, eventBus, mockLogger);
    });

    it('emits dexto:stateChanged when LLM config is updated', () => {
        const eventSpy = vi.fn();
        eventBus.on('state:changed', eventSpy);

        const updatedConfig = LLMConfigSchema.parse({
            ...validatedConfig.llm,
            model: 'gpt-5-mini',
        });
        stateManager.updateLLM(updatedConfig);

        expect(eventSpy).toHaveBeenCalledWith({
            field: 'llm',
            oldValue: expect.objectContaining({ model: 'gpt-5' }),
            newValue: expect.objectContaining({ model: 'gpt-5-mini' }),
            sessionId: undefined,
        });
    });

    it('emits dexto:mcpServerAdded when adding a new MCP server', () => {
        const eventSpy = vi.fn();
        eventBus.on('mcp:server-added', eventSpy);

        const newServerConfig = McpServerConfigSchema.parse({
            type: 'stdio' as const,
            command: 'new-server',
            args: [],
            env: {},
            timeout: 30000,
            connectionMode: 'lenient' as const,
        });

        stateManager.setMcpServer('new-server', newServerConfig);

        expect(eventSpy).toHaveBeenCalledWith({
            serverName: 'new-server',
            config: newServerConfig,
        });
    });

    it('emits dexto:mcpServerRemoved when removing an MCP server', () => {
        const eventSpy = vi.fn();
        eventBus.on('mcp:server-removed', eventSpy);

        stateManager.removeMcpServer('test');

        expect(eventSpy).toHaveBeenCalledWith({
            serverName: 'test',
        });
    });

    it('emits dexto:sessionOverrideSet when setting session overrides', () => {
        const eventSpy = vi.fn();
        eventBus.on('session:override-set', eventSpy);

        const sessionConfig = LLMConfigSchema.parse({
            ...validatedConfig.llm,
            model: 'gpt-5',
        });
        stateManager.updateLLM(sessionConfig, 'session-123');

        expect(eventSpy).toHaveBeenCalledWith({
            sessionId: 'session-123',
            override: expect.objectContaining({
                llm: expect.objectContaining({ model: 'gpt-5' }),
            }),
        });
    });

    it('emits dexto:sessionOverrideCleared when clearing session overrides', () => {
        const eventSpy = vi.fn();
        eventBus.on('session:override-cleared', eventSpy);

        // First set an override
        const sessionConfig = LLMConfigSchema.parse({
            ...validatedConfig.llm,
            model: 'gpt-5',
        });
        stateManager.updateLLM(sessionConfig, 'session-123');

        // Then clear it
        stateManager.clearSessionOverride('session-123');

        expect(eventSpy).toHaveBeenCalledWith({
            sessionId: 'session-123',
        });
    });

    it('emits dexto:stateReset when resetting to baseline', () => {
        const eventSpy = vi.fn();
        eventBus.on('state:reset', eventSpy);

        stateManager.resetToBaseline();

        expect(eventSpy).toHaveBeenCalledWith({
            toConfig: validatedConfig,
        });
    });

    it('emits dexto:stateExported when exporting state as config', () => {
        const eventSpy = vi.fn();
        eventBus.on('state:exported', eventSpy);

        const exported = stateManager.exportAsConfig();

        expect(eventSpy).toHaveBeenCalledWith({
            config: exported,
        });
    });
});
