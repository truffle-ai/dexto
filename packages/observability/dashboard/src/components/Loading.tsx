import React from 'react';

interface LoadingProps {
    text?: string;
}

export function Loading({ text = 'Loading...' }: LoadingProps) {
    return (
        <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-sm text-gray-600">{text}</p>
        </div>
    );
}
