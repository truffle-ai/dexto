import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findDextoProjectRoot, getExecutionContext } from './execution-context.js';

describe('core execution context detection', () => {
    let tempDir: string | null = null;

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    function createTempDirStructure(
        structure: Record<string, string | Record<string, unknown>>
    ): string {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexto-core-context-'));

        for (const [relativePath, content] of Object.entries(structure)) {
            const absolutePath = path.join(tempDir, relativePath);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(
                absolutePath,
                typeof content === 'string' ? content : JSON.stringify(content, null, 2)
            );
        }

        return tempDir;
    }

    it('treats AGENTS.md plus authored workspace directories as a dexto-project marker', () => {
        const workspaceRoot = createTempDirStructure({
            'AGENTS.md': '# Dexto Workspace',
            'skills/.gitkeep': '',
        });

        expect(getExecutionContext(workspaceRoot)).toBe('dexto-project');
        expect(findDextoProjectRoot(path.join(workspaceRoot, 'nested'))).toBe(workspaceRoot);
    });

    it('does not treat AGENTS.md alone as a dexto-project marker', () => {
        const workspaceRoot = createTempDirStructure({
            'AGENTS.md': '# Generic instructions',
        });

        expect(getExecutionContext(workspaceRoot)).toBe('global-cli');
        expect(findDextoProjectRoot(workspaceRoot)).toBeNull();
    });

    it('does not treat generic AGENTS.md plus authored directories as a dexto-project marker', () => {
        const workspaceRoot = createTempDirStructure({
            'AGENTS.md': '# Generic instructions',
            'skills/.gitkeep': '',
        });

        expect(getExecutionContext(workspaceRoot)).toBe('global-cli');
        expect(findDextoProjectRoot(workspaceRoot)).toBeNull();
    });

    it('does not treat arbitrary agent YAML under agents/ as a dexto-project marker', () => {
        const workspaceRoot = createTempDirStructure({
            'agents/reviewer/reviewer.yml': 'agentCard:\n  name: Reviewer\n',
        });

        expect(getExecutionContext(workspaceRoot)).toBe('global-cli');
        expect(findDextoProjectRoot(workspaceRoot)).toBeNull();
    });

    it('does not treat internal @dexto packages as dexto-project even with workspace markers', () => {
        const workspaceRoot = createTempDirStructure({
            'package.json': {
                name: '@dexto/webui',
                dependencies: { '@dexto/core': 'workspace:*' },
            },
            'AGENTS.md': '# Dexto Workspace',
            'skills/.gitkeep': '',
        });

        expect(getExecutionContext(workspaceRoot)).toBe('global-cli');
        expect(findDextoProjectRoot(workspaceRoot)).toBeNull();
    });
});
