"use client";

import React, { useState } from "react";
import { useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { apiFetch } from '@/lib/api-client.js';

export type ApiKeyModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string; // validated server-side
  primaryEnvVar: string;
  onSaved: (meta: { provider: string; envVar: string }) => void;
};

export function ApiKeyModal({ open, onOpenChange, provider, primaryEnvVar, onSaved }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const saveApiKeyMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) => {
      return await apiFetch<{ ok: boolean; provider: string; envVar: string }>('/api/llm/key', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey }),
      });
    },
    onSuccess: (data) => {
      onSaved({ provider: data.provider, envVar: data.envVar });
      onOpenChange(false);
      setApiKey("");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to save API key");
    },
  });

  const submit = () => {
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    setError(null);
    saveApiKeyMutation.mutate({ provider, apiKey });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set {provider} API Key</DialogTitle>
          <DialogDescription>
            This key will be stored in your .env (env var {primaryEnvVar}). It is not shared with the client.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="apiKey">API Key</Label>
          <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={`Enter ${provider} API key`} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveApiKeyMutation.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={saveApiKeyMutation.isPending}>{saveApiKeyMutation.isPending ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

