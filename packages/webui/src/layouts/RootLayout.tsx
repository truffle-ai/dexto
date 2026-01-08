import { Outlet } from '@tanstack/react-router';
import { HelmetProvider, Helmet } from 'react-helmet-async';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { AnalyticsProvider } from '@/lib/analytics/index';
import { EventBusProvider } from '@/components/providers/EventBusProvider';
import { ApprovalProvider } from '@/components/hooks/ApprovalContext';
import { ChatProvider } from '@/components/hooks/ChatContext';
import { SpeechReset } from '@/components/ui/speech-reset';
import { ToastContainer } from '@/components/Toast/ToastContainer';

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
                    <EventBusProvider>
                        <ApprovalProvider>
                            <ChatProvider>
                                <SpeechReset />
                                <div className="flex h-screen w-screen flex-col supports-[height:100svh]:h-[100svh] supports-[height:100dvh]:h-[100dvh]">
                                    <Outlet />
                                </div>
                                <ToastContainer />
                            </ChatProvider>
                        </ApprovalProvider>
                    </EventBusProvider>
                </AnalyticsProvider>
            </QueryProvider>
        </HelmetProvider>
    );
}
