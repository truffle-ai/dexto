import { describe, expect, it } from 'vitest';
import { DextoLogger } from './dexto-logger.js';
import { DextoLogComponent, type LogEntry } from './types.js';

function createLogger() {
    const entries: LogEntry[] = [];
    const logger = new DextoLogger({
        level: 'silly',
        component: DextoLogComponent.AGENT,
        agentId: 'test-agent',
        transports: [{ write: (entry) => void entries.push(entry) }],
    });
    return { logger, entries };
}

describe('DextoLogger redaction', () => {
    it('masks quoted and unquoted secret values in the message', () => {
        const { logger, entries } = createLogger();

        logger.info('unquoted apiKey=abc123 and quoted {"password":"hunter 2"}');

        expect(entries[0]?.message).toBe(
            'unquoted apiKey=[REDACTED] and quoted {"password":"[REDACTED]"}'
        );
    });

    it('masks header and env maps and secret-named keys in the context', () => {
        const { logger, entries } = createLogger();

        logger.warn('connecting', {
            server: 'remote',
            headers: { 'X-Custom-Auth': 'abc123' },
            env: { DB_URL: 'postgres://user:pw@host/db' },
            authorization: 'Bearer abc123',
            client_secret: 'abc123',
            attempts: 2,
        });

        expect(entries[0]?.context).toEqual({
            server: 'remote',
            headers: { 'X-Custom-Auth': '[REDACTED]' },
            env: { DB_URL: '[REDACTED]' },
            authorization: '[REDACTED]',
            client_secret: '[REDACTED]',
            attempts: 2,
        });
    });

    it('masks every level and the exception path', () => {
        const { logger, entries } = createLogger();

        logger.silly('token=abc123');
        logger.debug('token=abc123');
        logger.error('token=abc123');
        logger.trackException(new Error('failed with token=abc123'));

        expect(entries).toHaveLength(4);
        expect(JSON.stringify(entries)).not.toContain('abc123');
    });

    it('keeps the entry fields it does not mask', () => {
        const { logger, entries } = createLogger();

        logger.info('started');

        expect(entries[0]).toMatchObject({
            level: 'info',
            message: 'started',
            component: DextoLogComponent.AGENT,
            agentId: 'test-agent',
        });
        expect(entries[0]?.context).toBeUndefined();
    });

    it('masks through child loggers', () => {
        const { logger, entries } = createLogger();

        logger.createChild(DextoLogComponent.MCP).info('password=abc123');

        expect(entries[0]?.message).toBe('password=[REDACTED]');
    });
});
