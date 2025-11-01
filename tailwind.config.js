/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./**/*.{html,js}",
    "!./node_modules/**",
    "!./functions/node_modules/**"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};

