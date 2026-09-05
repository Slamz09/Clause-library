import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Consola 360',
  description: 'Exposure propagation command center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="overflow-hidden h-screen w-screen bg-[#0a0a0f]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
