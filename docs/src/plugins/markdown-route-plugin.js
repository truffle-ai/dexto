const path = require('path');
const fs = require('fs');

module.exports = function markdownRoutePlugin(context, _options) {
    const { siteDir } = context;

    // Helper function to find markdown file (try .md then .mdx)
    function findMarkdownFile(basePath) {
        const mdPath = basePath + '.md';
        const mdxPath = basePath + '.mdx';

        if (fs.existsSync(mdPath)) {
            return mdPath;
        }
        if (fs.existsSync(mdxPath)) {
            return mdxPath;
        }
        return null;
    }

    // Helper function to copy markdown files to build folder for production
    function copyMarkdownFiles(buildDir) {
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

    function copyDirectoryMarkdown(sourceDir, targetDir, prefix = '') {
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

        configureWebpack(_config, isServer) {
            // Only add devServer middleware for client-side development builds
            if (isServer || process.env.NODE_ENV === 'production') {
                return {};
            }

            return {
                devServer: {
                    setupMiddlewares: (middlewares, devServer) => {
                        if (!devServer) {
                            throw new Error('webpack-dev-server is not defined');
                        }

                        console.log('🔧 Setting up markdown route middleware for development');

                        // Add middleware at the beginning to intercept before other routes
                        middlewares.unshift({
                            name: 'markdown-route-middleware',
                            middleware: (req, res, next) => {
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

                                if (originalPath.startsWith('/docs/')) {
                                    const relativePath = originalPath.replace('/docs/', '');
                                    const basePath = path.join(siteDir, 'docs', relativePath);
                                    filePath = findMarkdownFile(basePath);
                                } else if (originalPath.startsWith('/api/')) {
                                    const relativePath = originalPath.replace('/api/', '');
                                    const basePath = path.join(siteDir, 'api', relativePath);
                                    filePath = findMarkdownFile(basePath);
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
