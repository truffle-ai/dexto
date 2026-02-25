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

        const fileTransport = new FileTransport({ path: logFilePath });

        // TODO(logging): If we want sub-agents to write into the exact same session log file,
        // they must share the same FileTransport instance to avoid interleaved/corrupted JSON lines.
        // This likely requires passing a transport/logger handle into sub-agent spawn rather than
        // configuring file logging via plain config objects.

        // Prefer sharing the base logger's level reference so `/log` changes apply to the
        // session file logger immediately (interactive CLI base logger is usually silent).
        if (baseLogger instanceof DextoLogger) {
            return baseLogger.createScopedLogger({
                component: DextoLogComponent.SESSION,
                agentId,
                sessionId,
                transports: [fileTransport],
            });
        }

        // Fallback: standalone per-session file logger.
        return new DextoLogger({
            level: baseLogger.getLevel(),
            agentId,
            sessionId,
            component: DextoLogComponent.SESSION,
            transports: [fileTransport],
        });
    };
}
