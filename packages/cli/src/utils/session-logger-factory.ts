import path from 'node:path';
import {
    DextoLogComponent,
    DextoLogger,
    FileTransport,
    type SessionLoggerFactory,
} from '@dexto/core';
import { getDextoPath } from '@dexto/agent-management';

export function createFileSessionLoggerFactory(): SessionLoggerFactory {
    return ({ baseLogger, agentId, sessionId }) => {
        // Sanitize sessionId to prevent path traversal attacks
        // Allow only alphanumeric, dots, hyphens, and underscores
        const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
        const logFilePath = getDextoPath('logs', path.join(agentId, `${safeSessionId}.log`));

        // Standalone per-session file logger.
        return new DextoLogger({
            level: baseLogger.getLevel(),
            agentId,
            sessionId,
            component: DextoLogComponent.SESSION,
            transports: [new FileTransport({ path: logFilePath })],
        });
    };
}
