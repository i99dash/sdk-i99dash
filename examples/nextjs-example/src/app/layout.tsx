import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next.js Example — i99dash',
  description:
    'Reference mini-app. Demonstrates getContext, callApi, EN/AR + RTL, driving-state banner.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Language + direction are updated *client-side* after the SDK
  // context loads (see ContextCard.client.tsx). SSR defaults keep
  // first paint clean.
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
