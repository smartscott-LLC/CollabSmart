'use client';

import React, { useState } from 'react';

interface DesktopFrameProps {
  url: string;
}

export default function DesktopFrame({ url }: DesktopFrameProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex flex-col h-full bg-sharp-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sharp-border bg-sharp-surface">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${loaded ? 'bg-sharp-success' : 'bg-yellow-500 animate-pulse'}`} />
          <span className="text-sm font-semibold text-sharp-text">Desktop</span>
          <span className="text-xs text-gray-500">— Shared Workspace</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-sharp-accent-light hover:underline"
        >
          Open in tab ↗
        </a>
      </div>

      {/* noVNC iframe */}
      <div className="flex-1 relative">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-sharp-bg z-10">
            <div className="text-center">
              <div className="text-sharp-accent-light animate-pulse text-sm mb-2">
                Connecting to desktop...
              </div>
              <div className="text-gray-600 text-xs">{url}</div>
            </div>
          </div>
        )}
        <iframe
          src={url}
          className="w-full h-full border-0"
          onLoad={() => setLoaded(true)}
          title="Shared Desktop Environment"
          allow="fullscreen"
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups"
        />
      </div>
    </div>
  );
}
