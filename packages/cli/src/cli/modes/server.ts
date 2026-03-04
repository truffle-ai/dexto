import { getPort } from '../../utils/port-utils.js';
import type { MainModeContext } from './context.js';

export async function runServerMode(context: MainModeContext): Promise<void> {
    const { agent, opts, derivedAgentId, resolvedPath, getVersionCheckResult } = context;

    const { startHonoApiServer } = await import('../../api/server-hono.js');

    const agentCard = agent.config.agentCard ?? {};
    const defaultPort = (() => {
        if (!opts.port) {
            return 3001;
        }

        const rawPort = opts.port.trim();
        const parsedPort = Number(rawPort);
        if (
            !/^\d+$/.test(rawPort) ||
            !Number.isInteger(parsedPort) ||
            parsedPort <= 0 ||
            parsedPort > 65535
        ) {
            throw new Error(`Invalid --port value "${opts.port}". Use a port between 1 and 65535.`);
        }

        return parsedPort;
    })();
    const apiPort = getPort(process.env.PORT, defaultPort, 'PORT');
    const apiUrl = process.env.DEXTO_URL ?? `http://localhost:${apiPort}`;

    console.log('🌐 Starting server (REST APIs + SSE)...');
    await startHonoApiServer(agent, apiPort, agentCard, derivedAgentId, resolvedPath);
    console.log(`✅ Server running at ${apiUrl}`);
    console.log('Available endpoints:');
    console.log('  POST /api/message - Send async message');
    console.log('  POST /api/message-sync - Send sync message');
    console.log('  POST /api/reset - Reset conversation');
    console.log('  GET  /api/mcp/servers - List MCP servers');
    console.log('  SSE support available for real-time events');

    const serverUpdateInfo = await getVersionCheckResult();
    if (serverUpdateInfo) {
        const { displayUpdateNotification } = await import('../utils/version-check.js');
        displayUpdateNotification(serverUpdateInfo);
    }
}
