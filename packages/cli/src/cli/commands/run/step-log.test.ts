import { describe, expect, it } from 'vitest';
import { chalkStderr } from 'chalk';
import { logLine, startLine, stepLine, stepLogEnabled } from './step-log.js';

chalkStderr.level = 0;

const AT = new Date(2026, 10, 2, 14, 2, 12);

describe('Signal step log', () => {
    it('writes a finished call as one fixed-column line', () => {
        const line = stepLine(
            {
                state: 'ok',
                verb: 'READ',
                target: 'src/a.ts',
                detail: '88 lines',
                time: '0.1s',
                cloud: false,
            },
            AT
        );
        expect(line).toBe(
            '14:02:12  read    src/a.ts                       88 lines          0.1s  ok'
        );
    });

    it('says a call failed', () => {
        const line = stepLine(
            { state: 'fail', verb: 'RUN', target: 'x', detail: 'exit 1', time: null, cloud: false },
            AT
        );
        expect(line.endsWith(' fail')).toBe(true);
    });

    it('opens with the model and chat, and labels other lines', () => {
        expect(startLine('anthropic/sonnet', 's_1', AT)).toBe(
            '14:02:12  start   anthropic/sonnet · local · chat s_1'
        );
        expect(logLine('done', '12 tokens', { error: false, at: AT })).toBe(
            '14:02:12  done    12 tokens'
        );
    });

    it('stays off unless the Signal palette is asked for', () => {
        const saved = process.env.DEXTO_PALETTE;
        delete process.env.DEXTO_PALETTE;
        expect(stepLogEnabled()).toBe(false);
        process.env.DEXTO_PALETTE = 'signal';
        expect(stepLogEnabled()).toBe(true);
        if (saved === undefined) delete process.env.DEXTO_PALETTE;
        else process.env.DEXTO_PALETTE = saved;
    });
});
