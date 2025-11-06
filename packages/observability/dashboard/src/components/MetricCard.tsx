import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Sparkline } from './Sparkline';

interface MetricCardProps {
    label: string;
    value: string | number;
    trend?: {
        value: number;
        direction: 'up' | 'down' | 'neutral';
    };
    sparkline?: number[];
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'purple' | 'red' | 'yellow' | 'gray';
}

const colorClasses = {
    blue: {
        bg: 'bg-blue-50',
        text: 'text-blue-600',
        border: 'border-blue-200',
    },
    green: {
        bg: 'bg-green-50',
        text: 'text-green-600',
        border: 'border-green-200',
    },
    purple: {
        bg: 'bg-purple-50',
        text: 'text-purple-600',
        border: 'border-purple-200',
    },
    red: {
        bg: 'bg-red-50',
        text: 'text-red-600',
        border: 'border-red-200',
    },
    yellow: {
        bg: 'bg-yellow-50',
        text: 'text-yellow-600',
        border: 'border-yellow-200',
    },
    gray: {
        bg: 'bg-gray-50',
        text: 'text-gray-600',
        border: 'border-gray-200',
    },
};

const sparklineColors = {
    blue: '#3b82f6',
    green: '#22c55e',
    purple: '#8b5cf6',
    red: '#ef4444',
    yellow: '#f59e0b',
    gray: '#6b7280',
};

export function MetricCard({
    label,
    value,
    trend,
    sparkline,
    icon,
    color = 'blue',
}: MetricCardProps) {
    const colors = colorClasses[color];
    const sparklineColor = sparklineColors[color];

    const getTrendIcon = () => {
        if (!trend) return null;
        switch (trend.direction) {
            case 'up':
                return <TrendingUp className="w-4 h-4" />;
            case 'down':
                return <TrendingDown className="w-4 h-4" />;
            case 'neutral':
                return <Minus className="w-4 h-4" />;
        }
    };

    const getTrendColor = () => {
        if (!trend) return '';
        switch (trend.direction) {
            case 'up':
                return 'text-green-600';
            case 'down':
                return 'text-red-600';
            case 'neutral':
                return 'text-gray-600';
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={`relative overflow-hidden rounded-xl border ${colors.border} ${colors.bg} p-6 shadow-sm hover:shadow-md transition-shadow`}
        >
            {/* Icon */}
            {icon && <div className={`mb-3 ${colors.text}`}>{icon}</div>}

            {/* Label */}
            <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>

            {/* Value */}
            <div className="flex items-baseline justify-between">
                <motion.p
                    key={value}
                    initial={{ scale: 1.1 }}
                    animate={{ scale: 1 }}
                    className={`text-3xl font-bold ${colors.text}`}
                >
                    {value}
                </motion.p>

                {/* Trend */}
                {trend && (
                    <div
                        className={`flex items-center gap-1 text-sm font-medium ${getTrendColor()}`}
                    >
                        {getTrendIcon()}
                        <span>{Math.abs(trend.value)}%</span>
                    </div>
                )}
            </div>

            {/* Sparkline */}
            {sparkline && sparkline.length > 0 && (
                <div className="mt-4 -mx-2">
                    <Sparkline data={sparkline} color={sparklineColor} width={200} height={32} />
                </div>
            )}
        </motion.div>
    );
}
