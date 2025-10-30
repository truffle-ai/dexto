'use client';

import React from 'react';
import FormEditor from './FormEditor';
import type { AgentConfig } from '@dexto/core';

interface FormEditorViewProps {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
  errors?: Record<string, string>;
}

/**
 * FormEditorView - Pure form editor wrapper
 *
 * This component wraps FormEditor and provides a clean interface.
 * It doesn't handle YAML conversion or loading/saving - that's the parent's job.
 *
 * Reusable in both edit and create flows.
 */
export default function FormEditorView({ config, onChange, errors = {} }: FormEditorViewProps) {
  return (
    <div className="flex flex-col h-full">
      <FormEditor config={config} onChange={onChange} errors={errors} />
    </div>
  );
}
