import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import stripAnsi from 'strip-ansi';
import { afterEach, expect, it, vi } from 'vitest';
import { Header } from './Header.js';
import { getCaps, setCaps } from '../../signal/caps.js';

const size = vi.hoisted(() => ({ columns: 80 }));
vi.mock('../../hooks/useTerminalSize.js', () => ({
    useTerminalSize: () => ({ ...size, rows: 40 }),
}));
const saved = getCaps();
afterEach(() => {
    setCaps(saved);
    vi.unstubAllEnvs();
});
for (const columns of [120, 80, 32]) {
    it(`renders the header at ${columns} columns`, () => {
        expect(frame(columns, false)).toMatchSnapshot();
    });
}
it('renders without colour', () => {
    expect(frame(80, true)).toMatchSnapshot();
});
it('uses plain text without UTF-8 or with a dumb terminal', () => {
    expect(frame(80, true, 'ascii')).toContain('Dexto');
    expect(frame(80, true, 'dumb')).toContain('Dexto');
});
it('omits the logo for pipes and CI', () => {
    expect(frame(80, true, 'pipe')).not.toContain('Dexto');
    expect(frame(80, true, 'ci')).not.toContain('Dexto');
});
function frame(columns: number, noColor: boolean, mode = 'normal'): string {
    size.columns = columns;
    vi.stubEnv('CI', mode === 'ci' ? 'true' : '');
    vi.stubEnv('TERM', mode === 'dumb' ? 'dumb' : 'xterm');
    setCaps({
        ...saved,
        tty: mode !== 'pipe',
        glyphs: mode === 'ascii' ? 'ascii' : 'unicode',
        logo: 'quadrant',
        color: noColor ? 'none' : '256',
    });
    const stdout = Object.assign(new PassThrough(), { columns, rows: 40, isTTY: false });
    let output = '';
    stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    const view = render(
        React.createElement(Header, {
            modelName: 'test',
            hasActiveSession: false,
            startupInfo: {
                connectedServers: { count: 0, names: [] },
                failedConnections: [],
                toolCount: 0,
                logFile: null,
            },
        }),
        {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        }
    );
    const result = stripAnsi(output);
    view.unmount();
    stdout.destroy();
    return result;
}
