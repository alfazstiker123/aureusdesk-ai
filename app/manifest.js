export default function manifest() {
  return {
    name: 'AureusDesk AI',
    short_name: 'AureusDesk',
    description: 'Analisa XAU/USD multi-timeframe berbasis AI',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0E11',
    theme_color: '#0B0E11',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
