/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        accent: {
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777'
        }
      }
    }
  },
  plugins: []
}
