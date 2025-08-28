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
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
            '@core': path.resolve(__dirname, '../../core'),
            '@sdk': path.resolve(__dirname, '../../client'),
        };
        // Map requested .js to .ts/.tsx during development/build
        // while still allowing actual .js files
        // This supports our .js import convention in TS source files
        (config.resolve as any).extensionAlias = {
            ...(config.resolve as any).extensionAlias,
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        };
        return config;
    },
    // Allow static asset requests from these origins in dev mode
    allowedDevOrigins: allowedOrigins,
    // All /api routes are now implemented within Next.js using the internal Client SDK.
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
