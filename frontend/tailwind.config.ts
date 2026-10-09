import type { Config } from 'tailwindcss'

/**
 * HerovaAi theme tokens.
 *
 * The palette is sampled from the brand mark: an obsidian base (#0f1316) and a champagne accent
 * (#c0a872). Every screen reads these tokens instead of raw hex values, so the whole product
 * re-skins from this one file.
 *
 * Motion is tokenised the same way: named easings + named animations mean a page never invents
 * its own duration, which is what keeps fourteen screens feeling like one product.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Champagne gold — the accent from the logo.
        brand: {
          50:  '#faf6ee',
          100: '#f2e9d5',
          200: '#e4d3ae',
          300: '#d4be8e',
          400: '#c0a872',
          500: '#ad9159',
          600: '#8f7746',
          700: '#6f5c37',
          800: '#4e4027',
          900: '#332a1a',
        },
        // Muted steel replaces the old cyan: reads as "system/technical" without neon.
        cyan: {
          50:  '#f1f4f6',
          100: '#dfe6ea',
          200: '#c3ced6',
          300: '#9fb0bb',
          400: '#7c8f9b',
          500: '#5f7280',
          600: '#4b5b66',
          700: '#3b4850',
          800: '#2b353b',
          900: '#1d2428',
        },
        // Obsidian neutrals, slightly warm so the gold sits naturally on them.
        dark: {
          50:  '#f5f5f3',
          100: '#e6e6e2',
          200: '#c5c6c2',
          300: '#9a9d9c',
          400: '#6e7375',
          500: '#4f5457',
          600: '#3a3f42',
          700: '#2a2f33',
          800: '#1c2125',
          900: '#141819',
          950: '#0f1316',
          void: '#0a0d0f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      screens: {
        xs: '420px',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.75rem',
      },
      transitionTimingFunction: {
        // Overshoots slightly, then settles — used for anything the user "pushes".
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        // Fast out of the gate, long tail — used for panels and menus.
        quint: 'cubic-bezier(0.22, 1, 0.36, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      animation: {
        'fade-in':     'fadeIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-up':     'fadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-down':   'fadeDown 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in':    'scaleIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'slide-right': 'slideRight 0.34s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-left':  'slideLeft 0.34s cubic-bezier(0.22, 1, 0.36, 1)',
        'pop':         'pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'float':       'float 7s ease-in-out infinite',
        'aurora':      'aurora 22s ease-in-out infinite alternate',
        'sheen':       'sheen 1.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'shimmer':     'shimmer 1.8s infinite',
        'spin-slow':   'spin 2.4s linear infinite',
        'pulse-soft':  'pulseSoft 3.2s ease-in-out infinite',
        'neon-pulse':  'brandPulse 3s ease-in-out infinite',
        'blink':       'blink 1s step-start infinite',
        'marquee':     'marquee 34s linear infinite',
        'draw':        'draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'ring-in':     'ringIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeUp:  { from: { transform: 'translateY(14px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeDown:{ from: { transform: 'translateY(-10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        scaleIn: { from: { transform: 'scale(0.96)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        pop:     { '0%': { transform: 'scale(0.9)' }, '60%': { transform: 'scale(1.03)' }, '100%': { transform: 'scale(1)' } },
        slideRight: { from: { transform: 'translateX(-100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        slideLeft:  { from: { transform: 'translateX(100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        float:   { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        /* The page backdrop drifts slowly so a still screen is never dead. */
        aurora:  {
          '0%':   { transform: 'translate3d(-4%, -2%, 0) scale(1)' },
          '50%':  { transform: 'translate3d(3%, 2%, 0) scale(1.08)' },
          '100%': { transform: 'translate3d(-2%, 3%, 0) scale(1.03)' },
        },
        sheen:   { from: { transform: 'translateX(-120%)' }, to: { transform: 'translateX(220%)' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        /* A breath, not a glow-up: premium surfaces do not flash. */
        brandPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(192,168,114,0.18)' },
          '50%':      { boxShadow: '0 0 24px 2px rgba(192,168,114,0.16)' },
        },
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        draw:  { from: { strokeDashoffset: '1' }, to: { strokeDashoffset: '0' } },
        ringIn:{ from: { strokeDashoffset: 'var(--ring-len)' }, to: { strokeDashoffset: 'var(--ring-gap)' } },
      },
      boxShadow: {
        'neon':    '0 18px 50px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)',
        'neon-sm': '0 10px 30px -14px rgba(0,0,0,0.7)',
        'cyan':    '0 18px 50px -22px rgba(0,0,0,0.8)',
        'green':   '0 12px 34px -18px rgba(16,185,129,0.5)',
        'gold':    '0 20px 60px -24px rgba(192,168,114,0.45)',
        'gold-sm': '0 12px 30px -18px rgba(192,168,114,0.4)',
        'lift':    '0 28px 60px -32px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.06)',
        'inner-line': 'inset 0 1px 0 0 rgba(255,255,255,0.05)',
        'focus':   '0 0 0 3px rgba(192,168,114,0.28)',
      },
      backgroundImage: {
        'gradient-neon':   'linear-gradient(135deg, #c0a872, #8f7746)',
        'gradient-violet': 'linear-gradient(135deg, #d4be8e, #ad9159)',
        'gradient-warm':   'linear-gradient(135deg, #c0a872, #6f5c37)',
        'grid-dots':       'radial-gradient(circle, rgba(192,168,114,0.14) 1px, transparent 1px)',
        'sheen':           'linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.14) 45%, transparent 70%)',
      },
      backgroundSize: {
        'grid-dots': '22px 22px',
      },
    },
  },
  plugins: [],
}
export default config
