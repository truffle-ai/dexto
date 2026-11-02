import { createElement, useEffect } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { KeypressProvider, useKeypressContext, type Key } from './KeypressContext.js';

function Recorder({ onKey }: { onKey: (key: Key) => void }) {
    const { subscribe, unsubscribe } = useKeypressContext();
    useEffect(() => {
        subscribe(onKey);
        return () => {
            unsubscribe(onKey);
        };
    }, [subscribe, unsubscribe, onKey]);
    return null;
}

function mount() {
    const stdin = Object.assign(new PassThrough(), {
        isTTY: true,
        isRaw: false,
        setRawMode(mode: boolean) {
            this.isRaw = mode;
            return this;
        },
        ref() {},
        unref() {},
    });
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: false });
    const keys: Key[] = [];
    const view = render(
        createElement(
            KeypressProvider,
            null,
            createElement(Recorder, { onKey: (k) => keys.push(k) })
        ),
        {
            stdin: stdin as unknown as NodeJS.ReadStream,
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        }
    );
    return {
        stdin,
        keys,
        done: () => {
            view.unmount();
            stdin.destroy();
            stdout.destroy();
        },
    };
}

describe('KeypressProvider', () => {
    it('drops a late terminal background reply instead of typing it', async () => {
        const { stdin, keys, done } = mount();
        try {
            await vi.waitFor(() => expect(stdin.isRaw).toBe(true));
            stdin.write('\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?62;22ca');
            await vi.waitFor(() => expect(keys.map((k) => k.sequence)).toEqual(['a']));
        } finally {
            done();
        }
    });
});
