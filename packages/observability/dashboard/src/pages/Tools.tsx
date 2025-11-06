import React from 'react';
import { useMetrics, useTraces, useAutoRefresh } from '../lib/hooks';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { Table } from '../components/Table';
import { Loading } from '../components/Loading';

export function Tools() {
    const {
        data: metricsData,
        loading: metricsLoading,
        refetch: refetchMetrics,
    } = useMetrics({ window: '24h' });
    const {
        data: tracesData,
        loading: tracesLoading,
        refetch: refetchTraces,
    } = useTraces({ pageSize: 100 });

    useAutoRefresh(() => {
        refetchMetrics();
        refetchTraces();
    }, 10000);

    if (metricsLoading || tracesLoading) {
        return <Loading text="Loading tool metrics..." />;
    }

    const metrics = metricsData?.data;
    const traces = tracesData?.data?.traces || [];

    // Filter for MCP tool traces (mcp.tool.* spans)
    const toolTraces = traces.filter((t) => t.name.startsWith('mcp.tool.') && t.toolName);

    // Calculate per-tool metrics
    const toolMetrics = new Map<
        string,
        { total: number; success: number; avgDuration: number; durations: number[] }
    >();

    toolTraces.forEach((trace) => {
        if (!trace.toolName) return;

        const existing = toolMetrics.get(trace.toolName) || {
            total: 0,
            success: 0,
            avgDuration: 0,
            durations: [],
        };

        existing.total++;
        if (trace.status.code === 0) existing.success++;
        existing.durations.push(trace.duration);

        toolMetrics.set(trace.toolName, existing);
    });

    // Calculate average durations
    const toolStats = Array.from(toolMetrics.entries()).map(([tool, stats]) => ({
        tool,
        total: stats.total,
        success: stats.success,
        successRate: (stats.success / stats.total) * 100,
        avgDuration: Math.round(
            stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
        ),
    }));

    // Sort by total calls
    toolStats.sort((a, b) => b.total - a.total);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Tools</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Tool usage, performance, and success rates
                </p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Total Tool Calls" value={metrics?.toolCalls?.total || 0} />
                <StatCard
                    label="Success Rate"
                    value={`${((metrics?.toolCalls?.successRate || 0) * 100).toFixed(1)}%`}
                />
                <StatCard label="Unique Tools" value={toolStats.length} />
            </div>

            {/* Tool Performance Table */}
            <Card title="Tool Performance">
                {toolStats.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No tool calls found</div>
                ) : (
                    <Table
                        data={toolStats}
                        columns={[
                            {
                                header: 'Tool Name',
                                accessor: 'tool',
                            },
                            {
                                header: 'Total Calls',
                                accessor: 'total',
                            },
                            {
                                header: 'Successful',
                                accessor: 'success',
                            },
                            {
                                header: 'Success Rate',
                                accessor: (row) => `${row.successRate.toFixed(1)}%`,
                            },
                            {
                                header: 'Avg Duration',
                                accessor: (row) => `${row.avgDuration}ms`,
                            },
                        ]}
                    />
                )}
            </Card>

            {/* Top Tools by Usage */}
            {metrics?.toolCalls && (
                <Card title="Top Tools by Usage (24h)">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(metrics.toolCalls.byTool)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 12)
                            .map(([tool, count]) => (
                                <div
                                    key={tool}
                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                    <span className="text-sm font-medium text-gray-900 truncate">
                                        {tool}
                                    </span>
                                    <span className="ml-2 text-lg font-semibold text-blue-600">
                                        {count}
                                    </span>
                                </div>
                            ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
