import React from 'react';
import { useHealth, useMetrics, useAutoRefresh } from '../lib/hooks';
import { StatCard } from '../components/StatCard';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';

export function Overview() {
    const { data: healthData, loading: healthLoading, refetch: refetchHealth } = useHealth();
    const {
        data: metricsData,
        loading: metricsLoading,
        refetch: refetchMetrics,
    } = useMetrics({ window: '24h' });

    useAutoRefresh(() => {
        refetchHealth();
        refetchMetrics();
    }, 10000);

    if (healthLoading || metricsLoading) {
        return <Loading text="Loading overview..." />;
    }

    const health = healthData?.data;
    const metrics = metricsData?.data;

    const agentStatus = health?.agent.status || 'unknown';
    const isRunning = agentStatus === 'running';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Monitor your agent's performance and health
                </p>
            </div>

            {/* Agent Status */}
            <Card title="Agent Status">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600">Current Status</p>
                        <div className="mt-2">
                            <Badge variant={isRunning ? 'success' : 'error'}>
                                {agentStatus.toUpperCase()}
                            </Badge>
                        </div>
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Uptime</p>
                        <p className="mt-2 text-lg font-semibold text-gray-900">
                            {health?.agent.uptime
                                ? `${Math.floor(health.agent.uptime / 60)}m`
                                : 'N/A'}
                        </p>
                    </div>
                </div>
            </Card>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Total Traces" value={health?.telemetry.traceCount || 0} />
                <StatCard label="Avg Latency" value={`${metrics?.latency.mean || 0}ms`} />
                <StatCard
                    label="Error Rate"
                    value={`${((metrics?.errorRate || 0) * 100).toFixed(1)}%`}
                />
                <StatCard label="Requests (24h)" value={metrics?.throughput.total || 0} />
            </div>

            {/* Storage Health */}
            <Card title="Storage Health">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <p className="text-sm text-gray-600">Database</p>
                        <div className="mt-2">
                            <Badge variant={health?.storage.database ? 'success' : 'error'}>
                                {health?.storage.database ? 'Connected' : 'Disconnected'}
                            </Badge>
                        </div>
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Cache</p>
                        <div className="mt-2">
                            <Badge variant={health?.storage.cache ? 'success' : 'error'}>
                                {health?.storage.cache ? 'Connected' : 'Disconnected'}
                            </Badge>
                        </div>
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Blob Storage</p>
                        <div className="mt-2">
                            <Badge variant={health?.storage.blob ? 'success' : 'error'}>
                                {health?.storage.blob ? 'Connected' : 'Disconnected'}
                            </Badge>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Latency Distribution */}
            {metrics?.latency && (
                <Card title="Latency Distribution (24h)">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <p className="text-sm text-gray-600">P50</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">
                                {metrics.latency.p50}ms
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">P95</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">
                                {metrics.latency.p95}ms
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">P99</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">
                                {metrics.latency.p99}ms
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Mean</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">
                                {metrics.latency.mean}ms
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Token Usage */}
            {metrics?.tokenUsage && (
                <Card title="Token Usage (24h)">
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm text-gray-600">Total Tokens</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">
                                {metrics.tokenUsage.total.toLocaleString()}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {Object.entries(metrics.tokenUsage.byProvider).map(
                                ([provider, count]) => (
                                    <div key={provider}>
                                        <p className="text-sm text-gray-600">{provider}</p>
                                        <p className="mt-1 text-lg font-medium text-gray-900">
                                            {count.toLocaleString()}
                                        </p>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </Card>
            )}

            {/* Tool Calls */}
            {metrics?.toolCalls && (
                <Card title="Tool Calls (24h)">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600">Total Calls</p>
                                <p className="mt-1 text-2xl font-semibold text-gray-900">
                                    {metrics.toolCalls.total}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Success Rate</p>
                                <p className="mt-1 text-2xl font-semibold text-gray-900">
                                    {(metrics.toolCalls.successRate * 100).toFixed(1)}%
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {Object.entries(metrics.toolCalls.byTool)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 6)
                                .map(([tool, count]) => (
                                    <div key={tool} className="flex items-center justify-between">
                                        <span className="text-sm text-gray-600 truncate">
                                            {tool}
                                        </span>
                                        <span className="ml-2 text-sm font-medium text-gray-900">
                                            {count}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
