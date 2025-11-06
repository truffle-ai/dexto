import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Clock, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { useTraces, useAutoRefresh } from '../lib/hooks';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Loading } from '../components/Loading';
import { SidePanel } from '../components/SidePanel';
import { BarChart } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { formatDuration, formatRelativeTime } from '../lib/utils';
import type { Trace } from '../lib/types';

export function Sessions() {
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const { data: tracesData, loading: tracesLoading, refetch } = useTraces({ pageSize: 1000 });

    useAutoRefresh(refetch, 10000);

    const allTraces = tracesData?.data?.traces || [];

    // Group traces by sessionId
    const sessions = useMemo(() => {
        const sessionMap = new Map<string, Trace[]>();

        allTraces.forEach((trace) => {
            if (trace.sessionId) {
                const existing = sessionMap.get(trace.sessionId) || [];
                sessionMap.set(trace.sessionId, [...existing, trace]);
            }
        });

        // Build session summaries
        return Array.from(sessionMap.entries())
            .map(([sessionId, traces]) => {
                const agentRuns = traces.filter((t) => t.name === 'agent.run');
                const llmCalls = traces.filter((t) => t.name.startsWith('llm.'));
                const toolCalls = traces.filter((t) => t.name.startsWith('mcp.tool.'));
                const errorCount = traces.filter((t) => t.status.code !== 0).length;
                const totalDuration = traces.reduce((sum, t) => sum + t.duration, 0);

                const providers = [...new Set(traces.map((t) => t.provider).filter(Boolean))];
                const models = [...new Set(traces.map((t) => t.model).filter(Boolean))];

                return {
                    sessionId,
                    traces,
                    spanCount: traces.length,
                    agentRunCount: agentRuns.length,
                    llmCallCount: llmCalls.length,
                    toolCallCount: toolCalls.length,
                    errorCount,
                    errorRate: errorCount / traces.length,
                    totalDuration,
                    avgDuration: Math.round(totalDuration / traces.length),
                    providers,
                    models,
                    lastActive: Math.max(...traces.map((t) => t.endTime)),
                    firstActive: Math.min(...traces.map((t) => t.startTime)),
                };
            })
            .sort((a, b) => b.lastActive - a.lastActive);
    }, [allTraces]);

    const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);

    // Activity timeline data for selected session
    const sessionTimeline = useMemo(() => {
        if (!selectedSession) return [];

        const traces = selectedSession.traces;
        const minTime = Math.min(...traces.map((t) => t.startTime));
        const maxTime = Math.max(...traces.map((t) => t.endTime));
        const duration = maxTime - minTime;
        const bucketCount = 20;
        const bucketSize = duration / bucketCount;

        return Array.from({ length: bucketCount }, (_, i) => {
            const bucketStart = minTime + i * bucketSize;
            const bucketEnd = bucketStart + bucketSize;
            const tracesInBucket = traces.filter(
                (t) => t.startTime >= bucketStart && t.startTime < bucketEnd
            );

            return {
                time: `+${Math.round((bucketStart - minTime) / 1000)}s`,
                count: tracesInBucket.length,
                errors: tracesInBucket.filter((t) => t.status.code !== 0).length,
            };
        });
    }, [selectedSession]);

    if (tracesLoading) {
        return <Loading text="Loading sessions..." />;
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Sessions"
                description="Monitor session-based agent activity and trace hierarchies"
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <Activity className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-gray-600">Total Sessions</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{sessions.length}</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <TrendingUp className="w-5 h-5 text-green-600" />
                        <span className="text-sm font-medium text-gray-600">Avg Spans/Session</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">
                        {sessions.length > 0
                            ? Math.round(
                                  sessions.reduce((sum, s) => sum + s.spanCount, 0) /
                                      sessions.length
                              )
                            : 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <span className="text-sm font-medium text-gray-600">Healthy Sessions</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">
                        {sessions.filter((s) => s.errorCount === 0).length}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                        <span className="text-sm font-medium text-gray-600">
                            Sessions w/ Errors
                        </span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">
                        {sessions.filter((s) => s.errorCount > 0).length}
                    </p>
                </motion.div>
            </div>

            {/* Sessions List */}
            <Card title={`Active Sessions (${sessions.length})`}>
                {sessions.length === 0 ? (
                    <div className="text-center py-16">
                        <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-lg font-medium text-gray-500">No sessions found</p>
                        <p className="mt-2 text-sm text-gray-400">
                            Sessions will appear once the agent processes requests
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {sessions.map((session, index) => (
                            <motion.div
                                key={session.sessionId}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                onClick={() => setSelectedSessionId(session.sessionId)}
                                className={`
                  p-5 border-2 rounded-xl cursor-pointer transition-all
                  hover:shadow-md hover:scale-[1.01]
                  ${
                      selectedSessionId === session.sessionId
                          ? 'border-blue-500 bg-blue-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                  }
                `}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        {/* Session ID & Badges */}
                                        <div className="flex items-center gap-3 mb-3">
                                            <span className="font-mono text-sm font-semibold text-gray-900">
                                                {session.sessionId.slice(0, 20)}...
                                            </span>
                                            <Badge variant="info">{session.spanCount} spans</Badge>
                                            {session.errorCount > 0 && (
                                                <Badge variant="error">
                                                    {session.errorCount} errors
                                                </Badge>
                                            )}
                                            {session.errorCount === 0 && (
                                                <Badge variant="success">Healthy</Badge>
                                            )}
                                        </div>

                                        {/* Metrics Grid */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                                            <div>
                                                <span className="text-gray-500">Agent Runs</span>
                                                <div className="mt-1 font-semibold text-blue-600">
                                                    {session.agentRunCount}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">LLM Calls</span>
                                                <div className="mt-1 font-semibold text-green-600">
                                                    {session.llmCallCount}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Tool Calls</span>
                                                <div className="mt-1 font-semibold text-purple-600">
                                                    {session.toolCallCount}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-gray-500">Avg Duration</span>
                                                <div className="mt-1 font-semibold text-gray-900">
                                                    {session.avgDuration}ms
                                                </div>
                                            </div>
                                        </div>

                                        {/* Models & Providers */}
                                        {(session.providers.length > 0 ||
                                            session.models.length > 0) && (
                                            <div className="flex gap-6 text-xs text-gray-500">
                                                {session.providers.length > 0 && (
                                                    <span>
                                                        Providers: {session.providers.join(', ')}
                                                    </span>
                                                )}
                                                {session.models.length > 0 && (
                                                    <span>Models: {session.models.join(', ')}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Timestamp */}
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500">
                                            {formatRelativeTime(session.lastActive)}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-400">
                                            {new Date(session.lastActive).toLocaleTimeString()}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Session Details Side Panel */}
            <SidePanel
                isOpen={!!selectedSessionId && !!selectedSession}
                onClose={() => setSelectedSessionId(null)}
                title={`Session Details`}
                width="lg"
            >
                {selectedSession && (
                    <div className="space-y-6">
                        {/* Session ID */}
                        <div>
                            <p className="text-sm text-gray-600 mb-2">Session ID</p>
                            <p className="font-mono text-sm bg-gray-50 p-3 rounded-lg break-all">
                                {selectedSession.sessionId}
                            </p>
                        </div>

                        {/* Key Metrics */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-blue-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Total Spans</p>
                                <p className="mt-2 text-3xl font-bold text-blue-600">
                                    {selectedSession.spanCount}
                                </p>
                            </div>
                            <div className="bg-purple-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Avg Duration</p>
                                <p className="mt-2 text-3xl font-bold text-purple-600">
                                    {selectedSession.avgDuration}ms
                                </p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Success Rate</p>
                                <p className="mt-2 text-3xl font-bold text-green-600">
                                    {((1 - selectedSession.errorRate) * 100).toFixed(1)}%
                                </p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-4">
                                <p className="text-sm text-gray-600">Errors</p>
                                <p className="mt-2 text-3xl font-bold text-red-600">
                                    {selectedSession.errorCount}
                                </p>
                            </div>
                        </div>

                        {/* Activity Timeline */}
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                Activity Timeline
                            </h4>
                            <BarChart
                                data={sessionTimeline}
                                dataKeys={[
                                    { key: 'count', name: 'Spans', color: '#3b82f6' },
                                    { key: 'errors', name: 'Errors', color: '#ef4444' },
                                ]}
                                xKey="time"
                                height={200}
                                stacked
                            />
                        </div>

                        {/* Breakdown */}
                        <div className="border-t border-gray-200 pt-6">
                            <h4 className="text-sm font-semibold text-gray-900 mb-4">
                                Span Breakdown
                            </h4>
                            <div className="space-y-3">
                                {[
                                    {
                                        label: 'Agent Runs',
                                        value: selectedSession.agentRunCount,
                                        color: 'blue',
                                        icon: Activity,
                                    },
                                    {
                                        label: 'LLM Calls',
                                        value: selectedSession.llmCallCount,
                                        color: 'green',
                                        icon: Activity,
                                    },
                                    {
                                        label: 'Tool Calls',
                                        value: selectedSession.toolCallCount,
                                        color: 'purple',
                                        icon: Activity,
                                    },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        className="flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div
                                                className={`w-3 h-3 rounded-full bg-${item.color}-500`}
                                            />
                                            <span className="text-sm text-gray-700">
                                                {item.label}
                                            </span>
                                        </div>
                                        <span
                                            className={`text-sm font-semibold text-${item.color}-600`}
                                        >
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Time Range */}
                        <div className="border-t border-gray-200 pt-6">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                Active Period
                            </h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Started</span>
                                    <span className="font-medium">
                                        {new Date(selectedSession.firstActive).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Last Activity</span>
                                    <span className="font-medium">
                                        {new Date(selectedSession.lastActive).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Duration</span>
                                    <span className="font-medium">
                                        {formatDuration(
                                            selectedSession.lastActive - selectedSession.firstActive
                                        )}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </SidePanel>
        </div>
    );
}
