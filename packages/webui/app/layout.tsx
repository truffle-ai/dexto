import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChatProvider } from '../components/hooks/ChatContext';
import { SpeechReset } from "../components/ui/speech-reset";
import { cookies } from 'next/headers';

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
  return (
    <html lang="en" className={isDark ? 'dark' : ''}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ChatProvider>
          <SpeechReset />
          <div className="flex h-screen w-screen flex-col">{children}</div>
        </ChatProvider>
      </body>
    </html>
  );
}
