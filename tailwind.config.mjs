/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0D0D0D',
        'bg-secondary': '#1A1A1E',
        'bg-tertiary': '#242428',
        'pop-orange': '#F07828',
        'pixel-cyan': '#00BCD4',
        'hot-magenta': '#E91E7B',
        'logo-purple': '#6C63FF',
        'off-white': '#F5F5F0',
        'mid-grey': '#999999',
        'deep-grey': '#666666',
        'edge-line': '#2A2A2E',
      },
      fontFamily: {
        montserrat: ['Montserrat', 'sans-serif'],
        dm: ['DM Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
      boxShadow: {
        'glow-orange': '0 0 20px rgba(240, 120, 40, 0.4)',
        'glow-cyan': '0 0 20px rgba(0, 188, 212, 0.4)',
        'glow-magenta': '0 0 20px rgba(233, 30, 123, 0.4)',
      },
    },
  },
  plugins: [],
};
