import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { GitBranch, Clock, AlertCircle, Filter, Search } from 'lucide-react';
import { useTraces, useAutoRefresh } from '../lib/hooks';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import { SidePanel } from '../components/SidePanel';
import { formatRelativeTime } from '../lib/utils';
import type { Trace } from '../lib/types';

export function Traces() {
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [timeWindow, setTimeWindow] = useState('24h');
    const [searchQuery, setSearchQuery] = useState('');

    const {
        data: tracesData,
        loading: tracesLoading,
        refetch,
    } = useTraces({
        window: timeWindow,
        pageSize: 1000,
    });

    useAutoRefresh(refetch, 10000);

    const allTraces = tracesData?.data?.traces || [];

    // Filter and categorize traces
    const filteredTraces = useMemo(() => {
        let traces = allTraces;

        // Category filter
        if (categoryFilter !== 'all') {
            traces = traces.filter((t) => {
                if (categoryFilter === 'agent') return t.name.startsWith('agent.');
                if (categoryFilter === 'llm') return t.name.startsWith('llm.');
                if (categoryFilter === 'tools') return t.name.startsWith('mcp.tool.');
                return true;
            });
        }

        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            traces = traces.filter(
                (t) =>
                    t.name.toLowerCase().includes(query) ||
                    t.sessionId?.toLowerCase().includes(query) ||
                    t.provider?.toLowerCase().includes(query) ||
                    t.model?.toLowerCase().includes(query) ||
                    t.toolName?.toLowerCase().includes(query)
            );
        }

        return traces;
    }, [allTraces, categoryFilter, searchQuery]);

    // Calculate category counts
    const categoryCounts = useMemo(
        () => ({
            all: allTraces.length,
            agent: allTraces.filter((t) => t.name.startsWith('agent.')).length,
            llm: allTraces.filter((t) => t.name.startsWith('llm.')).length,
            tools: allTraces.filter((t) => t.name.startsWith('mcp.tool.')).length,
        }),
        [allTraces]
    );

    const selectedTrace = filteredTraces.find((t) => t.id === selectedTraceId);

    if (tracesLoading) {
        return <Loading text="Loading traces..." />;
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Traces"
                description="Explore individual spans and execution details"
            />

            {/* Filters */}
            <Card>
                <div className="space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name, session, provider, model..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-4 flex-wrap">
                        {/* Category Filter */}
                        <div className="flex gap-2">
                            {[
                                { id: 'all', label: 'All', color: 'gray' },
                                { id: 'agent', label: 'Agent', color: 'blue' },
                                { id: 'llm', label: 'LLM', color: 'green' },
                                { id: 'tools', label: 'Tools', color: 'purple' },
                            ].map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategoryFilter(cat.id)}
                                    className={`
                    px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${
                        categoryFilter === cat.id
                            ? `bg-${cat.color}-600 text-white shadow-md`
                            : `bg-${cat.color}-50 text-${cat.color}-700 hover:bg-${cat.color}-100`
                    }
                  `}
                                >
                                    {cat.label} (
                                    {categoryCounts[cat.id as keyof typeof categoryCounts]})
                                </button>
                            ))}
                        </div>

                        {/* Time Window */}
                        <select
                            value={timeWindow}
                            onChange={(e) => setTimeWindow(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        >
                            <option value="1h">Last Hour</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                        </select>
                    </div>
                </div>
            </Card>

            {/* Traces List */}
            <Card title={`Traces (${filteredTraces.length})`}>
                {filteredTraces.length === 0 ? (
                    <div className="text-center py-16">
                        <GitBranch className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-lg font-medium text-gray-500">No traces found</p>
                        <p className="mt-2 text-sm text-gray-400">Try adjusting your filters</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredTraces.slice(0, 50).map((trace, index) => {
                            const categoryBadge = trace.name.startsWith('agent.')
                                ? { variant: 'info' as const, text: 'Agent', color: 'blue' }
                                : trace.name.startsWith('llm.')
                                  ? { variant: 'success' as const, text: 'LLM', color: 'green' }
                                  : { variant: 'warning' as const, text: 'Tool', color: 'purple' };

                            return (
                                <motion.div
                                    key={trace.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.01 }}
                                    onClick={() => setSelectedTraceId(trace.id)}
                                    className={`
                    p-4 border-2 rounded-lg cursor-pointer transition-all
                    hover:shadow-md hover:scale-[1.01]
                    ${
                        selectedTraceId === trace.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                    }
                  `}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <Badge variant={categoryBadge.variant}>
                                                {categoryBadge.text}
                                            </Badge>

                                            <span
                                                className={`text-sm font-medium truncate text-${categoryBadge.color}-600`}
                                            >
                                                {trace.name}
                                            </span>

                                            {trace.status.code !== 0 && (
                                                <Badge variant="error">Error</Badge>
                                            )}

                                            {trace.sessionId && (
                                                <span className="text-xs text-gray-500 font-mono">
                                                    {trace.sessionId.slice(0, 8)}
                                                </span>
                                            )}

                                            {trace.provider && (
                                                <span className="text-xs text-gray-500 capitalize">
                                                    {trace.provider}
                                                </span>
                                            )}

                                            {trace.model && (
                                                <span className="text-xs text-gray-500">
                                                    {trace.model}
                                                </span>
                                            )}

                                            {trace.toolName && (
                                                <span className="text-xs text-gray-500">
                                                    {trace.toolName}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="font-medium">{trace.duration}ms</span>
                                            <span className="whitespace-nowrap">
                                                {formatRelativeTime(trace.endTime)}
                                            </span>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}

                        {filteredTraces.length > 50 && (
                            <p className="text-center text-sm text-gray-500 pt-4">
                                Showing 50 of {filteredTraces.length} traces
                            </p>
                        )}
                    </div>
                )}
            </Card>

            {/* Trace Details Side Panel */}
            <SidePanel
                isOpen={!!selectedTraceId && !!selectedTrace}
                onClose={() => setSelectedTraceId(null)}
                title="Trace Details"
                width="lg"
            >
                {selectedTrace && (
                    <div className="space-y-6">
                        {/* Span Name */}
                        <div>
                            <p className="text-sm text-gray-600 mb-2">Span Name</p>
                            <p className="text-lg font-semibold text-gray-900">
                                {selectedTrace.name}
                            </p>
                        </div>

                        {/* Key Metrics */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-blue-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Duration</p>
                                <p className="mt-2 text-2xl font-bold text-blue-600">
                                    {selectedTrace.duration}ms
                                </p>
                            </div>
                            <div
                                className={`rounded-lg p-4 ${
                                    selectedTrace.status.code === 0 ? 'bg-green-50' : 'bg-red-50'
                                }`}
                            >
                                <p className="text-sm text-gray-600">Status</p>
                                <div className="mt-2">
                                    <Badge
                                        variant={
                                            selectedTrace.status.code === 0 ? 'success' : 'error'
                                        }
                                    >
                                        {selectedTrace.status.code === 0 ? 'OK' : 'ERROR'}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        {/* Identifiers */}
                        <div className="space-y-3">
                            <div>
                                <p className="text-xs text-gray-500 mb-1">Span ID</p>
                                <p className="text-sm font-mono bg-gray-50 p-2 rounded break-all">
                                    {selectedTrace.id}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 mb-1">Trace ID</p>
                                <p className="text-sm font-mono bg-gray-50 p-2 rounded break-all">
                                    {selectedTrace.traceId}
                                </p>
                            </div>
                            {selectedTrace.sessionId && (
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Session ID</p>
                                    <p className="text-sm font-mono bg-gray-50 p-2 rounded break-all">
                                        {selectedTrace.sessionId}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* LLM Details */}
                        {(selectedTrace.provider || selectedTrace.model) && (
                            <div className="border-t border-gray-200 pt-4">
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                    LLM Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {selectedTrace.provider && (
                                        <div>
                                            <p className="text-xs text-gray-500">Provider</p>
                                            <p className="mt-1 text-sm font-medium capitalize">
                                                {selectedTrace.provider}
                                            </p>
                                        </div>
                                    )}
                                    {selectedTrace.model && (
                                        <div>
                                            <p className="text-xs text-gray-500">Model</p>
                                            <p className="mt-1 text-sm font-medium">
                                                {selectedTrace.model}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tool Details */}
                        {selectedTrace.toolName && (
                            <div className="border-t border-gray-200 pt-4">
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                    Tool Details
                                </h4>
                                <p className="text-sm">{selectedTrace.toolName}</p>
                            </div>
                        )}

                        {/* Error Message */}
                        {selectedTrace.errorMessage && (
                            <div className="border-t border-gray-200 pt-4">
                                <h4 className="text-sm font-semibold text-red-600 mb-3">
                                    Error Message
                                </h4>
                                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                    <p className="text-sm text-red-900">
                                        {selectedTrace.errorMessage}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Timing */}
                        <div className="border-t border-gray-200 pt-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Timing</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Started</span>
                                    <span className="font-medium">
                                        {new Date(selectedTrace.startTime).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Ended</span>
                                    <span className="font-medium">
                                        {new Date(selectedTrace.endTime).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Attributes */}
                        {selectedTrace.attributes &&
                            Object.keys(selectedTrace.attributes).length > 0 && (
                                <div className="border-t border-gray-200 pt-4">
                                    <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                        Attributes
                                    </h4>
                                    <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto">
                                        <pre className="text-xs font-mono">
                                            {JSON.stringify(selectedTrace.attributes, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            )}
                    </div>
                )}
            </SidePanel>
        </div>
    );
}
