import './globals.css';

export const metadata = {
  title: 'AureusDesk AI — Analisa XAU/USD Multi-Timeframe',
  description:
    'Analisa trading emas (XAU/USD) multi-timeframe berbasis AI Google Gemini dengan jurnal riwayat Supabase.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0E11',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-night text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
