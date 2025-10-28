import { notFound } from 'next/navigation';
import ChatApp from '../../../components/ChatApp';

interface ChatPageProps {
  params: Promise<{
    sessionId: string;
  }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { sessionId } = await params;

  // Validate sessionId format (basic validation)
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    notFound();
  }

  return <ChatApp sessionId={sessionId} />;
}

// Generate metadata for the page
export async function generateMetadata({ params }: ChatPageProps) {
  const { sessionId } = await params;
  
  return {
    title: "Dexto Web UI",
    description: `Chat session ${sessionId}`,
  };
}
