import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve repo root from CLI scripts directory: packages/cli/scripts -> repo root
const repoRoot = path.resolve(__dirname, '../../..');
const srcPath = path.join(repoRoot, 'README.md');

// Destination is the CLI package README next to this scripts directory
const cliDir = path.resolve(__dirname, '..');
const destPath = path.join(cliDir, 'README.md');

const GH_BASE = 'https://github.com/truffle-ai/dexto';
const GH_BLOB_HEAD = `${GH_BASE}/blob/HEAD`;
const GH_TREE_HEAD = `${GH_BASE}/tree/HEAD`;

function transform(content: string): string {
    // Change top-level H1
    content = content.replace(/^#\s+[^\n]+/, '# Dexto CLI');

    // Fix relative links to repo paths so they render on npm
    content = content
        // agents directory
        .replace(/\]\(agents\/\)/g, `](${GH_TREE_HEAD}/agents/)`)
        .replace(/\]\(agents\)/g, `](${GH_TREE_HEAD}/agents)`) // fallback
        // discord/telegram setup docs
        .replace(
            /\]\(packages\/cli\/src\/discord\/README\.md\)/g,
            `](${GH_BLOB_HEAD}/packages/cli/src/discord/README.md)`
        )
        .replace(
            /\]\(packages\/cli\/src\/telegram\/README\.md\)/g,
            `](${GH_BLOB_HEAD}/packages/cli/src/telegram/README.md)`
        )
        // contributor guide & license
        .replace(/\]\(\.\/CONTRIBUTING\.md\)/g, `](${GH_BLOB_HEAD}/CONTRIBUTING.md)`)
        .replace(/\]\(LICENSE\)/g, `](${GH_BLOB_HEAD}/LICENSE)`);

    // Fix relative image to assets folder
    content = content.replace(
        /<img\s+src=\"assets\/email_slack_demo\.gif\"/g,
        `<img src=\"${GH_BLOB_HEAD}/assets/email_slack_demo.gif?raw=1\"`
    );

    return content;
}

function main(): void {
    const raw = fs.readFileSync(srcPath, 'utf8');
    const out = transform(raw);
    fs.writeFileSync(destPath, out);
    console.log(
        `Synced CLI README from ${path.relative(repoRoot, srcPath)} -> ${path.relative(repoRoot, destPath)}`
    );
}

main();
