import React from 'react';
import {
    BarChart as RechartsBarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { chartColors } from '../../lib/theme';

interface BarChartProps {
    data: any[];
    dataKeys: { key: string; name: string; color?: string }[];
    xKey: string;
    height?: number;
    showGrid?: boolean;
    showLegend?: boolean;
    horizontal?: boolean;
    stacked?: boolean;
    formatYAxis?: (value: any) => string;
    formatXAxis?: (value: any) => string;
    formatTooltip?: (value: any) => string;
}

export function BarChart({
    data,
    dataKeys,
    xKey,
    height = 300,
    showGrid = true,
    showLegend = true,
    horizontal = false,
    stacked = false,
    formatYAxis,
    formatXAxis,
    formatTooltip,
}: BarChartProps) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <RechartsBarChart
                data={data}
                layout={horizontal ? 'vertical' : 'horizontal'}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
                {horizontal ? (
                    <>
                        <XAxis
                            type="number"
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            tickFormatter={formatXAxis}
                            stroke="#9ca3af"
                        />
                        <YAxis
                            type="category"
                            dataKey={xKey}
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            tickFormatter={formatYAxis}
                            stroke="#9ca3af"
                            width={100}
                        />
                    </>
                ) : (
                    <>
                        <XAxis
                            dataKey={xKey}
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            tickFormatter={formatXAxis}
                            stroke="#9ca3af"
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            tickFormatter={formatYAxis}
                            stroke="#9ca3af"
                        />
                    </>
                )}
                <Tooltip
                    contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        fontSize: '12px',
                    }}
                    formatter={formatTooltip}
                />
                {showLegend && <Legend />}
                {dataKeys.map((item, index) => (
                    <Bar
                        key={item.key}
                        dataKey={item.key}
                        name={item.name}
                        stackId={stacked ? 'stack' : undefined}
                        fill={item.color || chartColors.series[index % chartColors.series.length]}
                        radius={[4, 4, 0, 0]}
                    />
                ))}
            </RechartsBarChart>
        </ResponsiveContainer>
    );
}
