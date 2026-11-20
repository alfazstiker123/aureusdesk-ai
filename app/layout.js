import './globals.css';
import { Inter } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@/lib/themes';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata = {
  title: 'AureusDesk AI — Analisa Multi-Pair & Multi-Timeframe',
  description:
    'Analisa trading multi-pair (emas, forex, crypto) multi-timeframe berbasis AI Google Gemini dengan jurnal riwayat Supabase.',
  applicationName: 'AureusDesk AI',
  // Cegah iOS mengubah harga (mis. 2650.35) menjadi tautan telepon
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: 'AureusDesk', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // isi penuh layar ber-notch / Dynamic Island
  themeColor: '#0B0E11',
  colorScheme: 'dark',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" data-theme="gold" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* terapkan tema tersimpan sebelum render agar tidak berkedip */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-night text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
