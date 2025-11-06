import React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface SparklineProps {
    data: number[];
    color?: string;
    width?: number;
    height?: number;
}

export function Sparkline({ data, color = '#3b82f6', width = 80, height = 24 }: SparklineProps) {
    const chartData = data.map((value, index) => ({ value, index }));

    return (
        <ResponsiveContainer width={width} height={height}>
            <LineChart data={chartData}>
                <Line
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
