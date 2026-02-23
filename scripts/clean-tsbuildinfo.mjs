import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const tsconfigPath = path.resolve(process.cwd(), process.argv[2] ?? 'tsconfig.json');

const candidates = new Set();

function stripJsonComments(text) {
    let result = '';
    let inString = false;
    let stringDelimiter = '';
    let isEscaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const nextChar = text[index + 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
                result += char;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            result += char;
            if (isEscaped) {
                isEscaped = false;
                continue;
            }

            if (char === '\\') {
                isEscaped = true;
                continue;
            }

            if (char === stringDelimiter) {
                inString = false;
                stringDelimiter = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            stringDelimiter = char;
            result += char;
            continue;
        }

        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        result += char;
    }

    return result;
}

// TypeScript's default build info file name is based on the config file name.
// E.g. "tsconfig.json" -> "tsconfig.tsbuildinfo".
const configDir = path.dirname(tsconfigPath);
const configFile = path.basename(tsconfigPath);
const configBase = configFile.slice(0, Math.max(0, configFile.lastIndexOf('.'))) || configFile;
candidates.add(path.join(configDir, `${configBase}.tsbuildinfo`));

try {
    const configText = fs.readFileSync(tsconfigPath, 'utf8');
    const configJson = JSON.parse(stripJsonComments(configText));
    const tsBuildInfoFile = configJson?.compilerOptions?.tsBuildInfoFile;
    if (typeof tsBuildInfoFile === 'string' && tsBuildInfoFile.trim()) {
        candidates.add(path.resolve(configDir, tsBuildInfoFile));
    }

    const outDir = configJson?.compilerOptions?.outDir;
    if (
        typeof outDir === 'string' &&
        outDir.trim() &&
        !(typeof tsBuildInfoFile === 'string' && tsBuildInfoFile.trim())
    ) {
        candidates.add(path.resolve(configDir, outDir, `${configBase}.tsbuildinfo`));
    }
} catch {
    // Ignore parse errors; fall back to the default candidate.
}

for (const candidate of candidates) {
    fs.rmSync(candidate, { force: true });
}
