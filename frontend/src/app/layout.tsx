import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CollabSmart — Sovereign AI-OS',
  description: 'A real-time collaborative AI pair-programming environment',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-sharp-bg text-sharp-text font-mono antialiased">
        {children}
      </body>
    </html>
  );
}
