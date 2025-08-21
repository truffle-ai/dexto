import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { walkUpDirectories } from './fs-walk.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

function createTempDir() {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-test-'));
}

describe('walkUpDirectories', () => {
    let tempDir: string;
    let nestedDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
        nestedDir = path.join(tempDir, 'nested', 'deep', 'directory');
        fs.mkdirSync(nestedDir, { recursive: true });

        // Create a marker file in tempDir
        fs.writeFileSync(path.join(tempDir, 'marker.txt'), 'found');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns null when no directories match the predicate', () => {
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'nonexistent.txt'))
        );
        expect(result).toBeNull();
    });

    it('finds directory by walking up the tree', () => {
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'marker.txt'))
        );
        expect(result).toBe(tempDir);
    });

    it('returns the immediate directory if it matches', () => {
        fs.writeFileSync(path.join(nestedDir, 'immediate.txt'), 'here');
        const result = walkUpDirectories(nestedDir, (dir) =>
            fs.existsSync(path.join(dir, 'immediate.txt'))
        );
        expect(result).toBe(nestedDir);
    });

    it('includes filesystem root in search', () => {
        // Test that the function evaluates the predicate for the root path
        const rootPath = path.parse(process.cwd()).root;

        // Use a predicate that only matches the root
        const result = walkUpDirectories(nestedDir, (dir) => dir === rootPath);

        // Should find the root path
        expect(result).toBe(rootPath);
    });
});
