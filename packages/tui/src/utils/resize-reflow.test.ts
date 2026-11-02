import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { keepScrollbackOnResize, reflowedRows, shrinkRepair } from './resize-reflow.js';

const ESC = '\u001B[';

describe('reflowedRows', () => {
    it('counts the rows a frame takes once the terminal rewraps it', () => {
        // "a" * 100 at 40 columns takes 3 rows; an empty line still takes 1.
        expect(reflowedRows(`${'a'.repeat(100)}\n\nbb\n`, 40)).toBe(3 + 1 + 1 + 1);
    });

    it('ignores colour codes when measuring', () => {
        expect(reflowedRows(`${ESC}31m${'a'.repeat(40)}${ESC}39m\n`, 40)).toBe(1 + 1);
    });
});

describe('shrinkRepair', () => {
    it('does nothing when no line wraps', () => {
        expect(shrinkRepair('short\nlines\n', 40)).toBe('');
    });

    it('erases the rewrapped frame and leaves the cursor where the next erase expects it', () => {
        // 2 lines + the trailing newline: Ink will erase 3 rows. Rewrapped, it takes 4.
        const repair = shrinkRepair(`${'a'.repeat(60)}\nb\n`, 40);
        expect(repair).toBe(`${ESC}2K${ESC}1A`.repeat(3) + `${ESC}2K${ESC}G` + `${ESC}2B`);
    });
});

class FakeStdout extends EventEmitter {
    columns = 80;
    rows = 24;
    isTTY = true;
    written: string[] = [];
    write(chunk: string): boolean {
        this.written.push(chunk);
        return true;
    }
}

describe('keepScrollbackOnResize', () => {
    it('remembers the last frame Ink wrote and repairs it before Ink redraws', () => {
        const real = new FakeStdout();
        const order: string[] = [];
        const kept = keepScrollbackOnResize(real as unknown as NodeJS.WriteStream);
        const stdout = kept.stdout as unknown as FakeStdout;
        stdout.on('resize', () => order.push('ink'));

        stdout.write(`${ESC}2K${ESC}G${'x'.repeat(70)}\nok\n`);
        real.written = [];
        real.columns = 40;
        real.emit('resize');

        expect(real.written).toHaveLength(1);
        expect(real.written[0]).toContain(`${ESC}2K`);
        expect(order).toEqual(['ink']);
        kept.dispose();
    });

    it('leaves a growing terminal alone', () => {
        const real = new FakeStdout();
        const kept = keepScrollbackOnResize(real as unknown as NodeJS.WriteStream);
        kept.stdout.write(`${'x'.repeat(70)}\n`);
        real.written = [];
        real.columns = 120;
        real.emit('resize');
        expect(real.written).toEqual([]);
        kept.dispose();
    });

    it('passes everything else through to the real stream', () => {
        const real = new FakeStdout();
        const kept = keepScrollbackOnResize(real as unknown as NodeJS.WriteStream);
        expect(kept.stdout.columns).toBe(80);
        expect(kept.stdout.isTTY).toBe(true);
        kept.dispose();
    });
});
