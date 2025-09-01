import * as path from 'path';
import * as fs from 'fs';
import type { Plugin, LoadContext } from '@docusaurus/types';

interface MarkdownRoutePluginOptions {
    enabled?: boolean;
}

export default function markdownRoutePlugin(
    context: LoadContext,
    _options: MarkdownRoutePluginOptions = {}
): Plugin {
    // Consolidate context destructuring without stray diff markers
    const { siteDir, baseUrl = '/' } = context;
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const DOCS_PREFIX = `${normalizedBase}/docs/`;
    const API_PREFIX = `${normalizedBase}/api/`;
    // Helper function to find markdown file (try .md then .mdx)
    function findMarkdownFile(basePath: string): string | null {
        const candidates = [
            `${basePath}.md`,
            `${basePath}.mdx`,
            path.join(basePath, 'index.md'),
            path.join(basePath, 'index.mdx'),
            path.join(basePath, 'README.md'),
            path.join(basePath, 'README.mdx'),
        ];
        return candidates.find(p => fs.existsSync(p)) ?? null;
    }

    // Helper function to copy markdown files to build folder for production
    function copyMarkdownFiles(buildDir: string): void {
        // Copy docs markdown files
        const docsDir = path.join(siteDir, 'docs');
        const buildDocsDir = path.join(buildDir, 'docs');
        if (fs.existsSync(docsDir)) {
            copyDirectoryMarkdown(docsDir, buildDocsDir, 'docs');
        }

        // Copy api markdown files
        const apiDir = path.join(siteDir, 'api');
        const buildApiDir = path.join(buildDir, 'api');
        if (fs.existsSync(apiDir)) {
            copyDirectoryMarkdown(apiDir, buildApiDir, 'api');
        }
    }

    function copyDirectoryMarkdown(
        sourceDir: string,
        targetDir: string,
        prefix: string = ''
    ): void {
        if (!fs.existsSync(sourceDir)) return;

        // Create target directory
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const items = fs.readdirSync(sourceDir);

        for (const item of items) {
            const sourcePath = path.join(sourceDir, item);
            const targetPath = path.join(targetDir, item);
            const stat = fs.statSync(sourcePath);

            if (stat.isDirectory()) {
                // Recursively copy subdirectories
                copyDirectoryMarkdown(sourcePath, targetPath, prefix);
            } else if (item.endsWith('.md') || item.endsWith('.mdx')) {
                // Copy markdown files
                try {
                    fs.copyFileSync(sourcePath, targetPath);
                    console.log(
                        `✅ Copied ${prefix}/${path.relative(path.join(siteDir, prefix), sourcePath)} to static folder`
                    );
                } catch (error) {
                    console.error(`❌ Error copying ${sourcePath}:`, error);
                }
            }
        }
    }

    return {
        name: 'markdown-route-plugin',

        // Copy markdown files during build for production
        async postBuild({ outDir }) {
            console.log('📄 Copying markdown files to build folder for production...');
            copyMarkdownFiles(outDir);
        },

        configureWebpack(_config: any, isServer: boolean): any {
            // Only add devServer middleware for client-side development builds
            if (isServer || process.env.NODE_ENV === 'production') {
                return {};
            }

            return {
                devServer: {
                    setupMiddlewares: (middlewares: any, devServer: any) => {
                        if (!devServer) {
                            throw new Error('webpack-dev-server is not defined');
                        }

                        console.log('🔧 Setting up markdown route middleware for development');

                        // Add middleware at the beginning to intercept before other routes
                        middlewares.unshift({
                            name: 'markdown-route-middleware',
                            middleware: (req: any, res: any, next: any) => {
                                // Only handle .md requests
                                if (!req.path.endsWith('.md')) {
                                    return next();
                                }

                                const requestPath = req.path;
                                console.log(`📄 Markdown request: ${requestPath}`);

                                // Remove .md extension to get the original route
                                const originalPath = requestPath.replace(/\.md$/, '');

                                // Map the route to the actual markdown file
                                let filePath = null;

                                // Replace hard-coded docs/api blocks with unified, safe resolution
                                const docsRoot = path.join(siteDir, 'docs');
                                const apiRoot = path.join(siteDir, 'api');

                                const matchPrefix = (p: string, prefix: string) =>
                                  p.startsWith(prefix) ? p.slice(prefix.length) : null;

                                let relativePath = matchPrefix(originalPath, DOCS_PREFIX);
                                let root = docsRoot;
                                if (relativePath == null) {
                                  relativePath = matchPrefix(originalPath, API_PREFIX);
                                  root = apiRoot;
                                }

                                if (relativePath != null) {
                                  // Normalize and ensure the resolved path stays within root
                                  const resolvedBase = path.resolve(root, relativePath);
                                  const rootResolved = path.resolve(root);
                                  if (
                                    resolvedBase !== rootResolved &&
                                    !resolvedBase.startsWith(rootResolved + path.sep)
                                  ) {
                                    res.status(400).send('Invalid path');
                                    return;
                                  }
                                  filePath = findMarkdownFile(resolvedBase);
                                }

                                if (filePath) {
                                    try {
                                        const content = fs.readFileSync(filePath, 'utf8');
                                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                                        res.setHeader('Cache-Control', 'no-cache');
                                        res.send(content);
                                        console.log(
                                            `✅ Served markdown: ${path.relative(siteDir, filePath)}`
                                        );
                                    } catch (error) {
                                        console.error(
                                            `❌ Error reading markdown file ${filePath}:`,
                                            error
                                        );
                                        res.status(500).send('Error reading markdown file');
                                    }
                                } else {
                                    console.log(`❌ Markdown file not found for: ${originalPath}`);
                                    res.status(404).send('Markdown file not found');
                                }
                            },
                        });

                        return middlewares;
                    },
                },
            };
        },
    };
}
