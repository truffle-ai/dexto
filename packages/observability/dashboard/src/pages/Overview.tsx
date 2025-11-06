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

    const isActive = health?.telemetry.traceCount && health.telemetry.traceCount > 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
                <p className="mt-1 text-sm text-gray-500">Agent performance and activity metrics</p>
            </div>

            {/* Agent Activity Status */}
            <Card title="Agent Activity">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600">Status</p>
                        <div className="mt-2">
                            <Badge variant={isActive ? 'success' : 'default'}>
                                {isActive ? 'Active' : 'No Recent Activity'}
                            </Badge>
                        </div>
                    </div>
                    <div>
                        <p className="text-sm text-gray-600">Total Traces</p>
                        <p className="mt-2 text-2xl font-semibold text-gray-900">
                            {health?.telemetry.traceCount || 0}
                        </p>
                    </div>
                </div>
            </Card>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Requests (24h)" value={metrics?.throughput.total || 0} />
                <StatCard label="Avg Latency" value={`${metrics?.latency.mean || 0}ms`} />
                <StatCard
                    label="Error Rate"
                    value={`${((metrics?.errorRate || 0) * 100).toFixed(1)}%`}
                />
                <StatCard
                    label="Tokens Used"
                    value={
                        metrics?.tokenUsage?.total ? metrics.tokenUsage.total.toLocaleString() : '0'
                    }
                />
            </div>

            {/* Latency Distribution */}
            {metrics?.latency && (
                <Card title="Latency Distribution (24h)">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div>
                            <p className="text-sm text-gray-600">P50 (Median)</p>
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

            {/* LLM Usage */}
            {metrics?.tokenUsage && (
                <Card title="LLM Usage (24h)">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-600">Total Tokens</span>
                            <span className="text-2xl font-semibold text-gray-900">
                                {metrics.tokenUsage.total.toLocaleString()}
                            </span>
                        </div>
                        {metrics.tokenUsage.byProvider &&
                            Object.keys(metrics.tokenUsage.byProvider).length > 0 && (
                                <div className="space-y-3 pt-4 border-t border-gray-200">
                                    <p className="text-sm font-medium text-gray-700">By Provider</p>
                                    {Object.entries(metrics.tokenUsage.byProvider).map(
                                        ([provider, count]) => (
                                            <div
                                                key={provider}
                                                className="flex items-center justify-between"
                                            >
                                                <span className="text-sm text-gray-600 capitalize">
                                                    {provider}
                                                </span>
                                                <span className="text-sm font-medium text-gray-900">
                                                    {count.toLocaleString()}
                                                </span>
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                    </div>
                </Card>
            )}

            {/* Tool Usage */}
            {metrics?.toolCalls && (
                <Card title="Tool Usage (24h)">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-gray-600">Total Calls</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {metrics.toolCalls.total}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Success Rate</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {(metrics.toolCalls.successRate * 100).toFixed(1)}%
                                </p>
                            </div>
                        </div>
                        {Object.keys(metrics.toolCalls.byTool).length > 0 && (
                            <div className="space-y-3 pt-4 border-t border-gray-200">
                                <p className="text-sm font-medium text-gray-700">Top Tools</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {Object.entries(metrics.toolCalls.byTool)
                                        .sort((a, b) => b[1] - a[1])
                                        .slice(0, 6)
                                        .map(([tool, count]) => (
                                            <div
                                                key={tool}
                                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                            >
                                                <span className="text-sm font-medium text-gray-900 truncate">
                                                    {tool}
                                                </span>
                                                <span className="ml-2 text-sm font-semibold text-blue-600">
                                                    {count}
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}
