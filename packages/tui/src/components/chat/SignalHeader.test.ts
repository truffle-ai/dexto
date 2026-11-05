import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TERMINAL_NAMES, renderFrame } from '../../signal/harness.js';
import { wordmarkRowsFor } from '../../signal/text.js';
import { Header } from './Header.js';

const STARTUP = {
    connectedServers: { count: 2, names: ['github', 'linear'] },
    failedConnections: ['notion'],
    toolCount: 31,
    logFile: null,
    updateInfo: { current: '2.1.0', latest: '2.2.0', updateCommand: 'dexto upgrade' },
    needsAgentSync: false,
};

describe('wordmarkRowsFor', () => {
    it('sizes the wordmark to the terminal, and drops it when too narrow', () => {
        expect(wordmarkRowsFor(43, 30)).toBeNull();
        expect(wordmarkRowsFor(80, 30)).toBe(3);
        expect(wordmarkRowsFor(124, 30)).toBe(6);
        expect(wordmarkRowsFor(140, 39)).toBe(6);
        expect(wordmarkRowsFor(140, 40)).toBe(10);
    });
});

describe.each(TERMINAL_NAMES)('Signal header on %s', (terminal) => {
    it.each([80, 124])('at %i columns', (columns) => {
        process.stdout.columns = columns;
        process.env.DEXTO_CLI_VERSION = '2.1.0';
        expect(
            renderFrame(
                createElement(Header, {
                    modelName: 'anthropic/claude-sonnet-4-5',
                    sessionId: 'a1b2c3d4e5',
                    hasActiveSession: true,
                    startupInfo: STARTUP,
                }),
                { columns, terminal }
            )
        ).toMatchSnapshot();
    });
});
