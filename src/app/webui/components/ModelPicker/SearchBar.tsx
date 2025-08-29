"use client";

import React from 'react';
import { Input } from "../ui/input";
import { Search } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function SearchBar({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Search className="h-4 w-4 text-muted-foreground" />
      <Input placeholder="Search providers or models" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

