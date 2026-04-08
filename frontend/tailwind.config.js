/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sharp: {
          bg: '#0a0a0f',
          surface: '#12121a',
          border: '#1e1e2e',
          text: '#e2e2f0',
          accent: '#7c3aed',
          'accent-light': '#a78bfa',
          success: '#10b981',
          error: '#ef4444',
          warning: '#f59e0b',
          ai: '#06b6d4',
          user: '#8b5cf6',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
