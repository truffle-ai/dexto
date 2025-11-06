import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Wrench, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useTraces, useMetrics, useAutoRefresh } from '../lib/hooks';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Loading } from '../components/Loading';
import { BarChart } from '../components/charts/BarChart';
import { PieChart } from '../components/charts/PieChart';

export function Tools() {
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

    // Calculate tool statistics
    const toolStats = useMemo(() => {
        const stats = new Map<
            string,
            { total: number; errors: number; totalDuration: number; durations: number[] }
        >();

        allTraces
            .filter((t) => t.toolName)
            .forEach((trace) => {
                const existing = stats.get(trace.toolName!) || {
                    total: 0,
                    errors: 0,
                    totalDuration: 0,
                    durations: [],
                };

                stats.set(trace.toolName!, {
                    total: existing.total + 1,
                    errors: existing.errors + (trace.status.code !== 0 ? 1 : 0),
                    totalDuration: existing.totalDuration + trace.duration,
                    durations: [...existing.durations, trace.duration],
                });
            });

        return Array.from(stats.entries())
            .map(([tool, data]) => ({
                name: tool,
                calls: data.total,
                errors: data.errors,
                successRate: ((data.total - data.errors) / data.total) * 100,
                avgDuration: Math.round(data.totalDuration / data.total),
                p95Duration: Math.round(
                    data.durations.sort((a, b) => a - b)[
                        Math.floor(data.durations.length * 0.95)
                    ] || 0
                ),
            }))
            .sort((a, b) => b.calls - a.calls);
    }, [allTraces]);

    // Top tools for bar chart
    const topToolsData = useMemo(() => {
        return toolStats.slice(0, 10).map((t) => ({
            name: t.name.length > 15 ? t.name.slice(0, 15) + '...' : t.name,
            calls: t.calls,
            errors: t.errors,
        }));
    }, [toolStats]);

    // Success rate distribution for pie chart
    const successRateData = useMemo(() => {
        const excellent = toolStats.filter((t) => t.successRate >= 95).length;
        const good = toolStats.filter((t) => t.successRate >= 80 && t.successRate < 95).length;
        const poor = toolStats.filter((t) => t.successRate < 80).length;

        return [
            { name: 'Excellent (≥95%)', value: excellent },
            { name: 'Good (80-95%)', value: good },
            { name: 'Poor (<80%)', value: poor },
        ].filter((d) => d.value > 0);
    }, [toolStats]);

    if (tracesLoading || metricsLoading) {
        return <Loading text="Loading tools..." />;
    }

    const totalCalls = metrics?.toolCalls?.total || 0;
    const overallSuccessRate = (metrics?.toolCalls?.successRate || 0) * 100;
    const avgDuration =
        toolStats.length > 0
            ? Math.round(
                  toolStats.reduce((sum, t) => sum + t.avgDuration * t.calls, 0) / totalCalls
              )
            : 0;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tools"
                description="Monitor MCP tool usage, performance, and reliability"
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <Wrench className="w-5 h-5 text-purple-600" />
                        <span className="text-sm font-medium text-gray-600">Total Calls</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">
                        {totalCalls.toLocaleString()}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-medium text-gray-600">Unique Tools</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{toolStats.length}</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <span className="text-sm font-medium text-gray-600">Success Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">
                        {overallSuccessRate.toFixed(1)}%
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
                >
                    <div className="flex items-center gap-3 mb-2">
                        <Clock className="w-5 h-5 text-orange-600" />
                        <span className="text-sm font-medium text-gray-600">Avg Duration</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{avgDuration}ms</p>
                </motion.div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Tools */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <Card title="Top 10 Most Used Tools">
                        {topToolsData.length > 0 ? (
                            <div className="mt-4">
                                <BarChart
                                    data={topToolsData}
                                    dataKeys={[
                                        { key: 'calls', name: 'Total Calls', color: '#8b5cf6' },
                                        { key: 'errors', name: 'Errors', color: '#ef4444' },
                                    ]}
                                    xKey="name"
                                    height={300}
                                    horizontal
                                />
                            </div>
                        ) : (
                            <div className="h-64 flex items-center justify-center text-gray-500">
                                No tool data available
                            </div>
                        )}
                    </Card>
                </motion.div>

                {/* Success Rate Distribution */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <Card title="Tools by Success Rate">
                        {successRateData.length > 0 ? (
                            <div className="mt-4">
                                <PieChart
                                    data={successRateData}
                                    height={300}
                                    colors={['#22c55e', '#f59e0b', '#ef4444']}
                                />
                            </div>
                        ) : (
                            <div className="h-64 flex items-center justify-center text-gray-500">
                                No tool data available
                            </div>
                        )}
                    </Card>
                </motion.div>
            </div>

            {/* Tool Details Table */}
            <Card title="Tool Performance Details">
                {toolStats.length === 0 ? (
                    <div className="text-center py-16">
                        <Wrench className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-lg font-medium text-gray-500">No tool usage data</p>
                        <p className="mt-2 text-sm text-gray-400">
                            Tool metrics will appear once the agent uses MCP tools
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        Tool Name
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        Total Calls
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        Success Rate
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        Avg Duration
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        P95 Duration
                                    </th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                        Errors
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {toolStats.map((tool, index) => (
                                    <motion.tr
                                        key={tool.name}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.02 }}
                                        className="hover:bg-gray-50 transition-colors"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {tool.name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                            {tool.calls.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                            <span
                                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                    tool.successRate >= 95
                                                        ? 'bg-green-100 text-green-800'
                                                        : tool.successRate >= 80
                                                          ? 'bg-yellow-100 text-yellow-800'
                                                          : 'bg-red-100 text-red-800'
                                                }`}
                                            >
                                                {tool.successRate.toFixed(1)}%
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                            {tool.avgDuration}ms
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                                            {tool.p95Duration}ms
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                            {tool.errors > 0 ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                    {tool.errors}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">0</span>
                                            )}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
