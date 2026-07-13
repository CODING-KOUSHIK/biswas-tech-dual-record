import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Biswas Tech Dual Recording',
  description: 'Professional dual-speaker recording platform for AI speech data collection',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">{children}</body>
    </html>
  );
}
