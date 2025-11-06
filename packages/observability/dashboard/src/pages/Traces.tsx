import React, { useState } from 'react';
import { useTraces, useTrace } from '../lib/hooks';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';

export function Traces() {
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        sessionId: '',
        provider: '',
        window: '24h',
    });

    const { data: tracesData, loading: tracesLoading } = useTraces({
        ...filters,
        sessionId: filters.sessionId || undefined,
        provider: filters.provider || undefined,
        pageSize: 50,
    });

    const { data: traceData, loading: traceLoading } = useTrace(selectedTraceId);

    if (tracesLoading) {
        return <Loading text="Loading traces..." />;
    }

    const traces = tracesData?.data?.traces || [];
    const selectedTrace = traceData?.data;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Traces</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Detailed trace inspection and filtering
                </p>
            </div>

            {/* Filters */}
            <Card title="Filters">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">
                            Session ID
                        </label>
                        <input
                            type="text"
                            value={filters.sessionId}
                            onChange={(e) => setFilters({ ...filters, sessionId: e.target.value })}
                            placeholder="Filter by session..."
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Provider</label>
                        <input
                            type="text"
                            value={filters.provider}
                            onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
                            placeholder="Filter by provider..."
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">
                            Time Window
                        </label>
                        <select
                            value={filters.window}
                            onChange={(e) => setFilters({ ...filters, window: e.target.value })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        >
                            <option value="1h">Last Hour</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                        </select>
                    </div>
                </div>
            </Card>

            {/* Traces Table */}
            <Card title={`Traces (${traces.length})`}>
                <Table
                    data={traces}
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
                                <Badge variant={row.status.code === 0 ? 'success' : 'error'}>
                                    {row.status.code === 0 ? 'OK' : 'ERROR'}
                                </Badge>
                            ),
                        },
                        {
                            header: 'Provider',
                            accessor: (row) => row.provider || 'N/A',
                        },
                        {
                            header: 'Model',
                            accessor: (row) => row.model || 'N/A',
                        },
                        {
                            header: 'Time',
                            accessor: (row) => new Date(row.startTime).toLocaleString(),
                        },
                    ]}
                    onRowClick={(row) => setSelectedTraceId(row.id)}
                />
            </Card>

            {/* Trace Details */}
            {selectedTraceId && (
                <Card title="Trace Details">
                    {traceLoading ? (
                        <Loading text="Loading trace details..." />
                    ) : selectedTrace ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Trace ID</p>
                                    <p className="mt-1 text-sm font-mono text-gray-900">
                                        {selectedTrace.traceId}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Span ID</p>
                                    <p className="mt-1 text-sm font-mono text-gray-900">
                                        {selectedTrace.id}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Name</p>
                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedTrace.name}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Duration</p>
                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedTrace.duration}ms
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Status</p>
                                    <Badge
                                        variant={
                                            selectedTrace.status.code === 0 ? 'success' : 'error'
                                        }
                                    >
                                        {selectedTrace.status.code === 0 ? 'OK' : 'ERROR'}
                                    </Badge>
                                </div>
                                {selectedTrace.errorMessage && (
                                    <div className="col-span-2">
                                        <p className="text-sm font-medium text-gray-600">
                                            Error Message
                                        </p>
                                        <p className="mt-1 text-sm text-red-600">
                                            {selectedTrace.errorMessage}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {selectedTrace.attributes &&
                                Object.keys(selectedTrace.attributes).length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-900 mb-2">
                                            Attributes
                                        </h4>
                                        <pre className="bg-gray-50 rounded-md p-4 text-xs overflow-x-auto">
                                            {JSON.stringify(selectedTrace.attributes, null, 2)}
                                        </pre>
                                    </div>
                                )}

                            <button
                                onClick={() => setSelectedTraceId(null)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
                            >
                                Close Details
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-gray-500">Trace not found</div>
                    )}
                </Card>
            )}
        </div>
    );
}
