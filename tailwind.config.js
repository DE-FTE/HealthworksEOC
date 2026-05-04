/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        hw: {
          navy:     '#0A1628',
          'navy-light': '#0F2040',
          'navy-mid': '#162B55',
          teal:     '#00B8A9',
          'teal-dim': '#007A70',
          blue:     '#3B82F6',
          'blue-dim': '#1D4ED8',
          slate:    '#8BA3C7',
          'text-primary': '#E2E8F0',
          'text-muted':   '#94A3B8',
          'text-dim':     '#64748B',
          border:   '#1E3A5F',
          'msg-user': '#1A3461',
          'msg-ai':   '#111F3A',
          success:  '#10B981',
          warning:  '#F59E0B',
          danger:   '#EF4444',
        },
      },
      fontFamily: {
        display: ['var(--font-outfit)', 'sans-serif'],
        body:    ['var(--font-dm-sans)', 'sans-serif'],
        mono:    ['var(--font-dm-mono)', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'blink':      'blink 1s step-end infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        blink:   { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
    },
  },
  plugins: [],
};
