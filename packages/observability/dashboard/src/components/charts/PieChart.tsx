import React from 'react';
import {
    PieChart as RechartsPieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { chartColors } from '../../lib/theme';

interface PieChartProps {
    data: { name: string; value: number }[];
    height?: number;
    showLegend?: boolean;
    colors?: string[];
    formatTooltip?: (value: any) => string;
}

export function PieChart({
    data,
    height = 300,
    showLegend = true,
    colors = chartColors.series,
    formatTooltip,
}: PieChartProps) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <RechartsPieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                </Pie>
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
            </RechartsPieChart>
        </ResponsiveContainer>
    );
}
