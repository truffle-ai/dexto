import type { NextConfig } from 'next';
import os from 'os';
import path from 'path';

// Determine allowed development origins (local network IPs on port 3000)
const interfaces = os.networkInterfaces();
const allowedOrigins: string[] = ['http://localhost:3000'];
Object.values(interfaces).forEach((list) =>
    list?.forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) {
            allowedOrigins.push(`http://${iface.address}:3000`);
        }
    })
);

const _isDev = process.env.NODE_ENV === 'development';
const isStandalone = process.env.BUILD_STANDALONE === 'true';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // Use standalone output for production builds
    output: isStandalone ? 'standalone' : undefined,
    // Ensure Next.js computes paths relative to the repo root (not the user home)
    // This stabilizes the emitted standalone directory structure and prevents
    // paths like "+/Projects/dexto/..." from being embedded in output.
    outputFileTracingRoot: path.resolve(__dirname, '..', '..'),
    // Next 15: transpilePackages at top-level.
    // Core ships compiled JS; we don't need to transpile it. Keep empty.
    // Disable ESLint during build to avoid config issues
    eslint: {
        ignoreDuringBuilds: true,
    },
    // Ensure webpack can resolve ESM-style .js imports to .ts sources
    webpack: (config) => {
        config.resolve = config.resolve || {};
        // Prefer package imports (@dexto/core); legacy alias can be removed once all imports migrate
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
        };
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
    // Allow static asset requests from these origins in dev mode
    allowedDevOrigins: allowedOrigins,
    async rewrites() {
        const apiPort = process.env.API_PORT ?? '3001';
        return [
            {
                source: '/api/:path*',
                destination: `http://localhost:${apiPort}/api/:path*`, // Proxy to backend
            },
        ];
    },
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
