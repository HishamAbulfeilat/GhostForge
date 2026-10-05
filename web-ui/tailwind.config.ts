import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './pages/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gf: {
          bg: '#0B0D12', bar: '#0E1117', surface: '#12151C', raised: '#181C26',
          line: '#262B38', line2: '#334155', ink: '#E7E9EE', muted: '#9CA3AF',
          accent: '#38BDF8', 'accent-soft': '#0C2A3A', 'accent-ink': '#BAE6FD',
          ok: '#6EE7B7', 'ok-soft': '#052E1F', warn: '#FCD34D', 'warn-soft': '#2B2107',
          danger: '#FCA5A5', 'danger-soft': '#450A0A', violet: '#C4B5FD', 'violet-soft': '#2E1065',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        plex: ['var(--font-plex)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        tactical: '0 0 0 1px rgba(56, 189, 248, 0.14), 0 18px 50px rgba(2, 6, 23, 0.55)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}

export default config
