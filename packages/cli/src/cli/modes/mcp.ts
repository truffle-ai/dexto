import { createAgentCard } from '@dexto/core';
import { safeExit } from '../../analytics/wrapper.js';
import type { MainModeContext } from './context.js';

export async function runMcpMode(context: MainModeContext): Promise<void> {
    const { agent } = context;

    const agentCardConfig = agent.config.agentCard || {
        name: 'dexto',
        version: '1.0.0',
    };

    try {
        const agentCardData = createAgentCard(
            {
                defaultName: agentCardConfig.name ?? 'dexto',
                defaultVersion: agentCardConfig.version ?? '1.0.0',
                defaultBaseUrl: 'stdio://local-dexto',
            },
            agentCardConfig
        );
        const { createMcpTransport, initializeMcpServer } = await import('@dexto/server');
        const mcpTransport = await createMcpTransport('stdio');
        await initializeMcpServer(agent, agentCardData, mcpTransport);
    } catch (err) {
        process.stderr.write(`MCP server startup failed: ${err}\n`);
        safeExit('main', 1, 'mcp-startup-failed');
    }
}
