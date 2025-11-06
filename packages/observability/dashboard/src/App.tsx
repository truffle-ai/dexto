import React, { useState } from 'react';
import { useHealth, useTraces } from './lib/hooks';
import { Sidebar } from './components/Sidebar';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Sessions } from './pages/Sessions';
import { Traces } from './pages/Traces';
import { Tools } from './pages/Tools';
import { Errors } from './pages/Errors';

type TabName = 'overview' | 'sessions' | 'traces' | 'tools' | 'errors';

export function App() {
    const [activeTab, setActiveTab] = useState<TabName>('overview');

    // Fetch data for sidebar
    const { data: healthData } = useHealth();
    const { data: tracesData } = useTraces({ pageSize: 100 });

    // Calculate active sessions for sidebar
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentTraces = tracesData?.data?.traces || [];
    const activeSessions = new Set(
        recentTraces
            .filter((t) => t.endTime >= fiveMinutesAgo && t.sessionId)
            .map((t) => t.sessionId)
    ).size;

    return (
        <Layout>
            <div className="flex min-h-screen">
                {/* Sidebar */}
                <Sidebar
                    activeTab={activeTab}
                    onTabChange={(tab) => setActiveTab(tab as TabName)}
                    activeSessions={activeSessions}
                    totalTraces={healthData?.data?.telemetry.traceCount || 0}
                />

                {/* Main Content */}
                <main className="flex-1 ml-64 p-8">
                    {activeTab === 'overview' && <Overview />}
                    {activeTab === 'sessions' && <Sessions />}
                    {activeTab === 'traces' && <Traces />}
                    {activeTab === 'tools' && <Tools />}
                    {activeTab === 'errors' && <Errors />}
                </main>
            </div>
        </Layout>
    );
}
