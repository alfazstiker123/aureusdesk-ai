/** @type {import('tailwindcss').Config} */
// Warna memakai CSS variable (app/globals.css) agar bisa berganti tema.
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        night: c('night'),
        panel: c('panel'),
        panel2: c('panel2'),
        line: c('line'),
        gold: c('gold'),
        up: c('up'),
        down: c('down'),
        muted: c('muted'),
        ink: c('ink'),
        strong: c('strong'),
        soft: c('soft'),
        aurum: c('amber'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
