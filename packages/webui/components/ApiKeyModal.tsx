"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { getApiUrl } from "@/lib/api-url";

export type ApiKeyModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string; // validated server-side
  primaryEnvVar: string;
  onSaved: (meta: { provider: string; envVar: string }) => void;
};

export function ApiKeyModal({ open, onOpenChange, provider, primaryEnvVar, onSaved }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/llm/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const body: unknown = await res.json();
      if (!res.ok || typeof body !== "object" || body === null) {
        throw new Error("Failed to save API key");
      }
      const meta = body as { ok?: boolean; provider?: string; envVar?: string };
      if (!meta.ok || !meta.provider || !meta.envVar) {
        throw new Error("Unexpected response while saving API key");
      }
      onSaved({ provider: meta.provider, envVar: meta.envVar });
      onOpenChange(false);
      setApiKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save API key");
    } finally {
      setLoading(false);
    }
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

