import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChatProvider } from '../components/hooks/ChatContext';
import { SpeechReset } from "../components/ui/speech-reset";
import { cookies } from 'next/headers';
import { loadState, isAnalyticsDisabled, DEFAULT_POSTHOG_KEY, DEFAULT_POSTHOG_HOST } from '@dexto/analytics';
import { AnalyticsProvider } from '../lib/analytics/index.js';
import { QueryProvider } from '../components/providers/QueryProvider.js';
import packageJson from '../package.json';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// TODO(unify-fonts): We currently load Nunito via globals.css and also
// register Geist via next/font (variables). Only Nunito is applied to
// the html element by default, so two font pipelines coexist. Unify to
// a single pipeline (either next/font everywhere or CSS @import only)
// and then remove the fonts-ready autosize workaround in InputArea.

export const metadata: Metadata = {
  // Use a default title and a template for nested routes
  title: {
    default: "Dexto Web UI",
    template: "%s · Dexto",
  },
  description:
    "Interactive playground for testing MCP tools and talking to AI agents",
  icons: {
    // Use the new transparent SVG logo for favicons
    icon: [
      { url: "/logos/dexto/dexto_logo_icon.svg", type: "image/svg+xml" }
    ],
    shortcut: [{ url: "/logos/dexto/dexto_logo_icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/logos/dexto/dexto_logo_icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Dexto",
    description:
      "Interactive playground for testing MCP tools and talking to AI agents",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Dexto",
    description:
      "Interactive playground for testing MCP tools and talking to AI agents",
  },
  // Tell browsers we explicitly support both light and dark modes
  // This prevents Chrome's Auto Dark Mode from interfering
  other: {
    'color-scheme': 'light dark',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read initial theme from cookie so SSR markup matches client hydration
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get('theme')?.value;
  const isDark = themeCookie ? themeCookie === 'dark' : true; // default dark

  // Inject API port from server-side env var into client-side global
  const apiPort = process.env.API_PORT;

  // Load analytics configuration server-side
  const analyticsEnabled = !isAnalyticsDisabled();
  let analyticsConfig: { distinctId: string; posthogKey: string; posthogHost: string; appVersion: string } | null = null;

  if (analyticsEnabled) {
    try {
      const state = await loadState();
      analyticsConfig = {
        distinctId: state.distinctId,
        posthogKey: process.env.DEXTO_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY,
        posthogHost: process.env.DEXTO_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
        appVersion: packageJson.version,
      };
    } catch (error) {
      // If analytics state loading fails, silently disable analytics
      console.error('Failed to load analytics state:', error);
      analyticsConfig = null;
    }
  }

  return (
    <html lang="en" className={isDark ? 'dark' : ''}>
      <head>
        {apiPort && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__DEXTO_API_PORT__ = ${JSON.stringify(apiPort)};`,
            }}
          />
        )}
        {analyticsConfig && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__DEXTO_ANALYTICS__ = ${JSON.stringify(analyticsConfig)};`,
            }}
          />
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <QueryProvider>
          <AnalyticsProvider>
            <ChatProvider>
              <SpeechReset />
              <div className="flex h-screen w-screen flex-col supports-[height:100svh]:h-[100svh] supports-[height:100dvh]:h-[100dvh]">{children}</div>
            </ChatProvider>
          </AnalyticsProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
