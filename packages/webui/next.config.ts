import type { NextConfig } from 'next';
import path from 'path';

const isStandalone = process.env.BUILD_STANDALONE === 'true';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // Use standalone output for production builds
    output: isStandalone ? 'standalone' : undefined,
    // Ensure Next.js computes paths relative to the repo root (not the user home)
    // This stabilizes the emitted standalone directory structure and prevents
    // paths like "+/Projects/dexto/..." from being embedded in output.
    outputFileTracingRoot: path.resolve(__dirname, '..', '..', '..'),
    experimental: {
        // Allow importing TS/JS from outside the Next.js app directory
        externalDir: true,
    },
    // Disable ESLint during build to avoid config issues
    eslint: {
        ignoreDuringBuilds: true,
    },
    // Ensure webpack can resolve ESM-style .js imports to .ts sources
    webpack: (config) => {
        config.resolve = config.resolve || {};
        // Use package imports (@dexto/core, @dexto/client-sdk)
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
        } as Record<string, string>;
        // Map requested .js to .ts/.tsx during development/build
        // while still allowing actual .js files
        // This supports our .js import convention in TS source files
        config.resolve.extensionAlias = {
            ...(config.resolve.extensionAlias || {}),
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        };
        return config;
    },
    // All /api routes are implemented within Next.js using the internal Client SDK.
    // The prior proxy-based rewrite has been removed as part of the migration.
    // Allow cross-origin requests for Next.js static and HMR assets during dev
    async headers() {
        return [
            {
                source: '/_next/:path*',
                headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
            },
        ];
    },
};

export default nextConfig;
