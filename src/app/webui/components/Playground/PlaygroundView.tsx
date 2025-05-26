'use client';

import React, { useState, useEffect, useCallback, ChangeEvent, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ConnectServerModal from '../ConnectServerModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { JsonSchemaProperty, McpServer, McpTool, ToolResult } from '@/types';

export default function PlaygroundView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [toolInputs, setToolInputs] = useState<Record<string, any>>({});
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Combined loading state for simplicity
  const [currentError, setCurrentError] = useState<string | null>(null); // General error display
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  const API_BASE_URL = '/api'; // Assuming Next.js API routes are under /api

  // Ref to manage aborting in-flight tool fetch requests
  const toolsAbortControllerRef = useRef<AbortController | null>(null);
  // Ref to manage aborting in-flight tool execution requests
  const executionAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      toolsAbortControllerRef.current?.abort();
    };
  }, []);

  const handleError = (message: string, area?: 'servers' | 'tools' | 'execution' | 'input') => {
    console.error(`Playground Error (${area || 'general'}):`, message);
    if (area !== 'input') {
      setCurrentError(message);
    }
    // Potentially set area-specific errors if UI needs to show them differently
  };

  const fetchServers = useCallback(async () => {
    setIsLoading(true);
    setCurrentError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/mcp/servers`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch servers' }));
        throw new Error(errorData.error || `Server List: ${response.statusText}`);
      }
      const data = await response.json();
      setServers(data.servers || []);
      if (!data.servers || data.servers.length === 0) {
        // Not necessarily an error, could be no servers are configured
        console.log("No MCP servers found or returned from API.");
      }
    } catch (err: any) {
      handleError(err.message, 'servers');
      setServers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleServerSelect = useCallback(async (server: McpServer) => {
    // Abort any previous tool fetch
    toolsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    toolsAbortControllerRef.current = controller;
    setSelectedServer(server);
    setSelectedTool(null);
    setToolResult(null);
    setTools([]);
    setCurrentError(null); // Clear previous errors
    setInputErrors({});

    if (server.status !== 'connected') {
      // Not an error, just info. UI should reflect this.
      console.warn(`Server "${server.name}" is ${server.status}. Cannot fetch tools.`);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/mcp/servers/${server.id}/tools`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Failed to fetch tools for ${server.name}` }));
        throw new Error(errorData.error || `Tool List (${server.name}): ${response.statusText}`);
      }
      const data = await response.json();
      // Ignore stale responses after abort
      if (controller.signal.aborted) {
        return;
      }
      setTools(data.tools || []);
      if (!data.tools || data.tools.length === 0) {
        console.log(`No tools found for server "${server.name}".`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        handleError(err.message, 'tools');
        setTools([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleToolSelect = useCallback((tool: McpTool) => {
    setSelectedTool(tool);
    setToolResult(null);
    setCurrentError(null);
    setInputErrors({});
    const defaultInputs: Record<string, any> = {};
    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const key in tool.inputSchema.properties) {
        const prop = tool.inputSchema.properties[key];
        if (prop.default !== undefined) {
          defaultInputs[key] = prop.default;
        } else {
          // Set sensible defaults for form control
          if (prop.type === 'boolean') defaultInputs[key] = false;
          else if (prop.type === 'number' || prop.type === 'integer') defaultInputs[key] = ''; // Empty string for controlled number input
          else if (prop.type === 'object' || prop.type === 'array') defaultInputs[key] = ''; // Default to empty JSON string
          else defaultInputs[key] = '';
        }
      }
    }
    setToolInputs(defaultInputs);
  }, []);

  const handleInputChange = useCallback((inputName: string, value: any, type?: JsonSchemaProperty['type']) => {
    setToolInputs((prev) => ({ ...prev, [inputName]: value }));
    // Clear specific input error when user types
    if (inputErrors[inputName]) {
      setInputErrors(prev => ({...prev, [inputName]: ''}));
    }

    // Basic live validation for JSON
    if (type === 'object' || type === 'array') {
      if (value === '') return; // Allow empty for initial state or clearing
      try {
        JSON.parse(value);
      } catch (e) {
        setInputErrors(prev => ({...prev, [inputName]: 'Invalid JSON format'}));
        return;
      }
    }
  }, [inputErrors]);

  const validateInputs = (): boolean => {
    if (!selectedTool || !selectedTool.inputSchema || !selectedTool.inputSchema.properties) {
      return true; // No schema, no validation needed from frontend perspective
    }
    const currentInputErrors: Record<string, string> = {};
    let allValid = true;

    for (const key in selectedTool.inputSchema.properties) {
      const prop = selectedTool.inputSchema.properties[key];
      const value = toolInputs[key];

      if (selectedTool.inputSchema.required?.includes(key)) {
        if (value === undefined || value === '' || (prop.type === 'boolean' && typeof value !== 'boolean')) {
          currentInputErrors[key] = 'This field is required.';
          allValid = false;
          continue;
        }
      }
      
      if ((prop.type === 'number' || prop.type === 'integer') && value !== '' && isNaN(Number(value))) {
        currentInputErrors[key] = 'Must be a valid number.';
        allValid = false;
      }

      if ((prop.type === 'object' || prop.type === 'array') && value !== '') {
        try {
          JSON.parse(value as string);
        } catch (e) {
          currentInputErrors[key] = 'Invalid JSON format.';
          allValid = false;
        }
      }
    }
    setInputErrors(currentInputErrors);
    return allValid;
  };

  const handleExecuteTool = useCallback(async () => {
    if (!selectedServer || !selectedTool) {
      handleError("No server or tool selected for execution.", 'execution');
      return;
    }
    // Abort any previous execution
    executionAbortControllerRef.current?.abort();
    const controller = new AbortController();
    executionAbortControllerRef.current = controller;
    setCurrentError(null);
    setToolResult(null);

    if (!validateInputs()) {
      handleError("Please correct the input errors.", 'input');
      return;
    }

    setIsLoading(true);
    try {
      const processedInputs: Record<string, any> = {};
      if (selectedTool.inputSchema && selectedTool.inputSchema.properties) {
        for (const key in selectedTool.inputSchema.properties) {
          const prop = selectedTool.inputSchema.properties[key];
          let value = toolInputs[key];
          if (prop.type === 'number') {
            // For floats, allow decimal numbers
            value = (value === '') ? undefined : Number(value);
          } else if (prop.type === 'integer') {
            // For integers, ensure a whole number
            if (value === '') {
              value = undefined;
            } else {
              const num = Number(value);
              if (!Number.isInteger(num)) {
                // Surface validation error for integer fields
                setInputErrors(prev => ({ ...prev, [key]: 'Must be a valid integer.' }));
                setIsLoading(false);
                return;
              }
              value = num;
            }
          } else if (prop.type === 'boolean') {
            if (typeof value === 'string') {
              value = value === 'true';
            } else {
              value = Boolean(value);
            }
          } else if ((prop.type === 'object' || prop.type === 'array') && typeof value === 'string' && value.trim() !== '') {
            try {
              value = JSON.parse(value);
            } catch (e) {
              // This should have been caught by validateInputs, but as a safeguard:
              setInputErrors(prev => ({...prev, [key]: 'Invalid JSON before sending.'}));
              setIsLoading(false);
              return;
            }
          } else if ((prop.type === 'object' || prop.type === 'array') && (value === undefined || value === '')) {
            value = undefined; // Don't send empty string for objects/arrays, send undefined or omit
          }
          if (value !== undefined) { // Only include if value is defined (e.g. not empty string for optional number)
             processedInputs[key] = value;
          }
        }
      }
      
      const response = await fetch(
        `${API_BASE_URL}/mcp/servers/${selectedServer.id}/tools/${selectedTool.id}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(processedInputs),
          signal: controller.signal,
        }
      );
      
      const resultData = await response.json(); 
      if (!response.ok) {
        throw new Error(resultData.error || `Tool Execution (${selectedTool.name}): ${response.statusText}`);
      }
      setToolResult(resultData);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        handleError(err.message, 'execution');
        // Ensure toolResult reflects the error for display, even if backend structure was unexpected
        if (err.message && (!toolResult || toolResult.success || toolResult.error !== err.message)) {
          setToolResult({ success: false, error: err.message });
        }
      }
    } finally {
      // Only clear loading if this request wasn't aborted
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [selectedServer, selectedTool, toolInputs, validateInputs]);

  const renderFormInputs = () => {
    if (!selectedTool || !selectedTool.inputSchema || !selectedTool.inputSchema.properties) {
      return <p className="text-sm text-muted-foreground py-2">This tool does not require any inputs, or its input schema is not defined.</p>;
    }

    return Object.entries(selectedTool.inputSchema.properties).map(([key, prop]) => {
      const isRequired = selectedTool.inputSchema?.required?.includes(key);
      const errorMsg = inputErrors[key];

      let inputElement;
      const baseInputClassName = `w-full ${errorMsg ? 'border-destructive focus-visible:ring-destructive' : 'border-input'}`;

      if (prop.enum && Array.isArray(prop.enum)) {
        const isEnumBoolean = prop.enum.every((v) => typeof v === 'boolean');
        const isEnumNumeric = prop.enum.every((v) => typeof v === 'number');
        inputElement = (
          <Select 
            value={toolInputs[key] === undefined && prop.default !== undefined ? String(prop.default) : String(toolInputs[key] || '')}
            onValueChange={(value) => {
              let parsedValue: string | number | boolean = value;
              if (isEnumBoolean) {
                parsedValue = value === 'true';
              } else if (isEnumNumeric) {
                parsedValue = Number(value);
              }
              handleInputChange(key, parsedValue, prop.type);
            }}
            disabled={isLoading}
          >
            <SelectTrigger id={key} className={baseInputClassName}>
              <SelectValue placeholder={`Select ${prop.description || key}${isRequired ? '' : ' (optional)'}...`} />
            </SelectTrigger>
            <SelectContent>
              {prop.enum.map((enumValue) => (
                <SelectItem key={String(enumValue)} value={String(enumValue)}>
                  {String(enumValue)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      } else if (prop.type === 'boolean') {
        inputElement = (
          <Checkbox
            id={key}
            checked={toolInputs[key] === undefined && prop.default !== undefined ? Boolean(prop.default) : Boolean(toolInputs[key])}
            onCheckedChange={(checked) => handleInputChange(key, checked, prop.type)}
            disabled={isLoading}
            className={`${errorMsg ? 'border-destructive ring-destructive' : ''}`}
          />
        );
      } else if (prop.type === 'object' || prop.type === 'array') {
        inputElement = (
          <Textarea
            id={key}
            value={toolInputs[key] === undefined && prop.default !== undefined ? JSON.stringify(prop.default, null, 2) : toolInputs[key] || ''}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange(key, e.target.value, prop.type)}
            rows={5}
            className={`${baseInputClassName} font-mono text-sm min-h-[100px] resize-y`}
            placeholder={`Enter JSON for ${prop.description || key}`}
            disabled={isLoading}
          />
        );
      } else { // string, number, integer, or other formats like date-time, email
        let inputFieldType: React.HTMLInputTypeAttribute = 'text';
        if (prop.type === 'number' || prop.type === 'integer') inputFieldType = 'number';
        if (prop.format === 'date-time') inputFieldType = 'datetime-local';
        if (prop.format === 'date') inputFieldType = 'date';
        if (prop.format === 'email') inputFieldType = 'email';
        if (prop.format === 'uri') inputFieldType = 'url';
        if (prop.format === 'password') inputFieldType = 'password';

        inputElement = (
          <Input
            type={inputFieldType}
            id={key}
            value={toolInputs[key] === undefined && prop.default !== undefined ? String(prop.default) : String(toolInputs[key] || '')}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(key, e.target.value, prop.type)}
            className={baseInputClassName}
            placeholder={prop.description || `Enter ${key}`}
            disabled={isLoading}
            step={ (prop.type === 'number' || prop.type === 'integer') ? "any" : undefined }
          />
        );
      }

      return (
        <div key={key} className="grid gap-1.5">
           <div className={`flex ${prop.type === 'boolean' ? 'flex-row items-center space-x-3' : 'flex-col'}`}>
            <Label htmlFor={key} className={`${prop.type === 'boolean' ? 'leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70' : 'capitalize font-medium'}`}>
                {prop.description || key.replace(/([A-Z]+(?=[A-Z][a-z]))|([A-Z][a-z])/g, ' $&').trim().replace(/_/g, ' ')}
                {isRequired && <span className="text-destructive text-lg ml-0.5">*</span>}
            </Label>
            {prop.type === 'boolean' ? inputElement : <div className="w-full">{inputElement}</div>}
           </div>
          {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        </div>
      );
    });
  };

  const handleModalClose = () => {
    setIsConnectModalOpen(false);
    fetchServers(); // Refresh server list after modal closes
  };

  return (
    <div className="flex h-screen bg-muted/40 text-foreground antialiased">
      <aside className="w-72 flex-shrink-0 border-r border-border bg-background p-4 flex flex-col rounded-r-lg shadow-md">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
            <Link href="/">
                <Button variant="outline" size="sm" className="pl-2 pr-3" asChild>
                  <span>
                    <ArrowLeft className="h-4 w-4 mr-1.5" />
                    Back to Chat
                  </span>
                </Button>
            </Link>
        </div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold text-foreground px-1">MCP Servers</h2>
          {isLoading && servers.length === 0 && <p className="text-xs text-muted-foreground">Loading...</p>}
        </div>
        {currentError && servers.length === 0 && !isLoading && <p className="text-destructive text-sm p-2 bg-destructive/10 rounded-md">Error: {currentError}</p>}
        {servers.length === 0 && !isLoading && !currentError && <p className="text-muted-foreground text-sm px-1">No servers available.</p>}
        
        <div className="flex-grow overflow-y-auto space-y-1 pr-1 -mr-1">
            {servers.length > 0 && (
            <ul className="space-y-1">
                {servers.map(server => (
                <li key={server.id}
                    className={`p-2.5 rounded-md cursor-pointer hover:bg-muted transition-colors group 
                                ${selectedServer?.id === server.id ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-foreground hover:text-primary'}
                                ${server.status !== 'connected' ? 'opacity-60 cursor-not-allowed' : ''}`}
                    onClick={() => server.status === 'connected' && handleServerSelect(server)}
                    title={server.status !== 'connected' ? `${server.name} is ${server.status}` : server.name}>
                    <div className="flex justify-between items-center">
                    <span className="font-medium truncate group-hover:text-primary-foreground_conditional">
                        {server.name} 
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full 
                                    ${server.status === 'connected' ? 'bg-green-100 text-green-700 dark:bg-green-700/20 dark:text-green-400' 
                                    : (server.status === 'disconnected' ? 'bg-slate-100 text-slate-600 dark:bg-slate-700/20 dark:text-slate-400' 
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700/20 dark:text-yellow-400') }`}>
                    {server.status}
                    </span>
                    </div>
                </li>
                ))}
            </ul>
            )}
        </div>
        <Button 
          onClick={() => setIsConnectModalOpen(true)}
          variant="outline"
          className="mt-auto w-full sticky bottom-0 left-0 right-0 bg-background hover:bg-muted py-3">
          Connect New Server
        </Button>
      </aside>

      <section className="w-80 flex-shrink-0 border-r border-border bg-background p-4 flex flex-col rounded-l-none shadow-md">
        <div className="flex justify-between items-center pb-3 mb-3 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground px-1">Tools</h2>
          {selectedServer && selectedServer.status === 'connected' && isLoading && tools.length === 0 && <p className="text-xs text-muted-foreground">Loading...</p> }
        </div>
        <div className="flex-grow overflow-y-auto space-y-1 pr-1 -mr-1">
            {!selectedServer && <p className="text-muted-foreground text-sm px-1">Select a connected server to view tools.</p>}
            {selectedServer && selectedServer.status !== 'connected' && <p className="text-muted-foreground text-sm px-1">Server "{selectedServer.name}" is {selectedServer.status}. Tools unavailable.</p>}
            {selectedServer && selectedServer.status === 'connected' && !isLoading && tools.length === 0 && !currentError && 
            <p className="text-muted-foreground text-sm px-1">No tools found for {selectedServer.name}.</p>}
            {currentError && selectedServer?.status === 'connected' && tools.length === 0 && !isLoading && 
            <p className="text-destructive text-sm p-2 bg-destructive/10 rounded-md">Error loading tools: {currentError}</p>}
            
            {tools.length > 0 && (
            <ul className="space-y-1">
                {tools.map(tool => (
                <li key={tool.id}
                    className={`p-3 rounded-md cursor-pointer hover:bg-muted transition-colors group
                                ${selectedTool?.id === tool.id ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90' : 'text-foreground hover:text-primary'}`}
                    onClick={() => handleToolSelect(tool)}>
                    <h3 className="font-medium truncate group-hover:text-primary-foreground_conditional">{tool.name}</h3>
                    {tool.description && <p className="text-sm text-muted-foreground mt-0.5 group-hover:text-primary-foreground_conditional/80">{tool.description}</p>}
                </li>
                ))}
            </ul>
            )}
        </div>
      </section>

      <main className="flex-1 p-6 flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-y-auto">
        <div className="pb-3 mb-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">Tool Runner</h2>
        </div>
        {currentError && selectedTool && (!toolResult || !toolResult.success) && 
          <div className="mb-4 p-3 border border-destructive/50 bg-destructive/10 rounded-md text-destructive text-sm">
            <p className="font-medium">Error:</p>
            <p>{currentError}</p>
          </div>}
        
        {!selectedTool && <p className="text-muted-foreground text-sm text-center py-10">Select a tool to run from the list.</p>}
        {selectedTool && (
          <div className="space-y-6">
            <div className="p-4 border border-border rounded-lg bg-card shadow-sm">
              <h3 className="text-base font-semibold text-primary mb-1">{selectedTool.name}</h3>
              {selectedTool.description && <p className="text-sm text-muted-foreground">{selectedTool.description}</p>}
            </div>
            
            <form 
              onSubmit={(e) => { 
                e.preventDefault(); 
                if (validateInputs()) { handleExecuteTool(); }
              }}
              className="space-y-5 p-4 border border-border rounded-lg bg-card shadow-sm"
            >
              {renderFormInputs()}
              
              {selectedTool && (
                 <Button
                  type="submit"
                  disabled={isLoading || (selectedServer && selectedServer.status !== 'connected') || Object.keys(inputErrors).some(k => inputErrors[k] !== '')}
                  className="w-full sm:w-auto mt-3 py-2.5 px-6">
                  {isLoading ? 'Executing...' : 'Run Tool'}
                </Button>
              )}
            </form>

            {toolResult && (
              <div className="mt-6 p-4 border-t border-border bg-card rounded-lg shadow-sm">
                <h4 className="font-semibold mb-3 text-base">Result:</h4>
                {toolResult.success ? (
                  <div className="space-y-3 text-sm">
                    {(
                      (toolResult.metadata?.mimeType?.startsWith('image/') || toolResult.metadata?.type?.startsWith('image'))
                      || (toolResult.data && typeof toolResult.data === 'object' && Array.isArray((toolResult.data as any).content))
                    ) && toolResult.data ? (
                      (() => {
                        // console.log('PlaygroundView Image toolResult:', JSON.stringify(toolResult, null, 2)); // Keep for debugging if needed
                        
                        let imgSrc = '';
                        let imagePart: { data?: string; mimeType?: string; type?: string } | null = null;
                        const metadataMime = toolResult.metadata?.mimeType;
                        let nonImageParts: any[] = [];

                        if (Array.isArray(toolResult.data)) {
                          imagePart = toolResult.data.find(part => part && part.type === 'image');
                          if (imagePart && typeof imagePart.data === 'string' && imagePart.mimeType) {
                            imgSrc = `data:${imagePart.mimeType};base64,${imagePart.data}`;
                          }
                        } else if (toolResult.data && typeof toolResult.data === 'object' && Array.isArray((toolResult.data as any).content)) {
                          const partsArray = (toolResult.data as any).content as any[];
                          imagePart = partsArray.find(part => part && part.type === 'image');
                          if (imagePart && typeof imagePart.data === 'string') {
                            const mime = (imagePart.mimeType as string) || metadataMime;
                            if (mime) {
                              imgSrc = `data:${mime};base64,${imagePart.data}`;
                            }
                          }
                          // Collect all non-image parts
                          nonImageParts = partsArray.filter(part => part && part.type !== 'image');
                        } else if (typeof toolResult.data === 'string') {
                          if (toolResult.data.startsWith('data:image')) {
                            imgSrc = toolResult.data;
                          } else if (metadataMime) {
                            imgSrc = `data:${metadataMime};base64,${toolResult.data}`;
                          } else if (toolResult.data.startsWith('http://') || toolResult.data.startsWith('https://')) {
                            imgSrc = toolResult.data; 
                          }
                        }

                        if (imgSrc) {
                          return <img src={imgSrc} alt="Tool result image" className="my-2 max-h-96 w-auto rounded border border-input shadow-sm" />;
                        } else if (nonImageParts.length > 0) {
                          // Render each non-image part as a pretty JSON/code block
                          return (
                            <div className="space-y-3">
                              {nonImageParts.map((part, idx) => (
                                <pre key={idx} className="whitespace-pre-wrap text-sm bg-background p-3 rounded-md border border-input font-mono overflow-x-auto max-h-64">
                                  {typeof part === 'object' ? JSON.stringify(part, null, 2) : String(part)}
                                </pre>
                              ))}
                            </div>
                          );
                        } else {
                          return <p className="text-xs text-destructive">Image data is not in a recognized format. Data: {JSON.stringify(toolResult.data)}</p>;
                        }
                      })()
                    ) : toolResult.metadata?.type === 'markdown' && toolResult.data ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none p-3 bg-background rounded border border-input leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}> 
                            {typeof toolResult.data === 'string' ? toolResult.data : JSON.stringify(toolResult.data, null, 2)}
                          </ReactMarkdown>
                        </div>
                    ) : toolResult.metadata?.type === 'json' && toolResult.data ? (
                        <pre className="whitespace-pre-wrap text-sm bg-background p-3 rounded-md border border-input font-mono">{typeof toolResult.data === 'string' ? toolResult.data : JSON.stringify(toolResult.data, null, 2)}</pre>
                    ) : (
                      <pre className="whitespace-pre-wrap text-sm bg-background p-3 rounded-md border border-input">{typeof toolResult.data === 'object' ? JSON.stringify(toolResult.data, null, 2) : String(toolResult.data)}</pre>
                    )}
                  </div>
                ) : (
                  <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
                    <p className="font-medium mb-1">Execution Failed:</p>
                    <p>{toolResult.error || 'An unknown error occurred.'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <ConnectServerModal isOpen={isConnectModalOpen} onClose={handleModalClose} />
    </div>
  );
} 