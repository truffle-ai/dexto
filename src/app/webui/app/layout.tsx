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

export const metadata: Metadata = {
  title: "Dexto",
  description: "Interactive playground for testing MCP tools and talking to AI agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read initial theme from cookie so SSR markup matches client hydration
  const themeCookie = cookies().get('theme')?.value;
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
