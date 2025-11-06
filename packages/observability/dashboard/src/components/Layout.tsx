import React from 'react';
import { motion } from 'framer-motion';

interface LayoutProps {
    children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50"
        >
            {children}
        </motion.div>
    );
}

interface PageHeaderProps {
    title: string;
    description: string;
    actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-8"
        >
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
                    <p className="text-gray-600">{description}</p>
                </div>
                {actions && <div className="flex gap-3">{actions}</div>}
            </div>
        </motion.div>
    );
}
