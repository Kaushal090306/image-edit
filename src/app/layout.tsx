import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shreeva Jewells - Retouching Dashboard',
  description: 'AI-Powered Jewelry Photo Retouching Dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
