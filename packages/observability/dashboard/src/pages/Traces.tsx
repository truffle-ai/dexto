import React, { useState } from 'react';
import { useTraces, useTrace, useAutoRefresh } from '../lib/hooks';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';

export function Traces() {
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [filters, setFilters] = useState({
        window: '24h',
    });

    const {
        data: tracesData,
        loading: tracesLoading,
        refetch,
    } = useTraces({
        window: filters.window,
        pageSize: 100,
    });

    const { data: traceData, loading: traceLoading } = useTrace(selectedTraceId);

    useAutoRefresh(refetch, 10000);

    if (tracesLoading) {
        return <Loading text="Loading traces..." />;
    }

    const allTraces = tracesData?.data?.traces || [];
    const selectedTrace = traceData?.data;

    // Apply category filter
    const traces =
        categoryFilter === 'all'
            ? allTraces
            : categoryFilter === 'agent'
              ? allTraces.filter((t) => t.name.startsWith('agent.'))
              : categoryFilter === 'llm'
                ? allTraces.filter((t) => t.name.startsWith('llm.'))
                : categoryFilter === 'tools'
                  ? allTraces.filter((t) => t.name.startsWith('mcp.tool.'))
                  : allTraces;

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
            <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Time Window
                        </label>
                        <select
                            value={filters.window}
                            onChange={(e) => setFilters({ ...filters, window: e.target.value })}
                            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                        >
                            <option value="1h">Last Hour</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Category
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => setCategoryFilter('all')}
                                className={`px-3 py-1 rounded text-sm transition-colors ${
                                    categoryFilter === 'all'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                }`}
                            >
                                All ({allTraces.length})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('agent')}
                                className={`px-3 py-1 rounded text-sm transition-colors ${
                                    categoryFilter === 'agent'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                                }`}
                            >
                                Agent ({allTraces.filter((t) => t.name.startsWith('agent.')).length}
                                )
                            </button>
                            <button
                                onClick={() => setCategoryFilter('llm')}
                                className={`px-3 py-1 rounded text-sm transition-colors ${
                                    categoryFilter === 'llm'
                                        ? 'bg-green-600 text-white'
                                        : 'bg-green-100 hover:bg-green-200 text-green-700'
                                }`}
                            >
                                LLM ({allTraces.filter((t) => t.name.startsWith('llm.')).length})
                            </button>
                            <button
                                onClick={() => setCategoryFilter('tools')}
                                className={`px-3 py-1 rounded text-sm transition-colors ${
                                    categoryFilter === 'tools'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                                }`}
                            >
                                Tools (
                                {allTraces.filter((t) => t.name.startsWith('mcp.tool.')).length})
                            </button>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Traces Table */}
            <Card
                title={`${categoryFilter === 'all' ? 'All' : categoryFilter.charAt(0).toUpperCase() + categoryFilter.slice(1)} Traces (${traces.length})`}
            >
                {traces.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No traces found</div>
                ) : (
                    <Table
                        data={traces.slice(0, 50)}
                        columns={[
                            {
                                header: 'Name',
                                accessor: (row) => (
                                    <span
                                        className={`text-sm ${
                                            row.name.startsWith('agent.')
                                                ? 'text-blue-600 font-medium'
                                                : row.name.startsWith('llm.')
                                                  ? 'text-green-600 font-medium'
                                                  : row.name.startsWith('mcp.tool.')
                                                    ? 'text-purple-600 font-medium'
                                                    : 'text-gray-900'
                                        }`}
                                    >
                                        {row.name}
                                    </span>
                                ),
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
                                header: 'Time',
                                accessor: (row) => new Date(row.startTime).toLocaleString(),
                            },
                        ]}
                        onRowClick={(row) => setSelectedTraceId(row.id)}
                    />
                )}
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
                                    <p className="text-sm font-medium text-gray-600">Span Name</p>
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
                                <div>
                                    <p className="text-sm font-medium text-gray-600">Trace ID</p>
                                    <p className="mt-1 text-sm font-mono text-xs text-gray-900">
                                        {selectedTrace.traceId}
                                    </p>
                                </div>
                                {selectedTrace.sessionId && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-600">
                                            Session ID
                                        </p>
                                        <p className="mt-1 text-sm font-mono text-xs text-gray-900">
                                            {selectedTrace.sessionId}
                                        </p>
                                    </div>
                                )}
                                {selectedTrace.provider && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-600">
                                            Provider
                                        </p>
                                        <p className="mt-1 text-sm text-gray-900 capitalize">
                                            {selectedTrace.provider}
                                        </p>
                                    </div>
                                )}
                                {selectedTrace.model && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-600">Model</p>
                                        <p className="mt-1 text-sm text-gray-900">
                                            {selectedTrace.model}
                                        </p>
                                    </div>
                                )}
                                {selectedTrace.toolName && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-600">
                                            Tool Name
                                        </p>
                                        <p className="mt-1 text-sm text-gray-900">
                                            {selectedTrace.toolName}
                                        </p>
                                    </div>
                                )}
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
                                        <div className="max-h-96 overflow-y-auto">
                                            <pre className="bg-gray-50 rounded-md p-4 text-xs">
                                                {JSON.stringify(selectedTrace.attributes, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                            <button
                                onClick={() => setSelectedTraceId(null)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
                            >
                                Close
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
