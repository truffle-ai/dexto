import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, TrendingDown, Clock, Activity } from 'lucide-react';
import { useTraces, useMetrics, useAutoRefresh } from '../lib/hooks';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import { SidePanel } from '../components/SidePanel';
import { BarChart } from '../components/charts/BarChart';
import { AreaChart } from '../components/charts/AreaChart';
import { formatRelativeTime } from '../lib/utils';
import type { Trace } from '../lib/types';

export function Errors() {
    const [selectedErrorGroup, setSelectedErrorGroup] = useState<string | null>(null);

    const {
        data: tracesData,
        loading: tracesLoading,
        refetch: refetchTraces,
    } = useTraces({
        pageSize: 1000,
    });
    const {
        data: metricsData,
        loading: metricsLoading,
        refetch: refetchMetrics,
    } = useMetrics({
        window: '24h',
    });

    useAutoRefresh(() => {
        refetchTraces();
        refetchMetrics();
    }, 10000);

    const allTraces = tracesData?.data?.traces || [];
    const metrics = metricsData?.data;

    // Get error traces
    const errorTraces = useMemo(() => {
        return allTraces.filter((t) => t.status.code !== 0);
    }, [allTraces]);

    // Group errors by message
    const errorGroups = useMemo(() => {
        const groups = new Map<string, Trace[]>();

        errorTraces.forEach((trace) => {
            const message = trace.errorMessage || trace.status.message || 'Unknown error';
            const existing = groups.get(message) || [];
            groups.set(message, [...existing, trace]);
        });

        return Array.from(groups.entries())
            .map(([message, traces]) => ({
                message,
                count: traces.length,
                traces,
                affectedSessions: new Set(traces.map((t) => t.sessionId).filter(Boolean)).size,
                lastOccurrence: Math.max(...traces.map((t) => t.endTime)),
                firstOccurrence: Math.min(...traces.map((t) => t.startTime)),
                spanNames: [...new Set(traces.map((t) => t.name))],
            }))
            .sort((a, b) => b.count - a.count);
    }, [errorTraces]);

    const selectedGroup = errorGroups.find((g) => g.message === selectedErrorGroup);

    // Error timeline data
    const errorTimeline = useMemo(() => {
        const now = Date.now();
        const hours = 24;
        const hourMs = 60 * 60 * 1000;

        return Array.from({ length: hours }, (_, i) => {
            const bucketStart = now - (hours - i) * hourMs;
            const bucketEnd = bucketStart + hourMs;
            const errorsInBucket = errorTraces.filter(
                (t) => t.endTime >= bucketStart && t.endTime < bucketEnd
            );

            return {
                time: new Date(bucketStart).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                }),
                errors: errorsInBucket.length,
            };
        });
    }, [errorTraces]);

    // Errors by category
    const errorsByCategory = useMemo(() => {
        const categories = {
            agent: errorTraces.filter((t) => t.name.startsWith('agent.')).length,
            llm: errorTraces.filter((t) => t.name.startsWith('llm.')).length,
            tools: errorTraces.filter((t) => t.name.startsWith('mcp.tool.')).length,
            other: errorTraces.filter(
                (t) =>
                    !t.name.startsWith('agent.') &&
                    !t.name.startsWith('llm.') &&
                    !t.name.startsWith('mcp.tool.')
            ).length,
        };

        return Object.entries(categories)
            .filter(([_, count]) => count > 0)
            .map(([name, count]) => ({
                name: name.charAt(0).toUpperCase() + name.slice(1),
                errors: count,
            }));
    }, [errorTraces]);

    if (tracesLoading || metricsLoading) {
        return <Loading text="Loading errors..." />;
    }

    const errorRate = (metrics?.errorRate || 0) * 100;
    const avgErrorDuration =
        errorTraces.length > 0
            ? Math.round(errorTraces.reduce((sum, t) => sum + t.duration, 0) / errorTraces.length)
            : 0;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Errors"
                description="Monitor and diagnose errors across your agent"
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <AlertCircle className="w-5 h-5 text-red-600" />
                        <span className="text-sm font-medium text-gray-600">Total Errors</span>
                    </div>
                    <p className="text-3xl font-bold text-red-600">{errorTraces.length}</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <TrendingDown className="w-5 h-5 text-orange-600" />
                        <span className="text-sm font-medium text-gray-600">Error Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{errorRate.toFixed(2)}%</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <Activity className="w-5 h-5 text-purple-600" />
                        <span className="text-sm font-medium text-gray-600">Error Groups</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{errorGroups.length}</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <Clock className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-gray-600">Avg Duration</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{avgErrorDuration}ms</p>
                </motion.div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Error Timeline */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <Card title="Error Timeline (24h)">
                        {errorTimeline.length > 0 ? (
                            <div className="mt-4">
                                <AreaChart
                                    data={errorTimeline}
                                    dataKeys={[{ key: 'errors', name: 'Errors', color: '#ef4444' }]}
                                    xKey="time"
                                    height={250}
                                />
                            </div>
                        ) : (
                            <div className="h-64 flex items-center justify-center text-gray-500">
                                No error data available
                            </div>
                        )}
                    </Card>
                </motion.div>

                {/* Errors by Category */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <Card title="Errors by Category">
                        {errorsByCategory.length > 0 ? (
                            <div className="mt-4">
                                <BarChart
                                    data={errorsByCategory}
                                    dataKeys={[{ key: 'errors', name: 'Errors', color: '#ef4444' }]}
                                    xKey="name"
                                    height={250}
                                />
                            </div>
                        ) : (
                            <div className="h-64 flex items-center justify-center text-gray-500">
                                No error data available
                            </div>
                        )}
                    </Card>
                </motion.div>
            </div>

            {/* Error Groups */}
            <Card title={`Error Groups (${errorGroups.length})`}>
                {errorGroups.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <p className="text-lg font-medium text-gray-900">No errors detected</p>
                        <p className="mt-2 text-sm text-gray-500">
                            Your agent is running smoothly with no errors in the last 24 hours
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {errorGroups.map((group, index) => (
                            <motion.div
                                key={group.message}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                onClick={() => setSelectedErrorGroup(group.message)}
                                className={`
                  p-5 border-2 rounded-xl cursor-pointer transition-all
                  hover:shadow-md hover:scale-[1.01]
                  ${
                      selectedErrorGroup === group.message
                          ? 'border-red-500 bg-red-50 shadow-md'
                          : 'border-red-200 hover:border-red-300 bg-white'
                  }
                `}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        {/* Error Message */}
                                        <div className="flex items-center gap-3 mb-3">
                                            <Badge variant="error">{group.count} occurrences</Badge>
                                            {group.affectedSessions > 0 && (
                                                <Badge variant="default">
                                                    {group.affectedSessions} sessions
                                                </Badge>
                                            )}
                                        </div>

                                        <p className="text-sm font-medium text-red-900 mb-2">
                                            {group.message}
                                        </p>

                                        {/* Span Names */}
                                        <div className="flex gap-2 flex-wrap">
                                            {group.spanNames.slice(0, 3).map((name) => (
                                                <span
                                                    key={name}
                                                    className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded"
                                                >
                                                    {name}
                                                </span>
                                            ))}
                                            {group.spanNames.length > 3 && (
                                                <span className="text-xs text-gray-500">
                                                    +{group.spanNames.length - 3} more
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Timestamp */}
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500">Last seen</div>
                                        <div className="mt-1 text-xs font-medium text-red-600">
                                            {formatRelativeTime(group.lastOccurrence)}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Error Group Details Side Panel */}
            <SidePanel
                isOpen={!!selectedErrorGroup && !!selectedGroup}
                onClose={() => setSelectedErrorGroup(null)}
                title="Error Group Details"
                width="lg"
            >
                {selectedGroup && (
                    <div className="space-y-6">
                        {/* Error Message */}
                        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                            <p className="text-sm font-medium text-red-900">
                                {selectedGroup.message}
                            </p>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-gray-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Occurrences</p>
                                <p className="mt-2 text-2xl font-bold text-gray-900">
                                    {selectedGroup.count}
                                </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Affected Sessions</p>
                                <p className="mt-2 text-2xl font-bold text-gray-900">
                                    {selectedGroup.affectedSessions}
                                </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Span Types</p>
                                <p className="mt-2 text-2xl font-bold text-gray-900">
                                    {selectedGroup.spanNames.length}
                                </p>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div className="border-t border-gray-200 pt-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">First Occurrence</span>
                                    <span className="font-medium">
                                        {new Date(selectedGroup.firstOccurrence).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Last Occurrence</span>
                                    <span className="font-medium">
                                        {new Date(selectedGroup.lastOccurrence).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Affected Spans */}
                        <div className="border-t border-gray-200 pt-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                Affected Spans
                            </h4>
                            <div className="space-y-2">
                                {selectedGroup.spanNames.map((name) => (
                                    <div key={name} className="flex items-center gap-2 text-sm">
                                        <Badge variant="default">{name}</Badge>
                                        <span className="text-gray-600">
                                            (
                                            {
                                                selectedGroup.traces.filter((t) => t.name === name)
                                                    .length
                                            }
                                            )
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recent Occurrences */}
                        <div className="border-t border-gray-200 pt-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                Recent Occurrences
                            </h4>
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {selectedGroup.traces.slice(0, 10).map((trace) => (
                                    <div key={trace.id} className="bg-gray-50 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-medium text-gray-900">
                                                {trace.name}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                {formatRelativeTime(trace.endTime)}
                                            </span>
                                        </div>
                                        {trace.sessionId && (
                                            <p className="text-xs text-gray-600 font-mono">
                                                Session: {trace.sessionId.slice(0, 16)}...
                                            </p>
                                        )}
                                    </div>
                                ))}
                                {selectedGroup.traces.length > 10 && (
                                    <p className="text-xs text-center text-gray-500 pt-2">
                                        +{selectedGroup.traces.length - 10} more occurrences
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </SidePanel>
        </div>
    );
}
