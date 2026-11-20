import './globals.css';

export const metadata = {
  title: 'AureusDesk AI — Analisa XAU/USD Multi-Timeframe',
  description:
    'Analisa trading emas (XAU/USD) multi-timeframe berbasis AI Google Gemini dengan jurnal riwayat Supabase.',
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
    <html lang="id">
      <body className="min-h-screen bg-night text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
