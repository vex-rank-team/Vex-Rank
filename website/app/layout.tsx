import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  icons: { icon: '/vex-rank-icon.png', shortcut: '/vex-rank-icon.png', apple: '/vex-rank-icon.png' },
  title: 'VEX-Rank — Global V5RC Rankings & Events',
  description: 'Discover VEX V5 Robotics events, global team rankings, statistics, and detailed team performance profiles.',
  openGraph: {
    title: 'VEX-Rank — Global V5RC Rankings & Events',
    description: 'Discover VEX V5 Robotics events, global team rankings, statistics, and detailed team performance profiles.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VEX-Rank — Global V5RC Rankings & Events',
    description: 'Discover VEX V5 Robotics events, global team rankings, statistics, and detailed team performance profiles.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geist.variable} ${geistMono.variable}`}>{children}</body></html>;
}
