import React from 'react';
import { motion } from 'framer-motion';
import {
    Activity,
    LayoutDashboard,
    Boxes,
    GitBranch,
    Wrench,
    AlertCircle,
    Circle,
    Server,
} from 'lucide-react';

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    activeSessions: number;
    totalTraces: number;
}

const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, color: 'blue' },
    { id: 'sessions', label: 'Sessions', icon: Boxes, color: 'purple' },
    { id: 'traces', label: 'Traces', icon: GitBranch, color: 'green' },
    { id: 'tools', label: 'Tools', icon: Wrench, color: 'orange' },
    { id: 'errors', label: 'Errors', icon: AlertCircle, color: 'red' },
];

export function Sidebar({ activeTab, onTabChange, activeSessions, totalTraces }: SidebarProps) {
    return (
        <div className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 shadow-sm">
            {/* Logo/Brand */}
            <div className="h-16 flex items-center px-6 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Server className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-gray-900">Dexto</h1>
                        <p className="text-xs text-gray-500">Observability</p>
                    </div>
                </div>
            </div>

            {/* Status */}
            <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                    <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="w-2 h-2 bg-green-500 rounded-full"
                    />
                    <span className="text-sm font-medium text-gray-900">System Online</span>
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Active Sessions</span>
                        <span className="font-semibold text-blue-600">{activeSessions}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Total Traces</span>
                        <span className="font-semibold text-gray-900">
                            {totalTraces.toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="px-3 py-4">
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;

                        return (
                            <motion.button
                                key={item.id}
                                onClick={() => onTabChange(item.id)}
                                whileHover={{ x: 4 }}
                                whileTap={{ scale: 0.98 }}
                                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-lg
                  transition-all duration-200 group relative
                  ${
                      isActive
                          ? 'bg-blue-50 text-blue-600 shadow-sm'
                          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
                            >
                                {/* Active indicator */}
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 rounded-r-full"
                                    />
                                )}

                                <Icon className="w-5 h-5" />
                                <span className="font-medium text-sm">{item.label}</span>

                                {/* Badge for errors */}
                                {item.id === 'errors' && (
                                    <motion.div
                                        animate={{ scale: [1, 1.1, 1] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className="ml-auto w-2 h-2 bg-red-500 rounded-full"
                                    />
                                )}
                            </motion.button>
                        );
                    })}
                </div>
            </nav>

            {/* Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
                <div className="text-xs text-gray-500 text-center">v0.1.0 • Updated now</div>
            </div>
        </div>
    );
}
