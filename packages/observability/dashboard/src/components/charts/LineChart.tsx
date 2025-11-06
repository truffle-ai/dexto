import React from 'react';
import {
    LineChart as RechartsLineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { chartColors } from '../../lib/theme';

interface LineChartProps {
    data: any[];
    dataKeys: { key: string; name: string; color?: string }[];
    xKey: string;
    height?: number;
    showGrid?: boolean;
    showLegend?: boolean;
    formatYAxis?: (value: any) => string;
    formatXAxis?: (value: any) => string;
    formatTooltip?: (value: any) => string;
}

export function LineChart({
    data,
    dataKeys,
    xKey,
    height = 300,
    showGrid = true,
    showLegend = true,
    formatYAxis,
    formatXAxis,
    formatTooltip,
}: LineChartProps) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <RechartsLineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
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
                    <Line
                        key={item.key}
                        type="monotone"
                        dataKey={item.key}
                        name={item.name}
                        stroke={item.color || chartColors.series[index % chartColors.series.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                ))}
            </RechartsLineChart>
        </ResponsiveContainer>
    );
}
