/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // White flips to dark text in light mode — every `text-white`
        // in the codebase becomes contextual.
        white: 'rgb(var(--c-white) / <alpha-value>)',

        // Gray palette: inverted between modes so existing `bg-gray-900`
        // (dark card) renders as a light card surface in light mode.
        gray: {
          50:  'rgb(var(--c-gray-50)  / <alpha-value>)',
          100: 'rgb(var(--c-gray-100) / <alpha-value>)',
          200: 'rgb(var(--c-gray-200) / <alpha-value>)',
          300: 'rgb(var(--c-gray-300) / <alpha-value>)',
          400: 'rgb(var(--c-gray-400) / <alpha-value>)',
          500: 'rgb(var(--c-gray-500) / <alpha-value>)',
          600: 'rgb(var(--c-gray-600) / <alpha-value>)',
          700: 'rgb(var(--c-gray-700) / <alpha-value>)',
          800: 'rgb(var(--c-gray-800) / <alpha-value>)',
          900: 'rgb(var(--c-gray-900) / <alpha-value>)',
          950: 'rgb(var(--c-gray-950) / <alpha-value>)',
        },

        // Blue palette → remapped to Sky (Linear-style accent).
        // Lighter shades shift darker in light mode for contrast.
        blue: {
          50:  'rgb(var(--c-blue-50)  / <alpha-value>)',
          100: 'rgb(var(--c-blue-100) / <alpha-value>)',
          200: 'rgb(var(--c-blue-200) / <alpha-value>)',
          300: 'rgb(var(--c-blue-300) / <alpha-value>)',
          400: 'rgb(var(--c-blue-400) / <alpha-value>)',
          500: 'rgb(var(--c-blue-500) / <alpha-value>)',
          600: 'rgb(var(--c-blue-600) / <alpha-value>)',
          700: 'rgb(var(--c-blue-700) / <alpha-value>)',
          800: 'rgb(var(--c-blue-800) / <alpha-value>)',
          900: 'rgb(var(--c-blue-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
