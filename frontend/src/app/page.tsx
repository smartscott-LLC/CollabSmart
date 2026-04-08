'use client';

import dynamic from 'next/dynamic';

// Dynamically import to avoid SSR issues with socket.io / xterm
const CommandCenter = dynamic(() => import('../components/CommandCenter'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-sharp-bg">
      <span className="text-sharp-accent-light text-lg animate-pulse">
        Initializing CollabSmart...
      </span>
    </div>
  ),
});

export default function HomePage() {
  return <CommandCenter />;
}
