---
sidebar_position: 2
---

# React Chat App using Dexto

When you run `dexto` (web is the default mode), you get a powerful backend server with REST APIs and Server-Sent Events (SSE) for real-time streaming. Let's build a React chat application step by step, introducing each API capability as we go.

:::tip Port Configuration
By default, Dexto runs the Web UI on port 3000 and the API server on port 3001. All code examples in this tutorial use `http://localhost:3001` for API calls.

To customize ports:
- `dexto --web-port 8080` (API on 8081)
- `dexto --web-port 8080 --api-port 9000` (explicit API port)
:::

## Available Dexto Server APIs

When Dexto runs in web mode, it provides these endpoints:

- **`POST /api/message-sync`** - Send message and get complete response
- **`POST /api/message-stream`** - Send message and stream response via SSE (response IS the stream)
- **`POST /api/reset`** - Reset conversation history
- **`POST /api/mcp/servers`** - Dynamically add new MCP servers
- **`GET /api/mcp/servers`** - List connected servers
- **`GET /api/mcp/servers/:serverId/tools`** - List tools for a server
- **`POST /api/mcp/servers/:serverId/tools/:toolName/execute`** - Execute specific tools

For the complete API reference including sessions, LLM management, webhooks, and more, see the **[REST API Documentation](/api/rest/)**.

Let's start simple and build up our React app layer by layer.

## Layer 1: Basic Synchronous Chat

Start with the simplest possible chat interface using the synchronous API:

```typescript
// components/BasicChat.tsx
import React, { useState } from 'react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
}

export const BasicChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    if (!currentInput.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      content: currentInput,
      sender: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setCurrentInput('');
    setIsLoading(true);

    try {
      // Call Dexto's synchronous API
      const response = await fetch('http://localhost:3001/api/message-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentInput })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Add agent response
        const agentMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: result.response,
          sender: 'agent',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, agentMessage]);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `Error: ${error.message}`,
        sender: 'agent',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="mb-4 p-4 bg-blue-50 rounded">
        <h1 className="text-2xl font-bold">Dexto Chat - Basic Version</h1>
        <p className="text-sm text-gray-600">Using synchronous API</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <div className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg animate-pulse">
              🤔 Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !currentInput.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
};
```

**What we've learned:**
- Basic API communication with Dexto
- Simple request/response pattern
- Error handling basics

## Layer 2: Add Real-time Streaming

Now let's add Server-Sent Events (SSE) support for real-time streaming responses:

```typescript
// components/StreamingChat.tsx
import React, { useState, useRef } from 'react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
  isStreaming?: boolean;
}

export const StreamingChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Helper to connect to SSE stream
  const connectToStream = (streamUrl: string) => {
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('llm:thinking', () => {
      setIsStreaming(true);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          content: '🤔 Thinking...',
          sender: 'agent',
          timestamp: new Date(),
          isStreaming: true
        }
      ]);
    });

    eventSource.addEventListener('llm:chunk', (event) => {
      const data = JSON.parse(event.data);
      handleStreamChunk(data);
    });

    eventSource.addEventListener('llm:response', (event) => {
      const data = JSON.parse(event.data);
      setIsStreaming(false);
      // Mark the last message as complete
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.isStreaming) {
          last.isStreaming = false;
        }
        return updated;
      });
    });

    eventSource.addEventListener('llm:error', (event) => {
      const data = JSON.parse(event.data);
      console.error('Stream error:', data);
      setIsStreaming(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setIsStreaming(false);
      eventSource.close();
    };
  };

  const handleStreamChunk = (data: any) => {
    const content = data.content || '';
    
    setMessages(prev => {
      const newMessages = [...prev];
      const lastMessage = newMessages[newMessages.length - 1];
      
      if (lastMessage && lastMessage.sender === 'agent' && lastMessage.isStreaming) {
        // Replace "Thinking..." with actual content or append to existing content
        if (lastMessage.content === '🤔 Thinking...') {
          lastMessage.content = content;
        } else {
          lastMessage.content += content;
        }
      } else {
        // Create new streaming message
        newMessages.push({
          id: Date.now().toString(),
          content,
          sender: 'agent',
          timestamp: new Date(),
          isStreaming: true
        });
      }
      
      return newMessages;
    });
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || isStreaming) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      content: currentInput,
      sender: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    const messageToSend = currentInput;
    setCurrentInput('');

    try {
      // Send message and get stream URL
      const response = await fetch('http://localhost:3001/api/message-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageToSend, stream: true })
      });

      if (response.ok) {
        const { streamUrl } = await response.json();
        connectToStream(`http://localhost:3001${streamUrl}`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content: `❌ Error: ${error.message}`,
        sender: 'agent',
        timestamp: new Date()
      }]);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="mb-4 p-4 bg-blue-50 rounded">
        <h1 className="text-2xl font-bold">Dexto Chat - Streaming Version</h1>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          <span className="text-sm text-gray-600">
            {isConnected ? 'Connected to Dexto' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-800'
              } ${message.isStreaming ? 'animate-pulse border-2 border-blue-300' : ''}`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <div className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString()}
                {message.isStreaming && ' • Streaming...'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={!isConnected}
        />
        <button
          onClick={sendMessage}
          disabled={!isConnected || !currentInput.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
};
```

