import { Hono } from 'hono';
import type { DextoAgent } from '@dexto/core';
import { QueryService } from './query-service.js';
import { MetricsService } from './metrics-service.js';

/**
 * Create observability router with telemetry API endpoints.
 *
 * All endpoints are prefixed with the mount path (typically /api/observability)
 */
export function createObservabilityRouter(getAgent: () => DextoAgent) {
    const app = new Hono();

    // Health endpoint - GET /health
    app.get('/health', async (c) => {
        try {
            const agent = getAgent();
            const storageManager = agent.services.storageManager;

            // Get agent status
            const agentStatus = agent.isStarted() && !agent.isStopped() ? 'running' : 'stopped';

            // Get storage health
            const storageHealth = await storageManager.healthCheck();

            // Get telemetry stats using QueryService
            const queryService = new QueryService(storageManager);
            const traceCount = await queryService.countTraces();
            const timeRange = await queryService.getTraceTimeRange();

            return c.json({
                ok: true,
                agent: {
                    status: agentStatus,
                    uptime: Date.now(), // TODO: Track actual uptime
                },
                storage: {
                    cache: storageHealth.cache,
                    database: storageHealth.database,
                    blob: storageHealth.blob,
                },
                telemetry: {
                    enabled: true,
                    traceCount,
                    ...(timeRange && {
                        oldestTrace: timeRange.oldest,
                        newestTrace: timeRange.newest,
                    }),
                },
            });
        } catch (error) {
            return c.json(
                {
                    ok: false,
                    error: {
                        code: 'HEALTH_CHECK_FAILED',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    },
                },
                500
            );
        }
    });

    // List traces - GET /traces
    app.get('/traces', async (c) => {
        try {
            const agent = getAgent();
            const queryService = new QueryService(agent.services.storageManager);

            const query = c.req.query();

            const result = await queryService.listTraces({
                filters: {
                    sessionId: query.sessionId,
                    provider: query.provider,
                    model: query.model,
                    toolName: query.toolName,
                    status: query.status as 'ok' | 'error' | undefined,
                    minDuration: query.minDuration ? Number(query.minDuration) : undefined,
                    maxDuration: query.maxDuration ? Number(query.maxDuration) : undefined,
                },
                pagination: {
                    page: query.page ? Number(query.page) : 1,
                    pageSize: query.pageSize ? Number(query.pageSize) : 20,
                },
                timeRange: {
                    start: query.start ? Number(query.start) : undefined,
                    end: query.end ? Number(query.end) : undefined,
                    window: query.window,
                },
            });

            // Map traces to response format
            const traces = result.data.map((trace) => ({
                id: trace.id,
                traceId: trace.traceId,
                name: trace.name,
                startTime: trace.startTime,
                endTime: trace.endTime,
                duration: trace.duration ?? trace.endTime - trace.startTime,
                status: trace.status,
                sessionId: trace.sessionId,
                provider: trace.provider,
                model: trace.model,
                toolName: trace.toolName,
            }));

            return c.json({
                ok: true,
                data: {
                    traces,
                    pagination: result.pagination,
                },
            });
        } catch (error) {
            return c.json(
                {
                    ok: false,
                    error: {
                        code: 'LIST_TRACES_FAILED',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    },
                },
                500
            );
        }
    });

    // Get trace by ID - GET /traces/:id
    app.get('/traces/:id', async (c) => {
        try {
            const agent = getAgent();
            const queryService = new QueryService(agent.services.storageManager);

            const id = c.req.param('id');
            const trace = await queryService.getTrace(id);

            if (!trace) {
                return c.json(
                    {
                        ok: false,
                        error: {
                            code: 'TRACE_NOT_FOUND',
                            message: `Trace with ID ${id} not found`,
                        },
                    },
                    404
                );
            }

            return c.json({
                ok: true,
                data: trace,
            });
        } catch (error) {
            return c.json(
                {
                    ok: false,
                    error: {
                        code: 'GET_TRACE_FAILED',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    },
                },
                500
            );
        }
    });

    // Get metrics - GET /metrics
    app.get('/metrics', async (c) => {
        try {
            const agent = getAgent();
            const metricsService = new MetricsService(agent.services.storageManager);

            const query = c.req.query();

            const metrics = await metricsService.calculateMetrics(
                {
                    start: query.start ? Number(query.start) : undefined,
                    end: query.end ? Number(query.end) : undefined,
                    window: query.window,
                },
                {
                    ...(query.sessionId && { sessionId: query.sessionId }),
                    ...(query.provider && { provider: query.provider }),
                }
            );

            return c.json({
                ok: true,
                data: metrics,
            });
        } catch (error) {
            return c.json(
                {
                    ok: false,
                    error: {
                        code: 'METRICS_CALCULATION_FAILED',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    },
                },
                500
            );
        }
    });

    // Get session metrics - GET /sessions/:sessionId
    app.get('/sessions/:sessionId', async (c) => {
        try {
            const agent = getAgent();
            const metricsService = new MetricsService(agent.services.storageManager);

            const sessionId = c.req.param('sessionId');

            const sessionMetrics = await metricsService.calculateSessionMetrics(sessionId);

            // Map traces to response format
            const traces = sessionMetrics.traces.map((trace) => ({
                id: trace.id,
                traceId: trace.traceId,
                name: trace.name,
                startTime: trace.startTime,
                endTime: trace.endTime,
                duration: trace.duration ?? trace.endTime - trace.startTime,
                status: trace.status,
                sessionId: trace.sessionId,
                provider: trace.provider,
                model: trace.model,
                toolName: trace.toolName,
            }));

            return c.json({
                ok: true,
                data: {
                    ...sessionMetrics,
                    traces,
                },
            });
        } catch (error) {
            return c.json(
                {
                    ok: false,
                    error: {
                        code: 'SESSION_METRICS_FAILED',
                        message: error instanceof Error ? error.message : 'Unknown error',
                    },
                },
                500
            );
        }
    });

    return app;
}
