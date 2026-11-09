import { describe, expect, it } from 'vitest';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
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

    it('does not throw for a message or context that cannot be redacted', () => {
        const { logger, entries } = createLogger();
        const { proxy, revoke } = Proxy.revocable({ apiKey: 'abc123' }, {});
        revoke();
        const getter = {
            get boom(): string {
                throw new Error('boom');
            },
            apiKey: 'abc123',
        };

        expect(() => {
            logger.info(new Error('failed apiKey=abc123') as unknown as string);
            logger.info(undefined as unknown as string);
            logger.info(7 as unknown as string);
            logger.info('revoked', { proxy });
            logger.info('getter', getter);
            logger.info('hostile', {
                toString() {
                    throw new Error('no text');
                },
            });
        }).not.toThrow();

        expect(entries).toHaveLength(6);
        expect(entries[0]?.message).toBe('Error: failed apiKey=[REDACTED]');
        expect(entries[1]?.message).toBe('undefined');
        expect(entries[2]?.message).toBe('7');
        expect(entries[3]?.context).toEqual({ redacted: '[unredactable log data]' });
        expect(entries[4]?.context).toEqual({ redacted: '[unredactable log data]' });
        expect(JSON.stringify(entries)).not.toContain('abc123');
    });

    it('truncates context nested past the depth limit', () => {
        const { logger, entries } = createLogger();
        let deep: Record<string, unknown> = { leaf: 'x' };
        for (let i = 0; i < 6000; i++) deep = { next: deep };

        logger.info('deep', deep);

        expect(JSON.stringify(entries[0]?.context)).toContain('[Truncated]');
    });

    it('keeps the fields of a DextoRuntimeError and of a Node error with a code', () => {
        const { logger, entries } = createLogger();
        const runtimeError = new DextoRuntimeError(
            'mcp_connection_failed',
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            'Could not connect to the server',
            { server: 'files', headers: { Authorization: 'Bearer abc123' } },
            'Check the server URL'
        );
        const nodeError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:80'), {
            code: 'ECONNREFUSED',
            errno: -111,
            syscall: 'connect',
        });

        logger.error('failed', { error: runtimeError, cause: nodeError });

        expect(entries[0]?.context).toMatchObject({
            error: {
                name: 'DextoRuntimeError',
                message: 'Could not connect to the server',
                code: 'mcp_connection_failed',
                scope: 'mcp',
                type: 'third_party',
                recovery: 'Check the server URL',
                context: { server: 'files', headers: { Authorization: '[REDACTED]' } },
            },
            cause: { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' },
        });
        expect(JSON.stringify(entries)).not.toContain('abc123');
    });

    it('masks connection URL passwords in the message and the context', () => {
        const { logger, entries } = createLogger();

        logger.error('connect to postgres://app:pw1234@db.example.com:5432/shop failed', {
            DATABASE_URL: 'postgres://app:pw1234@db.example.com:5432/shop',
        });

        expect(entries[0]?.message).toBe(
            'connect to postgres://app:[REDACTED]@db.example.com:5432/shop failed'
        );
        expect(entries[0]?.context).toEqual({
            DATABASE_URL: 'postgres://app:[REDACTED]@db.example.com:5432/shop',
        });
    });
});
