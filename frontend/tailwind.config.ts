import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f5f0ff',
          100: '#ede0ff',
          200: '#d8bfff',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b1578',
        },
        cyan: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
        dark: {
          50:  '#f0f0ff',
          100: '#d8d8ff',
          200: '#b0b0dd',
          300: '#8888bb',
          400: '#666699',
          500: '#444477',
          600: '#333366',
          700: '#222244',
          800: '#111124',
          900: '#0d0d1a',
          950: '#07070f',
          void: '#04040e',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'fade-in':     'fadeIn 0.3s ease',
        'slide-up':    'slideUp 0.3s ease-out',
        'slide-right': 'slideRight 0.3s ease-out',
        'pulse-slow':  'pulse 4s ease-in-out infinite',
        'neon-pulse':  'neonPulse 2s ease-in-out infinite',
        'blink':       'blink 1s step-start infinite',
        'shimmer':     'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to:   { transform: 'translateY(0)', opacity: '1' },
        },
        slideRight: {
          from: { transform: 'translateX(-100%)', opacity: '0' },
          to:   { transform: 'translateX(0)', opacity: '1' },
        },
        neonPulse: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(124,58,237,0.3)' },
          '50%':       { boxShadow: '0 0 30px rgba(124,58,237,0.7), 0 0 60px rgba(124,58,237,0.3)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to:   { backgroundPosition: '-200% 0' },
        },
      },
      boxShadow: {
        'neon':    '0 0 20px rgba(124,58,237,0.4), 0 0 60px rgba(124,58,237,0.15)',
        'neon-sm': '0 0 10px rgba(124,58,237,0.3)',
        'cyan':    '0 0 20px rgba(6,182,212,0.4), 0 0 60px rgba(6,182,212,0.15)',
        'green':   '0 0 20px rgba(16,185,129,0.4)',
      },
      backgroundImage: {
        'gradient-neon':   'linear-gradient(135deg, #7c3aed, #06b6d4)',
        'gradient-violet': 'linear-gradient(135deg, #7c3aed, #4f46e5)',
        'gradient-warm':   'linear-gradient(135deg, #f59e0b, #ec4899)',
        'grid-dots':       'radial-gradient(circle, rgba(124,58,237,0.15) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
export default config
