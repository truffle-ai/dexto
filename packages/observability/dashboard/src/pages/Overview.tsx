import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Zap, AlertCircle, Cpu, TrendingUp } from 'lucide-react';
import { useHealth, useMetrics, useTraces, useAutoRefresh } from '../lib/hooks';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import { LineChart } from '../components/charts/LineChart';
import { AreaChart } from '../components/charts/AreaChart';
import { PieChart } from '../components/charts/PieChart';
import { BarChart } from '../components/charts/BarChart';
import { TooltipProvider } from '../components/Tooltip';
import {
    formatNumber,
    formatDuration,
    formatRelativeTime,
    generateSparklineData,
    calculateTrend,
} from '../lib/utils';
import type { Trace } from '../lib/types';

export function Overview() {
    const { data: healthData, loading: healthLoading, refetch: refetchHealth } = useHealth();
    const {
        data: metricsData,
        loading: metricsLoading,
        refetch: refetchMetrics,
    } = useMetrics({ window: '24h' });
    const {
        data: tracesData,
        loading: tracesLoading,
        refetch: refetchTraces,
    } = useTraces({ pageSize: 1000 });

    useAutoRefresh(() => {
        refetchHealth();
        refetchMetrics();
        refetchTraces();
    }, 10000);

    const allTraces = tracesData?.data?.traces || [];
    const metrics = metricsData?.data;

    // Calculate active sessions
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const activeSessions = useMemo(() => {
        return new Set(
            allTraces
                .filter((t) => t.endTime >= fiveMinutesAgo && t.sessionId)
                .map((t) => t.sessionId)
        ).size;
    }, [allTraces, fiveMinutesAgo]);

    // Generate sparkline data
    const requestSparkline = useMemo(() => generateSparklineData(allTraces), [allTraces]);
    const errorTraces = useMemo(() => allTraces.filter((t) => t.status.code !== 0), [allTraces]);

    // Calculate trends (mock for now - would need historical data)
    const requestTrend = calculateTrend(metrics?.throughput.total || 0, 800);
    const latencyTrend = calculateTrend(metrics?.latency.mean || 0, 300);
    const errorTrend = calculateTrend((metrics?.errorRate || 0) * 100, 1.5);
    const tokenTrend = calculateTrend(metrics?.tokenUsage?.total || 0, 10000000);

    // Prepare chart data
    const latencyChartData = useMemo(() => {
        // Group traces by hour for the last 24 hours
        const now = Date.now();
        const hours = 24;
        const hourMs = 60 * 60 * 1000;
        const buckets = new Array(hours).fill(0).map((_, i) => ({
            time: new Date(now - (hours - i) * hourMs).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            }),
            p50: 0,
            p95: 0,
            mean: 0,
            count: 0,
            durations: [] as number[],
        }));

        allTraces.forEach((trace) => {
            const age = now - trace.endTime;
            if (age < hours * hourMs) {
                const bucketIndex = Math.floor(age / hourMs);
                if (bucketIndex >= 0 && bucketIndex < hours) {
                    const bucket = buckets[hours - 1 - bucketIndex];
                    bucket.count++;
                    bucket.durations.push(trace.duration);
                }
            }
        });

        // Calculate percentiles for each bucket
        buckets.forEach((bucket) => {
            if (bucket.durations.length > 0) {
                const sorted = bucket.durations.sort((a, b) => a - b);
                bucket.p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
                bucket.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
                bucket.mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
            }
        });

        return buckets;
    }, [allTraces]);

    const tokenUsageChartData = useMemo(() => {
        if (!metrics?.tokenUsage?.byProvider) return [];
        return Object.entries(metrics.tokenUsage.byProvider).map(([name, value]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value,
        }));
    }, [metrics?.tokenUsage]);

    const topToolsChartData = useMemo(() => {
        if (!metrics?.toolCalls?.byTool) return [];
        return Object.entries(metrics.toolCalls.byTool)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, value]) => ({
                name,
                calls: value,
            }));
    }, [metrics?.toolCalls]);

    if (healthLoading || metricsLoading || tracesLoading) {
        return <Loading text="Loading overview..." />;
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* Hero Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <MetricCard
                        label="Active Sessions"
                        value={activeSessions}
                        icon={<Activity className="w-6 h-6" />}
                        color="blue"
                        sparkline={requestSparkline}
                    />
                    <MetricCard
                        label="Requests (24h)"
                        value={formatNumber(metrics?.throughput.total || 0)}
                        trend={requestTrend}
                        icon={<TrendingUp className="w-6 h-6" />}
                        color="green"
                        sparkline={requestSparkline}
                    />
                    <MetricCard
                        label="Avg Latency"
                        value={`${metrics?.latency.mean || 0}ms`}
                        trend={latencyTrend}
                        icon={<Zap className="w-6 h-6" />}
                        color="purple"
                    />
                    <MetricCard
                        label="Token Usage (24h)"
                        value={formatNumber(metrics?.tokenUsage?.total || 0)}
                        trend={tokenTrend}
                        icon={<Cpu className="w-6 h-6" />}
                        color="yellow"
                    />
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Latency Over Time */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                    >
                        <Card title="Latency Over Time (24h)">
                            <div className="mt-4">
                                <LineChart
                                    data={latencyChartData}
                                    dataKeys={[
                                        { key: 'p50', name: 'P50', color: '#3b82f6' },
                                        { key: 'p95', name: 'P95', color: '#8b5cf6' },
                                        { key: 'mean', name: 'Mean', color: '#22c55e' },
                                    ]}
                                    xKey="time"
                                    height={250}
                                    formatYAxis={(value) => `${value}ms`}
                                />
                            </div>
                        </Card>
                    </motion.div>

                    {/* Token Usage by Provider */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        <Card title="Token Usage by Provider">
                            {tokenUsageChartData.length > 0 ? (
                                <div className="mt-4">
                                    <PieChart
                                        data={tokenUsageChartData}
                                        height={250}
                                        formatTooltip={(value) => formatNumber(value)}
                                    />
                                </div>
                            ) : (
                                <div className="h-64 flex items-center justify-center text-gray-500">
                                    No token data available
                                </div>
                            )}
                        </Card>
                    </motion.div>
                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Tools */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                    >
                        <Card title={`Top Tools (${metrics?.toolCalls?.total || 0} calls)`}>
                            {topToolsChartData.length > 0 ? (
                                <div className="mt-4">
                                    <BarChart
                                        data={topToolsChartData}
                                        dataKeys={[
                                            { key: 'calls', name: 'Calls', color: '#8b5cf6' },
                                        ]}
                                        xKey="name"
                                        height={250}
                                        horizontal
                                    />
                                </div>
                            ) : (
                                <div className="h-64 flex items-center justify-center text-gray-500">
                                    No tool data available
                                </div>
                            )}
                        </Card>
                    </motion.div>

                    {/* Performance Stats */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                    >
                        <Card title="Performance Stats">
                            <div className="mt-4 space-y-6">
                                {/* Latency Distribution */}
                                <div>
                                    <h4 className="text-sm font-medium text-gray-700 mb-3">
                                        Latency Percentiles
                                    </h4>
                                    <div className="grid grid-cols-4 gap-3">
                                        {[
                                            {
                                                label: 'P50',
                                                value: metrics?.latency.p50,
                                                color: 'blue',
                                            },
                                            {
                                                label: 'P95',
                                                value: metrics?.latency.p95,
                                                color: 'purple',
                                            },
                                            {
                                                label: 'P99',
                                                value: metrics?.latency.p99,
                                                color: 'red',
                                            },
                                            {
                                                label: 'Mean',
                                                value: metrics?.latency.mean,
                                                color: 'green',
                                            },
                                        ].map((item) => (
                                            <div
                                                key={item.label}
                                                className={`text-center p-3 rounded-lg bg-${item.color}-50`}
                                            >
                                                <p className="text-xs text-gray-600">
                                                    {item.label}
                                                </p>
                                                <p
                                                    className={`mt-1 text-lg font-semibold text-${item.color}-600`}
                                                >
                                                    {item.value}ms
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Throughput & Error Rate */}
                                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                                    <div>
                                        <p className="text-sm text-gray-600">Requests/min</p>
                                        <p className="mt-2 text-2xl font-semibold text-blue-600">
                                            {metrics?.throughput.perMinute.toFixed(2)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-600">Error Rate</p>
                                        <p className="mt-2 text-2xl font-semibold text-red-600">
                                            {((metrics?.errorRate || 0) * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </motion.div>
                </div>

                {/* Live Activity Stream */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <Card title="Live Activity Stream">
                        {allTraces.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                No recent activity
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {allTraces.slice(0, 20).map((trace, index) => (
                                    <motion.div
                                        key={trace.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.02 }}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            {/* Category Badge */}
                                            <Badge
                                                variant={
                                                    trace.name.startsWith('agent.')
                                                        ? 'info'
                                                        : trace.name.startsWith('llm.')
                                                          ? 'success'
                                                          : 'warning'
                                                }
                                            >
                                                {trace.name.startsWith('agent.')
                                                    ? 'Agent'
                                                    : trace.name.startsWith('llm.')
                                                      ? 'LLM'
                                                      : 'Tool'}
                                            </Badge>

                                            {/* Trace Name */}
                                            <span
                                                className={`text-sm font-medium truncate ${
                                                    trace.name.startsWith('agent.')
                                                        ? 'text-blue-600'
                                                        : trace.name.startsWith('llm.')
                                                          ? 'text-green-600'
                                                          : 'text-purple-600'
                                                }`}
                                            >
                                                {trace.name}
                                            </span>

                                            {/* Error Badge */}
                                            {trace.status.code !== 0 && (
                                                <Badge variant="error">Error</Badge>
                                            )}

                                            {/* Session ID */}
                                            {trace.sessionId && (
                                                <span className="text-xs text-gray-500 font-mono">
                                                    {trace.sessionId.slice(0, 8)}
                                                </span>
                                            )}
                                        </div>

                                        {/* Duration & Time */}
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="font-medium">{trace.duration}ms</span>
                                            <span className="whitespace-nowrap">
                                                {formatRelativeTime(trace.endTime)}
                                            </span>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </Card>
                </motion.div>
            </div>
        </TooltipProvider>
    );
}
