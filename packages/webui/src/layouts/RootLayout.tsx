import { Outlet } from '@tanstack/react-router';
import { HelmetProvider, Helmet } from 'react-helmet-async';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { AnalyticsProvider } from '@/lib/analytics/index';
import { ChatProvider } from '@/components/hooks/ChatContext';
import { SpeechReset } from '@/components/ui/speech-reset';

export function RootLayout() {
    return (
        <HelmetProvider>
            <Helmet>
                <title>Dexto Web UI</title>
                <meta
                    name="description"
                    content="Interactive playground for testing MCP tools and talking to AI agents"
                />
            </Helmet>
            <QueryProvider>
                <AnalyticsProvider>
                    <ChatProvider>
                        <SpeechReset />
                        <div className="flex h-screen w-screen flex-col supports-[height:100svh]:h-[100svh] supports-[height:100dvh]:h-[100dvh]">
                            <Outlet />
                        </div>
                    </ChatProvider>
                </AnalyticsProvider>
            </QueryProvider>
        </HelmetProvider>
    );
}
