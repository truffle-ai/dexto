// Read-only registry fixture: unpublished beta tarballs locally, everything else from npm.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const packages = new Map();
for (const tarball of process.argv.slice(2)) {
    const pkg = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json']));
    packages.set(pkg.name, { pkg, tarball });
}
createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1));
    if (name.startsWith('tarballs/')) {
        const entry = [...packages.values()].find(
            ({ tarball }) => basename(tarball) === name.slice('tarballs/'.length)
        );
        if (!entry) {
            res.writeHead(404).end();
            return;
        }
        createReadStream(entry.tarball).pipe(res);
        return;
    }
    const entry = packages.get(name);
    if (!entry) {
        res.writeHead(302, { location: `https://registry.npmjs.org/${name}` }).end();
        return;
    }
    const { pkg, tarball } = entry;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
        name,
        'dist-tags': { next: pkg.version },
        versions: {
            [pkg.version]: {
                ...pkg,
                dist: { tarball: `http://127.0.0.1:4873/tarballs/${basename(tarball)}` },
            },
        },
    }));
}).listen(4873, '127.0.0.1', () => console.log('registry ready'));
