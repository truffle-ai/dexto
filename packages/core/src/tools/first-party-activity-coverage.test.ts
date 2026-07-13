/** Enforces transcript activity metadata on first-party defineTool declarations. */
import { readFileSync, readdirSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIRST_PARTY_TOOL_ROOTS = [
    'packages/agent-management/src/tool-factories',
    'packages/orchestration/src/tools',
    'packages/tools-builtins/src',
    'packages/tools-filesystem/src',
    'packages/tools-lifecycle/src',
    'packages/tools-plan/src',
    'packages/tools-process/src',
    'packages/tools-scheduler/src',
    'packages/tools-todo/src',
];

describe('first-party tool activity coverage', () => {
    it('requires activity metadata on production defineTool declarations', () => {
        const missing = FIRST_PARTY_TOOL_ROOTS.flatMap((relativeRoot) =>
            sourceFiles(join(REPOSITORY_ROOT, relativeRoot)).flatMap(findMissingActivity)
        );

        expect(missing).toEqual([]);
    });
});

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (extname(entry.name) !== '.ts' || entry.name.endsWith('.test.ts')) return [];
        return [path];
    });
}

function findMissingActivity(path: string): string[] {
    const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const missing: string[] = [];

    function visit(node: ts.Node): void {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'defineTool'
        ) {
            const definition = node.arguments.at(0);
            if (definition && ts.isObjectLiteralExpression(definition)) {
                const presentation = objectProperty(definition, 'presentation');
                const hasActivity =
                    presentation !== undefined &&
                    ts.isObjectLiteralExpression(presentation) &&
                    objectProperty(presentation, 'activity') !== undefined;
                if (!hasActivity) {
                    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                    missing.push(`${path.slice(REPOSITORY_ROOT.length + 1)}:${line}`);
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(source);
    return missing;
}

function objectProperty(
    object: ts.ObjectLiteralExpression,
    name: string
): ts.Expression | undefined {
    const property = object.properties.find(
        (candidate): candidate is ts.PropertyAssignment =>
            ts.isPropertyAssignment(candidate) &&
            ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
                (ts.isStringLiteral(candidate.name) && candidate.name.text === name))
    );
    return property?.initializer;
}
