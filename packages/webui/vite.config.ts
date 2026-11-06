import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiTarget = `http://localhost:${process.env.DEXTO_API_PORT || '3001'}`;

export default defineConfig({
    plugins: [react()],
    define: {
        // Polyfill process.env for browser (used by @dexto/core schemas)
        'process.env': {},
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './'),
        },
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom'],
                    tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
                },
            },
        },
    },
    server: {
        proxy: {
            '/api': {
                target: apiTarget,
                changeOrigin: true,
                // The API trusts only its own origin. changeOrigin rewrites Host to the API
                // port, so rewrite Origin to match, but only when the browser's Origin is this
                // dev server's own origin. Other origins pass through and are rejected.
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq, req) => {
                        const origin = req.headers.origin;
                        const host = req.headers.host;
                        if (!origin || !host) {
                            return;
                        }
                        try {
                            if (new URL(origin).host === host) {
                                proxyReq.setHeader('origin', apiTarget);
                            }
                        } catch {
                            // Malformed Origin: forward unchanged so the API rejects it.
                        }
                    });
                },
            },
        },
    },
});
