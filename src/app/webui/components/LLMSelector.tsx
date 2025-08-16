'use client';

import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Bot, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Key } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { LLMProvider, LLMConfig } from '../types';
import { useChatContext } from './hooks/ChatContext';

// Interface for the LLM switch request body
interface LLMSwitchRequest {
  provider: string;
  model: string;
  router: string;
  apiKey?: string;
  baseURL?: string;
  sessionId?: string;
}

// Function to validate OpenAI-compatible base URL
const validateBaseURL = (url: string): { isValid: boolean; error?: string } => {
  if (!url.trim()) {
    return { isValid: true }; // Empty URL is valid (optional field)
  }

  try {
    const parsedUrl = new URL(url);
    
    // Check if protocol is http or https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { 
        isValid: false, 
        error: 'URL must use http:// or https:// protocol' 
      };
    }

    // Check if URL includes '/v1' for OpenAI compatibility
    if (!parsedUrl.pathname.includes('/v1')) {
      return { 
        isValid: false, 
        error: 'URL must include "/v1" path for OpenAI compatibility' 
      };
    }

    return { isValid: true };
  } catch (error) {
    return { 
      isValid: false, 
      error: 'Invalid URL format' 
    };
  }
};

export default function LLMSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, LLMProvider>>({});
  const [currentConfig, setCurrentConfig] = useState<LLMConfig | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedRouter, setSelectedRouter] = useState<string>('vercel');
  const [apiKey, setApiKey] = useState<string>('');
  const [baseURL, setBaseURL] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasExistingApiKey, setHasExistingApiKey] = useState<boolean>(false);

  // Get current session context to ensure model switch applies to the correct session
  const { currentSessionId } = useChatContext();

  // Fetch current LLM config and available providers
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [currentRes, providersRes] = await Promise.all([
          fetch('/api/llm/current'),
          fetch('/api/llm/providers')
        ]);

        if (currentRes.ok) {
          const current = await currentRes.json();
          setCurrentConfig(current);
          // Check if there's an existing API key
          setHasExistingApiKey(!!current.config.apiKey);
        }

        if (providersRes.ok) {
          const providersData = await providersRes.json();
          setProviders(providersData.providers);
        }
      } catch (err) {
        console.error('Failed to fetch LLM data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen && currentConfig) {
      setSelectedProvider(currentConfig.config.provider);
      setSelectedModel(currentConfig.config.model);
      setSelectedRouter(currentConfig.serviceInfo.router || 'vercel');
      // Keep existing apiKey value instead of resetting to empty
      // Only reset if there's no existing key
      if (!hasExistingApiKey) {
        setApiKey('');
      }
      setBaseURL(currentConfig.config.baseURL || '');
      setShowAdvanced(false);
      setError(null);
      setSuccess(null);
    }
  }, [isOpen, currentConfig, hasExistingApiKey]);

  // Reset dependent fields when provider changes
  useEffect(() => {
    if (selectedProvider) {
      setSelectedModel('');
      // Auto-select appropriate router if current one isn't supported
      const provider = providers[selectedProvider];
      if (provider && !provider.supportedRouters.includes(selectedRouter)) {
        setSelectedRouter(provider.supportedRouters[0] || 'vercel');
      }
      // Clear baseURL if provider doesn't support it
      if (provider && !provider.supportsBaseURL) {
        setBaseURL('');
      }
    }
  }, [selectedProvider, providers, selectedRouter]);

  const handleSwitch = async () => {
    if (!selectedProvider || !selectedModel || !selectedRouter) {
      setError('Please select provider, model, and router');
      return;
    }

    // Validate baseURL if provided
    if (baseURL) {
      const urlValidation = validateBaseURL(baseURL);
      if (!urlValidation.isValid) {
        setError(urlValidation.error || 'Invalid base URL');
        return;
      }
    }

    setIsSwitching(true);
    setError(null);
    setSuccess(null);

    try {
      const requestBody: LLMSwitchRequest = {
        provider: selectedProvider,
        model: selectedModel,
        router: selectedRouter
      };

      if (apiKey) requestBody.apiKey = apiKey;
      if (baseURL) requestBody.baseURL = baseURL;
      
      // Include current session ID to ensure model switch applies to the correct session
      // If there's no active session, it will fall back to the default session behavior
      if (currentSessionId) {
        requestBody.sessionId = currentSessionId;
      }

      const response = await fetch('/api/llm/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (result.ok) {
        // Success case - update config and show success message
        const newConfig: LLMConfig = {
          config: result.data,
          serviceInfo: {
            provider: result.data.provider,
            model: result.data.model,
            router: result.data.router || selectedRouter,
            configuredMaxTokens: result.data.maxInputTokens,
            modelMaxTokens: result.data.maxInputTokens
          }
        };
        setCurrentConfig(newConfig);
        setSuccess(`Successfully switched to ${selectedModel}`);
        setTimeout(() => {
          setIsOpen(false);
          setSuccess(null);
        }, 1500);
      } else {
        // Error case - handle new validation error format
        if (result.issues && result.issues.length > 0) {
          const errors = result.issues.filter((issue: any) => issue.severity === 'error');
          if (errors.length > 0) {
            const primaryError = errors[0];
            setError(primaryError.message);
          } else {
            // Only warnings, treat as success but show warning
            const warnings = result.issues.filter((issue:any) => issue.severity === 'warning');
            if (warnings.length > 0) {
              console.warn('LLM switch warnings:', warnings);
            }
            const newConfig: LLMConfig = {
              config: result.data,
              serviceInfo: {
                provider: result.data.provider,
                model: result.data.model,
                router: result.data.router || selectedRouter,
                configuredMaxTokens: result.data.maxInputTokens,
                modelMaxTokens: result.data.maxInputTokens
              }
            };
            setCurrentConfig(newConfig);
            setSuccess(`Successfully switched to ${selectedModel}`);
            setTimeout(() => {
              setIsOpen(false);
              setSuccess(null);
            }, 1500);
          }
        } else {
          // Fallback error message
          setError('Failed to switch LLM');
        }
      }
    } catch (err) {
      setError('Network error while switching LLM');
    } finally {
      setIsSwitching(false);
    }
  };

  const getCurrentDisplayName = () => {
    if (!currentConfig) return 'Loading...';
    const provider = providers[currentConfig.config.provider];
    return `${provider?.name || currentConfig.config.provider} / ${currentConfig.config.model}`;
  };

  const getAvailableRouters = () => {
    if (!selectedProvider || !providers[selectedProvider]) return [];
    return providers[selectedProvider].supportedRouters;
  };

  const supportsBaseURL = () => {
    return selectedProvider && providers[selectedProvider]?.supportsBaseURL;
  };

  const hasRouterChoice = () => {
    return getAvailableRouters().length > 1;
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="hidden lg:flex items-center space-x-2"
          title="Switch LLM Model"
        >
          <Bot className="h-4 w-4" />
          <span className="text-sm">
            {isLoading ? 'Loading...' : getCurrentDisplayName()}
          </span>
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Switch LLM Model
          </DialogTitle>
          <DialogDescription>
            Change the AI model while preserving your conversation history.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Current Model Display - Compact */}
          {currentConfig && (
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{getCurrentDisplayName()}</div>
                  <div className="text-xs text-muted-foreground">
                    {currentConfig.serviceInfo.router}
                    {currentConfig.config.baseURL && ' • Custom URL'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providers).map(([key, provider]) => (
                  <SelectItem key={key} value={key}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection */}
          {selectedProvider && (
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {providers[selectedProvider]?.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Advanced Options Toggle */}
          <div className="space-y-3">
            <Button 
              variant="ghost" 
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full p-0 h-auto"
            >
              <span className="text-sm text-muted-foreground">Advanced Options</span>
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {/* Advanced Options Content */}
            {showAdvanced && (
              <div className="space-y-4 pl-4 border-l-2 border-muted">
                {/* Router Selection - Only show if there's a choice */}
                {selectedProvider && hasRouterChoice() && (
                  <div className="space-y-2">
                    <Label htmlFor="router">Router</Label>
                    <Select value={selectedRouter} onValueChange={setSelectedRouter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a router" />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableRouters().map((router) => (
                          <SelectItem key={router} value={router}>
                            <span className="capitalize">{router}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      Vercel: Optimized streaming • In-built: Direct integration
                    </div>
                  </div>
                )}

                {/* Custom Base URL (OpenAI only) */}
                {supportsBaseURL() && (
                  <div className="space-y-2">
                    <Label htmlFor="baseURL">Custom Base URL</Label>
                    <Input
                      id="baseURL"
                      type="url"
                      value={baseURL}
                      onChange={(e) => setBaseURL(e.target.value)}
                      placeholder="https://api.your-provider.com/v1"
                    />
                    <div className="text-xs text-muted-foreground">
                      For OpenAI-compatible endpoints
                    </div>
                  </div>
                )}

                {/* API Key Input */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    {hasExistingApiKey && (
                      <Badge variant="secondary" className="text-xs flex items-center gap-1">
                        <Key className="h-3 w-3" />
                        Key Set
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasExistingApiKey ? "Leave empty to keep existing key" : "Enter API key"}
                    className={hasExistingApiKey ? "border-green-200 bg-green-50/50" : ""}
                  />
                  <div className="text-xs text-muted-foreground">
                    {hasExistingApiKey 
                      ? "An API key is already configured. Leave empty to keep current key."
                      : "Enter your API key for this provider"
                    }
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSwitching}>
              Cancel
            </Button>
          </DialogClose>
          <Button 
            onClick={handleSwitch} 
            disabled={isSwitching || !selectedProvider || !selectedModel || !selectedRouter}
          >
            {isSwitching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Switching...
              </>
            ) : (
              'Switch Model'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 