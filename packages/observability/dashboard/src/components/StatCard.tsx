import React from 'react';

interface StatCardProps {
    label: string;
    value: string | number;
    trend?: { value: number; isPositive: boolean };
    icon?: React.ReactNode;
    className?: string;
}

export function StatCard({ label, value, trend, icon, className = '' }: StatCardProps) {
    return (
        <div className={`bg-white rounded-lg border border-gray-200 shadow-sm p-6 ${className}`}>
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600">{label}</p>
                    <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
                    {trend && (
                        <p
                            className={`mt-2 text-sm font-medium ${
                                trend.isPositive ? 'text-green-600' : 'text-red-600'
                            }`}
                        >
                            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
                        </p>
                    )}
                </div>
                {icon && <div className="flex-shrink-0 text-gray-400">{icon}</div>}
            </div>
        </div>
    );
}
