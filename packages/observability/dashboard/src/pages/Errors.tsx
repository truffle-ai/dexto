import React from 'react';
import { useTraces, useMetrics, useAutoRefresh } from '../lib/hooks';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';

export function Errors() {
    const {
        data: tracesData,
        loading: tracesLoading,
        refetch: refetchTraces,
    } = useTraces({
        status: 'error',
        pageSize: 100,
    });
    const {
        data: metricsData,
        loading: metricsLoading,
        refetch: refetchMetrics,
    } = useMetrics({ window: '24h' });

    useAutoRefresh(() => {
        refetchTraces();
        refetchMetrics();
    }, 10000);

    if (tracesLoading || metricsLoading) {
        return <Loading text="Loading error data..." />;
    }

    const errorTraces = tracesData?.data?.traces || [];
    const metrics = metricsData?.data;

    // Group errors by message
    const errorGroups = new Map<string, typeof errorTraces>();
    errorTraces.forEach((trace) => {
        const message = trace.errorMessage || 'Unknown error';
        const existing = errorGroups.get(message) || [];
        errorGroups.set(message, [...existing, trace]);
    });

    const errorStats = Array.from(errorGroups.entries())
        .map(([message, traces]) => ({
            message,
            count: traces.length,
            lastOccurrence: Math.max(...traces.map((t) => t.endTime)),
            affectedSessions: new Set(traces.map((t) => t.sessionId).filter(Boolean)).size,
        }))
        .sort((a, b) => b.count - a.count);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Errors</h2>
                <p className="mt-1 text-sm text-gray-500">Error tracking and analysis</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Total Errors (24h)" value={errorTraces.length} />
                <StatCard
                    label="Error Rate"
                    value={`${((metrics?.errorRate || 0) * 100).toFixed(2)}%`}
                />
                <StatCard label="Unique Error Types" value={errorStats.length} />
            </div>

            {/* Error Groups */}
            <Card title="Error Groups">
                {errorStats.length === 0 ? (
                    <div className="text-center py-12 text-green-600">
                        <div className="text-4xl mb-2">✓</div>
                        <p>No errors in the last 24 hours</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {errorStats.map((error, idx) => (
                            <div key={idx} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-red-600">
                                            {error.message}
                                        </p>
                                        <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                                            <span>Count: {error.count}</span>
                                            <span>Sessions: {error.affectedSessions}</span>
                                            <span>
                                                Last:{' '}
                                                {new Date(error.lastOccurrence).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                    <Badge variant="error">{error.count} errors</Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Recent Errors */}
            <Card title="Recent Errors">
                {errorTraces.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No recent errors</div>
                ) : (
                    <Table
                        data={errorTraces.slice(0, 20)}
                        columns={[
                            {
                                header: 'Time',
                                accessor: (row) => new Date(row.startTime).toLocaleString(),
                            },
                            {
                                header: 'Name',
                                accessor: 'name',
                            },
                            {
                                header: 'Error',
                                accessor: (row) => (
                                    <span className="text-sm text-red-600">
                                        {row.errorMessage || 'Unknown'}
                                    </span>
                                ),
                            },
                            {
                                header: 'Duration',
                                accessor: (row) => `${row.duration}ms`,
                            },
                            {
                                header: 'Session',
                                accessor: (row) => (
                                    <span className="font-mono text-xs">
                                        {row.sessionId ? row.sessionId.slice(0, 8) + '...' : 'N/A'}
                                    </span>
                                ),
                            },
                        ]}
                    />
                )}
            </Card>
        </div>
    );
}