**What we've added:**
- Server-Sent Events (SSE) for streaming
- Real-time streaming responses  
- Stream status indicator
- Auto-reconnection logic

## Layer 3: Add Server Management

Now let's add the ability to see and manage MCP servers:

```typescript
// components/ServerManagementChat.tsx
import React, { useState, useEffect, useRef } from 'react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
  isStreaming?: boolean;
}

interface Server {
  id: string;
  name: string;
  status: string;
}

export const ServerManagementChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
  const [showServerPanel, setShowServerPanel] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  // SSE stream connection helper (same as Layer 2)
  const connectToStream = (streamUrl: string) => {
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('llm:thinking', () => setIsStreaming(true));
    eventSource.addEventListener('llm:chunk', (event) => {
      const data = JSON.parse(event.data);
      handleStreamChunk(data);
    });
    eventSource.addEventListener('llm:response', () => setIsStreaming(false));
    eventSource.onerror = () => {
      setIsStreaming(false);
      eventSource.close();
    };
  };

  const handleStreamChunk = (data: any) => {
    // Same implementation as Layer 2
    const content = data.content || '';
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.sender === 'agent' && last.isStreaming) {
        return [...prev.slice(0, -1), { ...last, content: last.content + content }];
      }
      return [...prev, {
        id: Date.now().toString(),
        content,
        sender: 'agent',
        timestamp: new Date(),
        isStreaming: true
      }];
    });
  };

  // Fetch available servers
  const fetchServers = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/mcp/servers');
      if (response.ok) {
        const data = await response.json();
        setServers(data.servers);
      }
    } catch (error) {
      console.error('Failed to fetch servers:', error);
    }
  };

  // Add a new server
  const addServer = async () => {
    const name = prompt('Server name (e.g., "my-tool"):');
    const command = prompt('Command (e.g., "npx"):');
    const argsInput = prompt('Arguments (comma-separated, e.g., "-y, @company/tool-server"):');
    
    if (!name || !command) return;

    const args = argsInput ? argsInput.split(',').map(s => s.trim()) : [];

    try {
      const response = await fetch('http://localhost:3001/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          config: {
            type: 'stdio',
            command,
            args
          }
        })
      });

      if (response.ok) {
        await fetchServers(); // Refresh server list
        alert(`✅ Successfully connected ${name}!`);
      } else {
        const error = await response.text();
        alert(`❌ Failed to connect server: ${error}`);
      }
    } catch (error) {
      console.error('Error connecting server:', error);
      alert(`❌ Error: ${error.message}`);
    }
  };

  const handleDextoEvent = (data: any) => {
    switch (data.event) {
      case 'thinking':
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          content: '🤔 Thinking...',
          sender: 'agent',
          timestamp: new Date(),
          isStreaming: true
        }]);
        break;

      case 'chunk':
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          
          if (lastMessage && lastMessage.sender === 'agent' && lastMessage.isStreaming) {
            if (lastMessage.content === '🤔 Thinking...') {
              lastMessage.content = data.data.content;
            } else {
              lastMessage.content += data.data.content;
            }
          }
          return newMessages;
        });
        break;

      case 'toolCall':
        // Show when agent uses a tool
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          content: `🔧 Using tool: ${data.data.toolName}`,
          sender: 'agent',
          timestamp: new Date()
        }]);
        break;

      case 'response':
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          
          if (lastMessage && lastMessage.sender === 'agent' && lastMessage.isStreaming) {
            lastMessage.isStreaming = false;
            lastMessage.content = data.data.content;
          }
          return newMessages;
        });
        break;
    }
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || !isConnected) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: currentInput,
      sender: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    wsRef.current?.send(JSON.stringify({
      type: 'message',
      content: currentInput
    }));

    setCurrentInput('');
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      {/* Header */}
      <div className="mb-4 p-4 bg-blue-50 rounded">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Dexto Chat - With Server Management</h1>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="text-sm text-gray-600">
                {isConnected ? 'Connected to Dexto' : 'Connecting...'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowServerPanel(!showServerPanel)}
              className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              {showServerPanel ? 'Hide' : 'Show'} Servers
            </button>
            <button
              onClick={addServer}
              className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Add Server
            </button>
          </div>
        </div>
      </div>

      {/* Server Panel */}
      {showServerPanel && (
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <h3 className="font-semibold mb-2">Connected Servers ({servers.length}):</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {servers.map(server => (
              <div key={server.id} className="flex justify-between items-center p-2 bg-white rounded border">
                <span className="font-medium">{server.name}</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  server.status === 'connected' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  {server.status}
                </span>
              </div>
            ))}
            {servers.length === 0 && (
              <div className="col-span-2 text-gray-500 text-center py-4">
                No servers connected. Click "Add Server" to connect one!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-500 text-white'
                  : message.content.startsWith('🔧')
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-gray-200 text-gray-800'
              } ${message.isStreaming ? 'animate-pulse border-2 border-blue-300' : ''}`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <div className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString()}
                {message.isStreaming && ' • Streaming...'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={!isConnected}
        />
        <button
          onClick={sendMessage}
          disabled={!isConnected || !currentInput.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
};
```

**What we've added:**
- Server listing and management
- Dynamic server connection
- Tool usage indicators
- Collapsible server panel

## Layer 4: Add Direct Tool Execution

Finally, let's add the ability to execute tools directly:

```typescript
// Add this to the previous component or create AdvancedChat.tsx

const [availableTools, setAvailableTools] = useState<Record<string, any[]>>({});
const [showToolPanel, setShowToolPanel] = useState(false);

// Fetch tools for each server
const fetchServerTools = async (serverId: string) => {
  try {
    const response = await fetch(`http://localhost:3001/api/mcp/servers/${serverId}/tools`);
    if (response.ok) {
      const data = await response.json();
      setAvailableTools(prev => ({
        ...prev,
        [serverId]: data.tools
      }));
    }
  } catch (error) {
    console.error(`Failed to fetch tools for ${serverId}:`, error);
  }
};

// Execute a tool directly
const executeTool = async (serverId: string, toolName: string) => {
  const args = prompt(`Enter arguments for ${toolName} (JSON format):`);
  let parsedArgs = {};
  
  if (args) {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      alert('Invalid JSON format');
      return;
    }
  }

  try {
    const response = await fetch(
      `http://localhost:3001/api/mcp/servers/${serverId}/tools/${toolName}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedArgs)
      }
    );

    if (response.ok) {
      const result = await response.json();
      
      // Add tool result as a message
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content: `🔧 Tool Result (${toolName}):\n${JSON.stringify(result.data, null, 2)}`,
        sender: 'agent',
        timestamp: new Date()
      }]);
    } else {
      alert('Tool execution failed');
    }
  } catch (error) {
    console.error('Error executing tool:', error);
    alert(`Error: ${error.message}`);
  }
};

// Update fetchServers to also fetch tools
const fetchServers = async () => {
  try {
    const response = await fetch('http://localhost:3001/api/mcp/servers');
    if (response.ok) {
      const data = await response.json();
      setServers(data.servers);
      
      // Fetch tools for each connected server
      data.servers.forEach((server: Server) => {
        if (server.status === 'connected') {
          fetchServerTools(server.id);
        }
      });
    }
  } catch (error) {
    console.error('Failed to fetch servers:', error);
  }
};

// Add this to your JSX after the server panel:
{showToolPanel && (
  <div className="mb-4 p-3 bg-yellow-50 rounded">
    <h3 className="font-semibold mb-2">Available Tools:</h3>
    <div className="space-y-2">
      {Object.entries(availableTools).map(([serverId, tools]) => (
        <div key={serverId} className="border rounded p-2">
          <h4 className="font-medium text-sm text-gray-700 mb-1">{serverId}:</h4>
          <div className="flex flex-wrap gap-1">
            {tools.map((tool: any) => (
              <button
                key={tool.name}
                onClick={() => executeTool(serverId, tool.name)}
                className="px-2 py-1 bg-yellow-200 hover:bg-yellow-300 rounded text-xs"
                title={tool.description}
              >
                {tool.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
)}

// Add tool panel toggle to your header buttons:
<button
  onClick={() => setShowToolPanel(!showToolPanel)}
  className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
>
  {showToolPanel ? 'Hide' : 'Show'} Tools
</button>
```

## Summary: Progressive API Usage

We've built up our React app layer by layer:

1. **Layer 1**: Basic synchronous messaging (`/api/message-sync`)
2. **Layer 2**: Real-time streaming (Server-Sent Events)
3. **Layer 3**: Server management (`/api/mcp/servers`)
4. **Layer 4**: Direct tool execution (`/api/mcp/servers/:serverId/tools/:toolName/execute`)

## Key Takeaways

### 🎯 **Start Simple**
- Begin with synchronous API calls
- Add complexity gradually
- Each layer builds on the previous

### 🔗 **API Progression**
- **Synchronous** → **Streaming** → **Management** → **Direct Control**
- Each API serves different use cases
- Mix and match based on your needs

### 🛠 **Real-world Usage**
- Most apps start with layers 1-2
- Server management (layer 3) is for power users
- Direct tool execution (layer 4) is for advanced integrations

### 📈 **Scaling Considerations**
- Cache server/tool information
- Handle connection states gracefully
- Implement proper error boundaries
- Consider user permission levels

Start with Layer 1 for your first integration, then add layers as your application grows!

---

**Next Steps**: Try building the basic version first, then gradually add each layer. For production patterns, see [Advanced Patterns](./advanced-patterns.md). 