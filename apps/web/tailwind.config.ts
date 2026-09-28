import type { Config } from 'tailwindcss';

const withAlpha = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: withAlpha('--brand'), fg: withAlpha('--brand-fg'), soft: withAlpha('--brand-soft') },
        accent: withAlpha('--accent'),
        ink: { DEFAULT: withAlpha('--ink'), soft: withAlpha('--ink-soft'), muted: withAlpha('--ink-muted') },
        surface: { DEFAULT: withAlpha('--surface'), sunken: withAlpha('--surface-sunken'), raised: withAlpha('--surface-raised') },
        line: withAlpha('--line'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { brand: 'var(--radius)' },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.03)',
        pop: '0 12px 32px -8px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.06)',
      },
      keyframes: { shimmer: { '100%': { transform: 'translateX(100%)' } }, 'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } } },
      animation: { 'fade-in': 'fade-in .25s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
