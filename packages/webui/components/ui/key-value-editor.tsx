'use client';

import React, { useEffect } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Plus, Trash2 } from 'lucide-react';

interface KeyValuePair {
  key: string;
  value: string;
  id: string;
}

interface KeyValueEditorProps {
  label?: string;
  placeholder?: {
    key?: string;
    value?: string;
  };
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  disabled?: boolean;
  className?: string;
  keyLabel?: string;
  valueLabel?: string;
}

export function KeyValueEditor({
  label = 'Key-Value Pairs',
  placeholder = { key: 'Key', value: 'Value' },
  pairs,
  onChange,
  disabled = false,
  className = '',
  keyLabel = 'Key',
  valueLabel = 'Value'
}: KeyValueEditorProps) {

  const addPair = () => {
    const newPair: KeyValuePair = {
      key: '',
      value: '',
      id: `kv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    };
    onChange([...pairs, newPair]);
  };

  const removePair = (id: string) => {
    const filteredPairs = pairs.filter(pair => pair.id !== id);
    // Allow removing all pairs - don't force an empty pair
    onChange(filteredPairs);
  };

  const updatePair = (id: string, field: 'key' | 'value', newValue: string) => {
    onChange(pairs.map(pair => 
      pair.id === id ? { ...pair, [field]: newValue } : pair
    ));
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {label && (
        <Label className="text-sm font-medium">{label}</Label>
      )}
      
      <div className="space-y-2">
        {/* Header row - only show if there are pairs */}
        {pairs.length > 0 && (
          <div className="grid grid-cols-12 gap-2 items-center text-xs text-muted-foreground">
            <div className="col-span-5">{keyLabel}</div>
            <div className="col-span-6">{valueLabel}</div>
            <div className="col-span-1"></div>
          </div>
        )}

        {/* Key-value pair rows */}
        {pairs.map((pair) => (
          <div key={pair.id} className="grid grid-cols-12 gap-2 items-center">
            <Input
              placeholder={placeholder.key}
              value={pair.key}
              onChange={(e) => updatePair(pair.id, 'key', e.target.value)}
              disabled={disabled}
              className="col-span-5"
            />
            <Input
              placeholder={placeholder.value}
              value={pair.value}
              onChange={(e) => updatePair(pair.id, 'value', e.target.value)}
              disabled={disabled}
              className="col-span-6"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removePair(pair.id)}
              disabled={disabled}
              className="col-span-1 h-8 w-8 p-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addPair}
        disabled={disabled}
        className="w-full mt-2"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add {keyLabel}
      </Button>
    </div>
  );
} 