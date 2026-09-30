/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'] },
      colors: {
        navy: { 50: '#f1f5fa', 100: '#dde7f3', 200: '#b9cde6', 300: '#8aaad2', 400: '#5a83b8', 500: '#3b649a', 600: '#2d4f7e', 700: '#243f65', 800: '#1b3050', 900: '#12213a' },
        risk: { low: '#16a34a', medium: '#eab308', high: '#f97316', critical: '#dc2626' },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.08)' },
    },
  },
  plugins: [],
}
