import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AdbHelper — i99dash',
  description:
    'Privileged mini-app — manage installed apps, view logs, restart services, browse files. Operates on the head-unit it runs on.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Locale + direction are applied client-side after the SDK
  // context loads. SSR defaults stay clean.
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
