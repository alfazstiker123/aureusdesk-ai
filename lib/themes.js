// Tema tampilan. Warna sebenarnya ada di app/globals.css ([data-theme="..."]).
// Di sini hanya metadata untuk pemilih tema (swatch) dan warna address bar HP.

export const THEME_KEY = 'aureus_theme';

export const THEMES = [
  { key: 'gold', label: 'Gold Dark', meta: '#0B0E11', swatch: ['#0B0E11', '#FCD535', '#0ECB81'] },
  { key: 'amoled', label: 'AMOLED', meta: '#000000', swatch: ['#000000', '#FCD535', '#F6465D'] },
  { key: 'midnight', label: 'Midnight', meta: '#080D1B', swatch: ['#080D1B', '#38BDF8', '#22C55E'] },
  { key: 'violet', label: 'Violet', meta: '#0C0918', swatch: ['#0C0918', '#A78BFA', '#34D399'] },
  { key: 'light', label: 'Terang', meta: '#F3F4F6', swatch: ['#F3F4F6', '#A16207', '#059669'] },
  { key: 'auto', label: 'Auto', meta: null, swatch: ['#0B0E11', '#9CA3AF', '#F3F4F6'], hint: 'Ikuti mode gelap/terang perangkat' },
];

export const THEME_META = Object.fromEntries(THEMES.filter((t) => t.meta).map((t) => [t.key, t.meta]));

export function resolveTheme(key, prefersLight = false) {
  if (key === 'auto') return prefersLight ? 'light' : 'gold';
  return THEMES.some((t) => t.key === key && t.meta) ? key : 'gold';
}

// Dijalankan sebelum halaman tampil agar tidak "berkedip" saat tema bukan default.
export const THEME_INIT_SCRIPT = `(function(){try{var k=localStorage.getItem('${THEME_KEY}')||'gold';var t=k;if(k==='auto'){t=(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'gold';}
var M=${JSON.stringify(THEME_META)};if(!M[t]){t='gold';}
document.documentElement.setAttribute('data-theme',t);
var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content',M[t]);}}catch(e){}})();`;
