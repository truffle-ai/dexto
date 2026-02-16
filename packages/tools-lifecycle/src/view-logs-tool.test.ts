import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createViewLogsTool } from './view-logs-tool.js';
import type { ToolExecutionContext } from '@dexto/core';

function createTestContext(logFilePath: string | null): ToolExecutionContext {
    return {
        logger: {
            debug: () => {},
            silly: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            trackException: () => {},
            createChild: () => createTestContext(logFilePath).logger,
            setLevel: () => {},
            getLevel: () => 'info',
            getLogFilePath: () => logFilePath,
            destroy: async () => {},
        },
        services: undefined,
        storage: undefined,
        agent: undefined,
    };
}

function makeJsonLogLine(entry: {
    level: 'debug' | 'info' | 'warn' | 'error' | 'silly';
    message: string;
    component: string;
    timestamp?: string;
    agentId?: string;
    sessionId?: string;
    toolCallId?: string;
    context?: Record<string, unknown>;
}): string {
    return JSON.stringify({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp ?? new Date('2026-01-01T00:00:00.000Z').toISOString(),
        component: entry.component,
        ...(entry.agentId !== undefined && { agentId: entry.agentId }),
        ...(entry.sessionId !== undefined && { sessionId: entry.sessionId }),
        ...(entry.toolCallId !== undefined && { toolCallId: entry.toolCallId }),
        ...(entry.context !== undefined && { context: entry.context }),
    });
}

describe('createViewLogsTool', () => {
    it('should return message when no log file is configured', async () => {
        const tool = createViewLogsTool({ maxLogLines: 50, maxLogBytes: 10_000 });

        const result = await tool.execute({ lines: 10 }, createTestContext(null));

        expect(result).toEqual({
            logFilePath: null,
            lines: 0,
            content: '',
            message: 'No log file is configured for this session.',
        });
    });

    it('should tail the last N lines', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-view-logs-'));
        const filePath = path.join(dir, 'session.log');

        const content = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
        await fs.writeFile(filePath, content, 'utf8');

        const tool = createViewLogsTool({ maxLogLines: 50, maxLogBytes: 10_000 });
        const result = (await tool.execute({ lines: 2 }, createTestContext(filePath))) as {
            logFilePath: string;
            lines: number;
            content: string;
        };

        expect(result.logFilePath).toBe(filePath);
        expect(result.lines).toBe(2);
        expect(result.content).toBe(['l4', 'l5'].join('\n'));
    });

    it('should cap lines to maxLogLines', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-view-logs-'));
        const filePath = path.join(dir, 'session.log');

        const content = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
        await fs.writeFile(filePath, content, 'utf8');

        const tool = createViewLogsTool({ maxLogLines: 3, maxLogBytes: 10_000 });
        const result = (await tool.execute({ lines: 9 }, createTestContext(filePath))) as {
            lines: number;
            content: string;
        };

        expect(result.lines).toBe(3);
        expect(result.content).toBe(['l8', 'l9', 'l10'].join('\n'));
    });

    it('should filter JSON log entries by query and return parsed entries', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-view-logs-'));
        const filePath = path.join(dir, 'session.log');

        const content = [
            makeJsonLogLine({
                level: 'info',
                message: 'starting up',
                component: 'cli',
                context: { foo: 'bar' },
            }),
            makeJsonLogLine({
                level: 'error',
                message: 'failed to connect',
                component: 'mcp',
                context: { error: 'timeout', host: 'localhost' },
            }),
            makeJsonLogLine({
                level: 'info',
                message: 'connected',
                component: 'mcp',
                context: { host: 'localhost' },
            }),
        ].join('\n');
        await fs.writeFile(filePath, content, 'utf8');

        const tool = createViewLogsTool({ maxLogLines: 50, maxLogBytes: 10_000 });
        const result = (await tool.execute(
            { lines: 50, query: 'connect', includeContext: true },
            createTestContext(filePath)
        )) as {
            lines: number;
            content: string;
            entries: Array<{
                level: string;
                message: string;
                component: string;
                context?: unknown;
            }>;
        };

        expect(result.lines).toBe(2);
        expect(result.entries).toHaveLength(2);
        expect(result.entries[0]?.message).toBe('failed to connect');
        expect(result.entries[1]?.message).toBe('connected');
        expect(result.content).toContain('failed to connect');
        expect(result.content).toContain('connected');
    });

    it('should filter JSON log entries by level and omit context by default', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-view-logs-'));
        const filePath = path.join(dir, 'session.log');

        const content = [
            makeJsonLogLine({ level: 'info', message: 'ok', component: 'agent' }),
            makeJsonLogLine({
                level: 'error',
                message: 'boom',
                component: 'agent',
                context: { secret: 'nope' },
            }),
        ].join('\n');
        await fs.writeFile(filePath, content, 'utf8');

        const tool = createViewLogsTool({ maxLogLines: 50, maxLogBytes: 10_000 });
        const result = (await tool.execute(
            { lines: 10, level: 'error' },
            createTestContext(filePath)
        )) as {
            entries: Array<{ level: string; message: string; context?: unknown }>;
        };

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]?.level).toBe('error');
        expect(result.entries[0]?.message).toBe('boom');
        expect(result.entries[0]).not.toHaveProperty('context');
    });
});
