/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 24px 70px rgba(9, 15, 35, 0.14)',
        glow: '0 18px 45px rgba(34, 211, 238, 0.18)',
      },
    },
  },
  plugins: [],
};
