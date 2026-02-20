import fs from 'node:fs';
import path from 'node:path';

const tsconfigPath = path.resolve(process.cwd(), process.argv[2] ?? 'tsconfig.json');

const candidates = new Set();

// TypeScript's default build info file name is based on the config file name.
// E.g. "tsconfig.json" -> "tsconfig.tsbuildinfo".
const configDir = path.dirname(tsconfigPath);
const configFile = path.basename(tsconfigPath);
const configBase = configFile.slice(0, Math.max(0, configFile.lastIndexOf('.'))) || configFile;
candidates.add(path.join(configDir, `${configBase}.tsbuildinfo`));

try {
    const configText = fs.readFileSync(tsconfigPath, 'utf8');
    const configJson = JSON.parse(configText);
    const tsBuildInfoFile = configJson?.compilerOptions?.tsBuildInfoFile;
    if (typeof tsBuildInfoFile === 'string' && tsBuildInfoFile.trim()) {
        candidates.add(path.resolve(configDir, tsBuildInfoFile));
    }
} catch {
    // Ignore parse errors; fall back to the default candidate.
}

for (const candidate of candidates) {
    fs.rmSync(candidate, { force: true });
}
