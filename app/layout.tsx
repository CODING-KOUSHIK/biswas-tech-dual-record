import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Biswas Tech — Dual Recording Studio',
  description: 'Professional dual-speaker recording platform for AI speech data collection',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Biswas Tech',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0e1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
