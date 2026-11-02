import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Colours go through tone(role) so the palette changes in one place. This guard keeps raw
// colours from coming back into the TUI while its screens are rebuilt.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const NAMES =
    'black|red|green|yellow|blue|magenta|cyan|white|gray|grey|' +
    'blackBright|redBright|greenBright|yellowBright|blueBright|magentaBright|cyanBright|whiteBright';
// color="cyan", borderColor="#224488", valueColor='green'
const RAW_PROP = new RegExp(`\\b\\w*[cC]olor=(["'])(${NAMES}|#[0-9a-fA-F]{3,8})\\1`);
// 'cyan' or "#224488" as a value anywhere else (ternaries, maps, defaults)
const RAW_VALUE = new RegExp(`(["'])(${NAMES}|#[0-9a-fA-F]{6})\\1`);
// Where a colour name is a key, not a value: MarkdownText maps names to chalk.
const ALLOWED_LINE = /^\s*case (["'])\w+\1:/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'signal' ? [] : sourceFiles(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

describe('TUI colours', () => {
    it('come from tone(role), not raw colour names or hex', () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            readFileSync(file, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    if (ALLOWED_LINE.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
                    if (RAW_PROP.test(line) || RAW_VALUE.test(line.replace(/tone\('\w+'\)/g, ''))) {
                        offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
                    }
                });
        }
        expect(offenders).toEqual([]);
    });
});
