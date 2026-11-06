import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every module `entry` loads, following static imports (not `import type`) within this folder. */
function staticImports(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        const source = readFileSync(path.join(HERE, file), 'utf8');
        for (const match of source.matchAll(
            /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gmu
        )) {
            const target = match[1] ?? '';
            if (target.startsWith('./'))
                visit(target.replace(/^\.\//u, '').replace(/\.js$/u, '.ts'));
            else seen.add(target);
        }
    };
    visit(entry);
    return seen;
}

describe('@dexto/tui/signal-text', () => {
    it('loads neither React nor Ink, so a command can draw without them', () => {
        const loaded = [...staticImports('text.ts')];
        expect(loaded).toContain('caps.ts');
        expect(loaded).toContain('tone.ts');
        expect(loaded.filter((each) => /^(react|ink)(\/|$)/u.test(each))).toEqual([]);
    });
});
