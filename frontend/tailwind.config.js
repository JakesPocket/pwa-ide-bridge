/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ide: {
          bg: '#1e1e1e',
          nav: '#252526',
          accent: '#007acc',
        },
      },
    },
  },
  plugins: [],
};
