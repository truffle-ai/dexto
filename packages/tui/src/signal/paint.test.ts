import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCaps, setCaps, type Caps } from './caps.js';
import { markdownChalk, paint } from './paint.js';

describe('paint', () => {
    let savedCaps: Caps;
    let savedLevel: typeof chalk.level;
    beforeEach(() => {
        savedCaps = getCaps();
        savedLevel = chalk.level;
        chalk.level = 3;
    });
    afterEach(() => {
        setCaps(savedCaps);
        chalk.level = savedLevel;
    });

    const use = (next: Partial<Caps>) => setCaps({ ...getCaps(), ...next });

    it('draws the colour the TUI drew before on the legacy palette', () => {
        use({ palette: 'legacy' });
        expect(paint('dim')('x')).toBe(chalk.gray('x'));
        expect(paint('teal')('x')).toBe(chalk.cyan('x'));
        expect(paint('add')('x')).toBe(chalk.green('x'));
        expect(paint('amberDim')('x')).toBe(chalk.yellow('x'));
        expect(paint('fg')('x')).toBe(chalk.blue('x'));
        expect(paint('red')('x')).toBe(chalk.red('x'));
    });

    it('draws the role hex on the Signal palette, by theme', () => {
        use({ palette: 'signal', color: 'truecolor', theme: 'dark' });
        expect(paint('teal')('x')).toBe(chalk.hex('#4EC9B0')('x'));
        use({ theme: 'light' });
        expect(paint('teal')('x')).toBe(chalk.hex('#0B7A68')('x'));
    });

    it("uses the terminal's own colour on 16-colour terminals", () => {
        use({ palette: 'signal', color: '16' });
        expect(paint('cloud')('x')).toBe(chalk.magenta('x'));
    });

    it('leaves text alone where the role has no colour', () => {
        use({ palette: 'signal', color: 'none' });
        expect(paint('teal')('x')).toBe('x');
        use({ color: '16' });
        expect(paint('fg')('x')).toBe('x');
    });

    it('chains modifiers', () => {
        use({ palette: 'legacy' });
        expect(paint('teal').bold('x')).toBe(chalk.cyan.bold('x'));
    });
});

describe('markdownChalk', () => {
    let savedCaps: Caps;
    let savedLevel: typeof chalk.level;
    beforeEach(() => {
        savedCaps = getCaps();
        savedLevel = chalk.level;
        chalk.level = 3;
    });
    afterEach(() => {
        setCaps(savedCaps);
        chalk.level = savedLevel;
    });

    it('keeps its own mapping on the legacy palette', () => {
        setCaps({ ...getCaps(), palette: 'legacy' });
        expect(markdownChalk('yellow')('x')).toBe(chalk.rgb(255, 165, 0)('x'));
        expect(markdownChalk('magenta')('x')).toBe(chalk.green('x'));
        expect(markdownChalk('yellowBright')('x')).toBe(chalk.white('x'));
        expect(markdownChalk('#0E3B2E')('x')).toBe(chalk.hex('#0E3B2E')('x'));
        expect(markdownChalk('')('x')).toBe('x');
    });

    it('draws what the role asked for on the Signal palette', () => {
        setCaps({ ...getCaps(), palette: 'signal', color: '16' });
        expect(markdownChalk('magenta')('x')).toBe(chalk.magenta('x'));
        expect(markdownChalk('yellow')('x')).toBe(chalk.yellow('x'));
        expect(markdownChalk('#4EC9B0')('x')).toBe(chalk.hex('#4EC9B0')('x'));
        expect(markdownChalk('')('x')).toBe('x');
    });
});
