import React, { useState } from 'react';
import { useTraces, useAutoRefresh } from '../lib/hooks';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import type { Trace } from '../lib/types';

export function Sessions() {
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const { data: tracesData, loading: tracesLoading, refetch } = useTraces({ pageSize: 1000 });

    useAutoRefresh(refetch, 10000);

    if (tracesLoading) {
        return <Loading text="Loading sessions..." />;
    }

    const traces = tracesData?.data?.traces || [];

    // Group by sessionId if available, otherwise by traceId (root trace groups)
    const groupMap = new Map<string, Trace[]>();

    traces.forEach((trace) => {
        const groupKey = trace.sessionId || trace.traceId;
        if (groupKey) {
            const existing = groupMap.get(groupKey) || [];
            groupMap.set(groupKey, [...existing, trace]);
        }
    });

    // Calculate metrics for each group
    const groups = Array.from(groupMap.entries()).map(([key, groupTraces]) => {
        const totalDuration = groupTraces.reduce((sum, t) => sum + t.duration, 0);
        const errorCount = groupTraces.filter((t) => t.status.code !== 0).length;
        const isSession = groupTraces.some((t) => t.sessionId === key);

        // Find agent.run or main spans
        const mainSpan = groupTraces.find((t) => t.name === 'agent.run') || groupTraces[0];

        return {
            id: key,
            type: isSession ? 'Session' : 'Trace Group',
            traceCount: groupTraces.length,
            totalDuration,
            avgDuration: Math.round(totalDuration / groupTraces.length),
            errorCount,
            errorRate: (errorCount / groupTraces.length) * 100,
            lastActive: Math.max(...groupTraces.map((t) => t.endTime)),
            traces: groupTraces,
            mainSpanName: mainSpan?.name || 'Unknown',
        };
    });

    // Sort by last active
    groups.sort((a, b) => b.lastActive - a.lastActive);

    const selectedGroupData = groups.find((g) => g.id === selectedGroup);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Sessions & Trace Groups</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Grouped agent activity by session or trace
                </p>
            </div>

            {/* Groups List */}
            <Card title={`Activity Groups (${groups.length})`}>
                {groups.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No activity found</div>
                ) : (
                    <Table
                        data={groups}
                        columns={[
                            {
                                header: 'Group ID',
                                accessor: (row) => (
                                    <div>
                                        <span className="font-mono text-xs">
                                            {row.id.slice(0, 12)}...
                                        </span>
                                        <Badge variant="info" className="ml-2 text-xs">
                                            {row.type}
                                        </Badge>
                                    </div>
                                ),
                            },
                            {
                                header: 'Main Span',
                                accessor: 'mainSpanName',
                            },
                            {
                                header: 'Spans',
                                accessor: 'traceCount',
                            },
                            {
                                header: 'Total Duration',
                                accessor: (row) => `${row.totalDuration}ms`,
                            },
                            {
                                header: 'Errors',
                                accessor: (row) => (
                                    <Badge variant={row.errorCount > 0 ? 'error' : 'success'}>
                                        {row.errorCount}
                                    </Badge>
                                ),
                            },
                            {
                                header: 'Last Active',
                                accessor: (row) => new Date(row.lastActive).toLocaleString(),
                            },
                        ]}
                        onRowClick={(row) => setSelectedGroup(row.id)}
                    />
                )}
            </Card>

            {/* Group Details */}
            {selectedGroup && selectedGroupData && (
                <Card title={`Details: ${selectedGroupData.mainSpanName}`}>
                    <div className="space-y-6">
                        {/* Metrics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <p className="text-sm text-gray-600">Spans</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {selectedGroupData.traceCount}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Avg Duration</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {selectedGroupData.avgDuration}ms
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Errors</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {selectedGroupData.errorCount}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600">Error Rate</p>
                                <p className="mt-2 text-2xl font-semibold text-gray-900">
                                    {selectedGroupData.errorRate.toFixed(1)}%
                                </p>
                            </div>
                        </div>

                        {/* Spans Table */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-900 mb-4">
                                Spans in Group
                            </h4>
                            <Table
                                data={selectedGroupData.traces}
                                columns={[
                                    {
                                        header: 'Name',
                                        accessor: 'name',
                                    },
                                    {
                                        header: 'Duration',
                                        accessor: (row) => `${row.duration}ms`,
                                    },
                                    {
                                        header: 'Status',
                                        accessor: (row) => (
                                            <Badge
                                                variant={
                                                    row.status.code === 0 ? 'success' : 'error'
                                                }
                                            >
                                                {row.status.code === 0 ? 'OK' : 'ERROR'}
                                            </Badge>
                                        ),
                                    },
                                    {
                                        header: 'Time',
                                        accessor: (row) =>
                                            new Date(row.startTime).toLocaleTimeString(),
                                    },
                                ]}
                            />
                        </div>

                        <button
                            onClick={() => setSelectedGroup(null)}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </Card>
            )}
        </div>
    );
}
