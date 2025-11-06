import React, { useState } from 'react';
import { useTraces, useSessionMetrics } from '../lib/hooks';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import type { Trace } from '../lib/types';

export function Sessions() {
    const [selectedSession, setSelectedSession] = useState<string | null>(null);
    const { data: tracesData, loading: tracesLoading } = useTraces({ pageSize: 100 });
    const { data: sessionData, loading: sessionLoading } = useSessionMetrics(selectedSession);

    if (tracesLoading) {
        return <Loading text="Loading sessions..." />;
    }

    const traces = tracesData?.data?.traces || [];

    // Group traces by session
    const sessionMap = new Map<string, Trace[]>();
    traces.forEach((trace) => {
        if (trace.sessionId) {
            const existing = sessionMap.get(trace.sessionId) || [];
            sessionMap.set(trace.sessionId, [...existing, trace]);
        }
    });

    const sessions = Array.from(sessionMap.entries()).map(([sessionId, sessionTraces]) => {
        const totalDuration = sessionTraces.reduce((sum, t) => sum + t.duration, 0);
        const errorCount = sessionTraces.filter((t) => t.status.code !== 0).length;

        return {
            sessionId,
            traceCount: sessionTraces.length,
            totalDuration,
            avgDuration: Math.round(totalDuration / sessionTraces.length),
            errorCount,
            errorRate: (errorCount / sessionTraces.length) * 100,
            lastActive: Math.max(...sessionTraces.map((t) => t.endTime)),
        };
    });

    // Sort by last active
    sessions.sort((a, b) => b.lastActive - a.lastActive);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Sessions</h2>
                <p className="mt-1 text-sm text-gray-500">Session-based agent activity</p>
            </div>

            {/* Sessions List */}
            <Card title="Active Sessions">
                {sessions.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No sessions found</div>
                ) : (
                    <Table
                        data={sessions}
                        columns={[
                            {
                                header: 'Session ID',
                                accessor: (row) => (
                                    <span className="font-mono text-xs">
                                        {row.sessionId.slice(0, 12)}...
                                    </span>
                                ),
                            },
                            {
                                header: 'Traces',
                                accessor: 'traceCount',
                            },
                            {
                                header: 'Avg Duration',
                                accessor: (row) => `${row.avgDuration}ms`,
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
                                header: 'Error Rate',
                                accessor: (row) => `${row.errorRate.toFixed(1)}%`,
                            },
                            {
                                header: 'Last Active',
                                accessor: (row) => new Date(row.lastActive).toLocaleTimeString(),
                            },
                        ]}
                        onRowClick={(row) => setSelectedSession(row.sessionId)}
                    />
                )}
            </Card>

            {/* Session Details */}
            {selectedSession && (
                <Card title={`Session Details: ${selectedSession.slice(0, 12)}...`}>
                    {sessionLoading ? (
                        <Loading text="Loading session details..." />
                    ) : sessionData?.data ? (
                        <div className="space-y-6">
                            {/* Session Metrics */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-sm text-gray-600">Messages</p>
                                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                                        {sessionData.data.messageCount}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600">Avg Duration</p>
                                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                                        {sessionData.data.averageDuration}ms
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600">Errors</p>
                                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                                        {sessionData.data.errorCount}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-600">Tool Calls</p>
                                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                                        {sessionData.data.toolCallCount}
                                    </p>
                                </div>
                            </div>

                            {/* Session Traces */}
                            <div>
                                <h4 className="text-sm font-medium text-gray-900 mb-4">
                                    Traces in Session
                                </h4>
                                <Table
                                    data={sessionData.data.traces}
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
                                onClick={() => setSelectedSession(null)}
                                className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
                            >
                                Close Details
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-gray-500">Session not found</div>
                    )}
                </Card>
            )}
        </div>
    );
}
