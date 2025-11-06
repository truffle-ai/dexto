/**
 * Standalone Observability Dashboard Server
 *
 * This server:
 * 1. Receives OTLP traces from Dexto agents (at /v1/traces)
 * 2. Stores them in its own database
 * 3. Serves API endpoints for querying traces
 * 4. Serves the dashboard UI
 *
 * Run: dexto-dashboard
 * Then configure your agent to export OTLP to this server
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createStorageManager, StorageSchema } from '@dexto/core';
import { TelemetryStorageExporter } from '../storage/telemetry-exporter.js';
import { RetentionService } from '../storage/retention.js';
import { createOtlpReceiver } from './otlp-receiver.js';
import { QueryService } from '../api/query-service.js';
import { MetricsService } from '../api/metrics-service.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardServerOptions {
    port?: number;
    otlpPort?: number;
    databasePath?: string;
    retention?: string;
}

export async function startDashboardServer(options: DashboardServerOptions = {}) {
    const port = options.port || parseInt(process.env.DASHBOARD_PORT || '3002', 10);
    const otlpPort = options.otlpPort || parseInt(process.env.OTLP_PORT || '4318', 10);
    const databasePath =
        options.databasePath || process.env.DASHBOARD_DB || './.dexto/observability.db';
    const retention = options.retention || '7d';

    console.log('🔍 Starting Dexto Observability Dashboard...\n');

    // Create storage for dashboard (separate from agent storage)
    const storageConfig = StorageSchema.parse({
        database: {
            type: 'sqlite',
            path: databasePath,
        },
        cache: { type: 'in-memory' },
        blob: {
            type: 'local',
            storePath: './.dexto/observability-blobs',
            maxBlobSize: 10 * 1024 * 1024, // 10MB
            maxTotalSize: 1024 * 1024 * 1024, // 1GB
            cleanupAfterDays: 7,
        },
    });

    const storageManager = await createStorageManager(storageConfig);

    console.log(`✅ Storage initialized at ${databasePath}\n`);

    // Create telemetry exporter
    const exporter = new TelemetryStorageExporter(storageManager, { retention });

    // Create retention service
    const retentionService = new RetentionService(storageManager, {
        retention,
        autoCleanup: true,
        cleanupInterval: 3600000, // 1 hour
    });
    await retentionService.start();

    console.log(`✅ Retention service started (keeping traces for ${retention})\n`);

    // Create services
    const queryService = new QueryService(storageManager);
    const metricsService = new MetricsService(storageManager);

    // Create OTLP receiver app
    const otlpApp = createOtlpReceiver(exporter);

    // Create dashboard API app
    const apiApp = new Hono();

    // API endpoints
    apiApp.get('/health', async (c) => {
        const traceCount = await queryService.countTraces();
        const timeRange = await queryService.getTraceTimeRange();

        // Check if agent is active (received traces in last 5 minutes)
        const now = Date.now();
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        const isAgentActive =
            timeRange?.newest && new Date(timeRange.newest).getTime() > fiveMinutesAgo;

        // Check storage health
        const database = storageManager.getDatabase();
        const cache = storageManager.getCache();
        const blob = storageManager.getBlobStore();

        const storageHealth = {
            database: !!database,
            cache: !!cache,
            blob: !!blob,
        };

        return c.json({
            ok: true,
            agent: {
                status: isAgentActive ? 'running' : 'idle',
                uptime: 0, // Dashboard doesn't track agent uptime
            },
            storage: storageHealth,
            telemetry: {
                enabled: true,
                traceCount,
                oldestTrace: timeRange?.oldest,
                newestTrace: timeRange?.newest,
            },
        });
    });

    apiApp.get('/traces', async (c) => {
        const query = c.req.query();
        const result = await queryService.listTraces({
            filters: {
                sessionId: query.sessionId,
                provider: query.provider,
                model: query.model,
                toolName: query.toolName,
                status: query.status as any,
            },
            pagination: {
                page: query.page ? Number(query.page) : 1,
                pageSize: query.pageSize ? Number(query.pageSize) : 20,
            },
            timeRange: {
                window: query.window,
            },
        });

        // Transform to frontend format: rename 'data' to 'traces'
        return c.json({
            ok: true,
            data: {
                traces: result.data,
                pagination: result.pagination,
            },
        });
    });

    apiApp.get('/traces/:id', async (c) => {
        const id = c.req.param('id');
        const trace = await queryService.getTrace(id);

        if (!trace) {
            return c.json({ ok: false, error: 'Trace not found' }, 404);
        }

        return c.json({ ok: true, data: trace });
    });

    apiApp.get('/metrics', async (c) => {
        const query = c.req.query();
        const metrics = await metricsService.calculateMetrics({
            window: query.window,
        });

        return c.json({ ok: true, data: metrics });
    });

    // Main app
    const app = new Hono();

    // Mount OTLP receiver
    app.route('/', otlpApp);

    // Mount API
    app.route('/api', apiApp);

    // Serve built React dashboard
    app.get('/', (c) => {
        const html = readFileSync(join(__dirname, '../dashboard-ui/index.html'), 'utf-8');
        return c.html(html);
    });

    // Serve static assets (CSS, JS)
    app.get('/assets/*', async (c) => {
        const assetPath = c.req.path.replace('/assets/', '');
        try {
            const content = readFileSync(join(__dirname, '../dashboard-ui/assets', assetPath));

            // Set appropriate content type
            if (assetPath.endsWith('.css')) {
                c.header('Content-Type', 'text/css');
            } else if (assetPath.endsWith('.js')) {
                c.header('Content-Type', 'application/javascript');
            }

            return c.body(content);
        } catch (error) {
            return c.notFound();
        }
    });

    // Start servers
    const otlpServer = serve({
        fetch: otlpApp.fetch,
        port: otlpPort,
    });

    const dashboardServer = serve({
        fetch: app.fetch,
        port,
    });

    console.log(`✅ Dashboard Server Running\n`);
    console.log(`   Dashboard UI:  http://localhost:${port}`);
    console.log(`   API Health:    http://localhost:${port}/api/health`);
    console.log(`   OTLP Endpoint: http://localhost:${otlpPort}/v1/traces\n`);
    console.log(
        `📝 Configure your agent to export OTLP to: http://localhost:${otlpPort}/v1/traces\n`
    );
    console.log(`   Add to agent config:`);
    console.log(`   telemetry:`);
    console.log(`     export:`);
    console.log(`       type: otlp`);
    console.log(`       protocol: http`);
    console.log(`       endpoint: http://localhost:${otlpPort}/v1/traces\n`);

    return {
        dashboardServer,
        otlpServer,
        storageManager,
        cleanup: async () => {
            await retentionService.stop();
            await storageManager.disconnect();
        },
    };
}
